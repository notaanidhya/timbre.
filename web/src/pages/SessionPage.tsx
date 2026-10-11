import React, { useState, useEffect, useRef } from 'react'
import {
  Link as LinkIcon,
  Microphone,
  MicrophoneSlash,
  Broadcast,
  Check,
  Play,
  Pause,
  ArrowSquareOut,
  ArrowCounterClockwise,
  Plus,
} from '@phosphor-icons/react'
import {
  PhoenixSessionManager,
  ParticipantInfo,
  MergeCompletePayload,
} from '../lib/socket'
import { getAudioUrl } from '../lib/api'

interface SessionPageProps {
  onOpenVoiceStudio?: () => void
  onWsStateChange?: (connected: boolean) => void
}

const BORDER_COLORS = ['border-t-sage', 'border-t-dusk', 'border-t-clay', 'border-t-mist']
const AVATAR_BG = ['bg-mist', 'bg-rose']

export const SessionPage: React.FC<SessionPageProps> = ({ onOpenVoiceStudio, onWsStateChange }) => {
  // Lobby State
  const [roomId, setRoomId] = useState<string>('')
  const [displayName, setDisplayName] = useState<string>(() => {
    return localStorage.getItem('timbre_display_name') || ''
  })
  const [inSession, setInSession] = useState<boolean>(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Stage State
  const [participants, setParticipants] = useState<ParticipantInfo[]>([])
  const [peerLevels, setPeerLevels] = useState<{ [name: string]: number }>({})
  const [isMuted, setIsMuted] = useState<boolean>(false)
  const [isStreaming, setIsStreaming] = useState<boolean>(false)
  const [isFinished, setIsFinished] = useState<boolean>(false)
  const [sessionSeconds, setSessionSeconds] = useState<number>(0)

  // Multi-Take State
  const [takes, setTakes] = useState<number[]>([1])
  const [activeTake, setActiveTake] = useState<number>(1)

  // Merge State
  const [isMerging, setIsMerging] = useState<boolean>(false)
  const [mergedResult, setMergedResult] = useState<MergeCompletePayload | null>(null)
  const [isPlayingMerged, setIsPlayingMerged] = useState<boolean>(false)

  // Audio & Socket Refs
  const sessionManagerRef = useRef<PhoenixSessionManager | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const isFirstChunkRef = useRef<boolean>(true)
  const sessionTimerRef = useRef<number | null>(null)
  const mergedAudioRef = useRef<HTMLAudioElement | null>(null)
  const activeTrackRef = useRef<string>('')

  const getTrackName = (takeNum: number, name = displayName.trim()) => {
    return `${name} (Take ${takeNum})`
  }

  const activeTrackName = getTrackName(activeTake)

  useEffect(() => {
    activeTrackRef.current = activeTrackName
  }, [activeTrackName])

  // Initialize short readable Room ID from URL or random generator
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const existingRoom = params.get('room')
    if (existingRoom) {
      setRoomId(existingRoom)
    } else {
      const adjectives = ['amber', 'moss', 'copper', 'dusk', 'quiet', 'swift', 'clay']
      const nouns = ['fox', 'tape', 'pine', 'stream', 'reel', 'cedar', 'track']
      const num = Math.floor(Math.random() * 90 + 10)
      const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
      const noun = nouns[Math.floor(Math.random() * nouns.length)]
      setRoomId(`${adj}-${noun}-${num}`)
    }
  }, [])

  // Copy Room Link with toast
  const handleCopyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`
    navigator.clipboard.writeText(url)
    setToastMessage('Link copied')
    setTimeout(() => setToastMessage(null), 2000)
  }

  // Join Room
  const handleJoinSession = async () => {
    if (!displayName.trim()) {
      alert('Please enter a display name to join the session.')
      return
    }

    const initialTrack = getTrackName(1)
    const manager = new PhoenixSessionManager('/socket', (connected) => {
      onWsStateChange?.(connected)
    })
    sessionManagerRef.current = manager

    try {
      await manager.connect(displayName.trim())
      await manager.joinRoom(roomId, {
        onParticipantJoined: (name) => {
          setParticipants((prev) => {
            if (prev.some((p) => p.name === name)) return prev
            return [...prev, { name, chunks_count: 0, done: false, start_ts: Date.now() }]
          })
        },
        onParticipantDone: (name) => {
          setParticipants((prev) =>
            prev.map((p) => (p.name === name ? { ...p, done: true } : p))
          )
        },
        onPeerLevel: ({ participant, level }) => {
          setPeerLevels((prev) => ({ ...prev, [participant]: level }))
        },
        onSessionState: (state) => {
          setParticipants(state.participants)
        },
        onMergeComplete: (payload) => {
          setIsMerging(false)
          setMergedResult(payload)
        },
        onMergeError: (reason) => {
          setIsMerging(false)
          alert(`Merge failed: ${reason}`)
        },
      })

      // Add initial take to participants list
      setParticipants((prev) => {
        if (prev.some((p) => p.name === initialTrack)) return prev
        return [...prev, { name: initialTrack, chunks_count: 0, done: false, start_ts: Date.now() }]
      })

      setTakes([1])
      setActiveTake(1)

      // Persist display name
      localStorage.setItem('timbre_display_name', displayName.trim())

      // Sync room ID to URL search params
      const url = new URL(window.location.href)
      url.searchParams.set('room', roomId)
      window.history.replaceState(null, '', url.toString())

      setInSession(true)
      setSessionSeconds(0)
    } catch (err: any) {
      alert(`Could not join room: ${err.message}`)
    }
  }

  // Audio Streaming Pipeline via AudioWorklet
  const startStreaming = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      mediaStreamRef.current = stream

      const ctx = new AudioContext()
      audioContextRef.current = ctx

      await ctx.audioWorklet.addModule('/pcm-processor.js')
      const workletNode = new AudioWorkletNode(ctx, 'pcm-processor')
      workletNodeRef.current = workletNode

      const source = ctx.createMediaStreamSource(stream)
      source.connect(workletNode)

      // Connect to silent gain node so Web Audio rendering graph continuously pulls frames
      const muteGain = ctx.createGain()
      muteGain.gain.value = 0
      workletNode.connect(muteGain)
      muteGain.connect(ctx.destination)

      isFirstChunkRef.current = true
      setIsStreaming(true)

      // Start/resume live recording timer
      if (!sessionTimerRef.current) {
        sessionTimerRef.current = window.setInterval(() => {
          setSessionSeconds((s) => s + 1)
        }, 1000)
      }

      workletNode.port.onmessage = (event) => {
        const { buffer, level } = event.data
        if (!buffer || isMuted) return

        const currentTrack = activeTrackRef.current || displayName.trim()

        // Update local user's own volume meter for active track
        setPeerLevels((prev) => ({ ...prev, [currentTrack]: level }))

        // Broadcast level to peers for live visual volume indicator
        sessionManagerRef.current?.sendLevel(level, currentTrack)

        // Send binary audio frame to server
        if (isFirstChunkRef.current) {
          isFirstChunkRef.current = false
          sessionManagerRef.current?.sendFirstChunk(Date.now(), buffer, currentTrack)
        } else {
          sessionManagerRef.current?.sendAudioChunk(buffer, currentTrack)
        }
      }
    } catch (err: any) {
      alert(`Mic streaming error: ${err.message}`)
    }
  }

  const stopStreaming = () => {
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current)
      sessionTimerRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    workletNodeRef.current = null
    setIsStreaming(false)
  }

  const handleFinishTake = () => {
    stopStreaming()
    setIsFinished(true)
    const currentTrack = activeTrackRef.current || displayName.trim()
    sessionManagerRef.current?.sendParticipantDone(currentTrack)

    setParticipants((prev) =>
      prev.map((p) => (p.name === currentTrack ? { ...p, done: true } : p))
    )
  }

  const handleAddTake = () => {
    if (isStreaming) stopStreaming()

    const nextTakeNum = Math.max(...takes, 0) + 1
    const nextTrackName = getTrackName(nextTakeNum)

    setTakes((prev) => [...prev, nextTakeNum])
    setActiveTake(nextTakeNum)
    activeTrackRef.current = nextTrackName
    setIsFinished(false)
    setSessionSeconds(0)

    sessionManagerRef.current?.addTake(nextTrackName)

    setParticipants((prev) => {
      if (prev.some((p) => p.name === nextTrackName)) return prev
      return [...prev, { name: nextTrackName, chunks_count: 0, done: false, start_ts: Date.now() }]
    })
  }

  const handleReRecordTake = (takeNum?: number) => {
    const targetTake = takeNum || activeTake
    const targetTrack = getTrackName(targetTake)

    if (isStreaming) stopStreaming()

    sessionManagerRef.current?.resetTake(targetTrack)

    if (targetTake === activeTake) {
      setIsFinished(false)
      setSessionSeconds(0)
    } else {
      setActiveTake(targetTake)
      activeTrackRef.current = targetTrack
      setIsFinished(false)
      setSessionSeconds(0)
    }

    setParticipants((prev) =>
      prev.map((p) => (p.name === targetTrack ? { ...p, chunks_count: 0, done: false } : p))
    )
  }

  const handleSelectTake = (takeNum: number) => {
    if (isStreaming || takeNum === activeTake) return
    setActiveTake(takeNum)
    const tName = getTrackName(takeNum)
    activeTrackRef.current = tName
    const pInfo = participants.find((p) => p.name === tName)
    setIsFinished(pInfo?.done || false)
    setSessionSeconds(0)
  }

  const handleTriggerMerge = async () => {
    setIsMerging(true)
    try {
      await sessionManagerRef.current?.triggerMerge()
    } catch (err: any) {
      setIsMerging(false)
      alert(`Merge trigger failed: ${err.message}`)
    }
  }

  const handleLeaveSession = () => {
    stopStreaming()
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current)
      sessionTimerRef.current = null
    }
    sessionManagerRef.current?.leave()
    sessionManagerRef.current = null
    onWsStateChange?.(false)
    setInSession(false)
    setIsFinished(false)
    setTakes([1])
    setActiveTake(1)
    setParticipants([])
    setPeerLevels({})
    setMergedResult(null)
    setSessionSeconds(0)

    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + (url.hash || ''))
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStreaming()
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current)
      sessionManagerRef.current?.leave()
      onWsStateChange?.(false)
    }
  }, [])

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  // =========================================================================
  // VIEW 1: LOBBY
  // =========================================================================
  if (!inSession) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <div className="rounded-[3px] border border-rule bg-sheet p-8 panel-shadow">
          <span className="font-mono text-[11px] text-ink-3 tracking-widest uppercase">05 / ROOM</span>
          <h2 className="font-display text-3xl tracking-tight text-ink mt-1">Gather your voices</h2>
          <p className="mt-2 text-sm text-ink-2 font-sans leading-relaxed">
            Record together in real time. Everyone’s microphone audio is synchronized and merged into a single multi-voice master take.
          </p>

          <div className="mt-8 flex flex-col gap-6">
            {/* Room ID display & Copy Link button */}
            <div>
              <label className="font-mono text-[11px] text-ink-3 uppercase block mb-1.5">Room Code</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  className="flex-1 border border-rule bg-paper-2 px-3 py-2 font-mono text-sm text-ink rounded-[2px]"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 border border-rule bg-sheet px-3 py-2 text-xs font-sans text-ink hover:border-ink-2 rounded-[2px] btn-press"
                  title="Copy shareable link"
                >
                  <LinkIcon size={16} />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            {/* Display Name Input */}
            <div>
              <label className="font-mono text-[11px] text-ink-3 uppercase block mb-1.5">Your Name</label>
              <input
                type="text"
                placeholder="e.g. Alice"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full border-b border-rule bg-transparent py-2 font-display text-xl text-ink placeholder:font-sans placeholder:text-sm placeholder:text-ink-3 focus:border-clay focus:outline-none"
              />
            </div>

            {/* Join Session Button (Solid Clay) */}
            <button
              type="button"
              onClick={handleJoinSession}
              className="w-full rounded-[3px] bg-clay py-3 text-sm font-sans font-medium text-paper hover:bg-clay-deep btn-press shadow-sm mt-2"
            >
              Join Session
            </button>
          </div>
        </div>

        {/* Copy Toast */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 rounded-[2px] border border-rule bg-sheet px-4 py-2.5 font-mono text-xs text-ink shadow-md animate-fade-in">
            {toastMessage}
          </div>
        )}
      </div>
    )
  }

  // =========================================================================
  // VIEW 2: STAGE & LIVE MERGE ROOM
  // =========================================================================
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 flex flex-col gap-8">
      {/* Header Strip */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-rule pb-4 font-mono text-xs text-ink-2 gap-2">
        <div className="flex items-center gap-3">
          <span className="text-ink font-semibold tracking-wide">ROOM {roomId}</span>
          <span className="text-rule">·</span>
          <span>{participants.length} {participants.length === 1 ? 'track here' : 'tracks here'}</span>
          <span className="text-rule">·</span>
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span
              className={`h-2 w-2 rounded-full ${
                isStreaming ? 'bg-clay animate-ping' : isFinished ? 'bg-moss' : 'border border-ink-3'
              }`}
            />
            <span className="text-ink font-medium tabular-nums">
              {isStreaming
                ? `LIVE ${formatTimer(sessionSeconds)} (Take ${activeTake})`
                : isFinished
                ? `TAKE ${activeTake}: ${formatTimer(sessionSeconds)}`
                : `TAKE ${activeTake} · STANDBY`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex items-center gap-1 text-ink-3 hover:text-ink font-mono text-xs"
          >
            <LinkIcon size={14} />
            <span>Copy invite link</span>
          </button>
          <span className="text-rule">|</span>
          <button
            type="button"
            onClick={handleLeaveSession}
            className="text-brick hover:underline font-mono text-xs"
          >
            Leave room
          </button>
        </div>
      </div>

      {/* Participant Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {participants.map((p, idx) => {
          const isYou = p.name === displayName.trim() || p.name.startsWith(`${displayName.trim()} (Take `)
          const isActiveTake = p.name === activeTrackName
          const level = peerLevels[p.name] || 0
          const isSpeaking = level > 0.05
          const borderClass = BORDER_COLORS[idx % BORDER_COLORS.length]
          const avatarBg = AVATAR_BG[idx % AVATAR_BG.length]

          const takeMatch = p.name.match(/\(Take (\d+)\)/)
          const initials = takeMatch
            ? `${p.name.slice(0, 1).toUpperCase()}T${takeMatch[1]}`
            : p.name.slice(0, 2).toUpperCase()

          return (
            <div
              key={p.name}
              className={`rounded-[3px] border border-rule bg-sheet p-5 border-t-[3px] ${borderClass} panel-shadow transition-all ${
                isSpeaking ? 'shadow-md border-clay/60' : isActiveTake ? 'ring-1 ring-clay/40' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Circle Avatar with Initials */}
                <div
                  className={`relative flex h-12 w-12 items-center justify-center rounded-full ${avatarBg} text-ink font-display text-sm font-semibold select-none`}
                >
                  {isSpeaking && (
                    <span className="absolute inset-0 rounded-full border-2 border-clay animate-pulse -m-0.5" />
                  )}
                  {initials}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-sans font-medium text-ink truncate flex items-center gap-1.5">
                    <span className="truncate">{p.name}</span>
                    {isYou && <span className="text-ink-3 text-xs font-mono font-normal flex-shrink-0">(you)</span>}
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3 mt-0.5">
                    <span
                      className={`h-1.5 w-1.5 ${
                        p.done ? 'bg-moss' : isSpeaking ? 'bg-clay animate-ping' : 'bg-sage'
                      }`}
                    />
                    <span className="uppercase text-[10px]">
                      {p.done ? 'take finished' : isSpeaking ? 'speaking' : isActiveTake ? 'active' : 'ready'}
                    </span>
                    {isActiveTake && (
                      <span className="ml-1 text-[9px] px-1 py-0.2 rounded-xs bg-clay/10 text-clay font-mono">
                        REC SLOT
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 16-Segment Live LED Meter */}
              <div className="mt-4 flex h-2 w-full gap-[2px]">
                {Array.from({ length: 16 }).map((_, i) => {
                  const active = i < Math.round(level * 16)
                  return (
                    <div
                      key={i}
                      className={`flex-1 transition-colors duration-75 ${
                        active ? (i >= 13 ? 'bg-clay' : 'bg-sage') : 'bg-paper-2'
                      }`}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Your Mic Console & Multi-Take Management */}
      <div className="rounded-[3px] border border-rule bg-sheet p-5 flex flex-col gap-4 panel-shadow">
        {/* Takes Ribbon Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase text-ink-3 tracking-wider">Your Takes:</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {takes.map((t) => {
                const tName = getTrackName(t)
                const pInfo = participants.find((p) => p.name === tName)
                const isDone = pInfo?.done
                const isActive = t === activeTake

                return (
                  <button
                    key={t}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => handleSelectTake(t)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 font-mono text-xs rounded-[2px] transition-all btn-press ${
                      isActive
                        ? 'bg-clay text-paper font-medium shadow-xs'
                        : 'border border-rule bg-paper-2 text-ink hover:border-ink-2'
                    } disabled:opacity-50`}
                  >
                    <span>Take {t}</span>
                    {isDone ? (
                      <Check size={12} weight="bold" className={isActive ? 'text-paper' : 'text-moss'} />
                    ) : isActive && isStreaming ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-paper animate-ping" />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={handleAddTake}
            disabled={isStreaming}
            className="flex items-center gap-1.5 px-3 py-1 font-mono text-xs font-medium text-ink bg-paper-2 border border-rule hover:border-ink-2 rounded-[2px] btn-press disabled:opacity-50"
            title="Layer another take / vocal track"
          >
            <Plus size={13} weight="bold" />
            <span>Add another take</span>
          </button>
        </div>

        {/* Console Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              className={`flex items-center gap-2 rounded-[2px] border border-rule px-4 py-2 text-xs font-sans font-medium btn-press ${
                isMuted ? 'bg-rose text-brick border-brick/40' : 'bg-paper-2 text-ink'
              }`}
            >
              {isMuted ? <MicrophoneSlash size={16} /> : <Microphone size={16} />}
              <span>{isMuted ? 'Muted' : 'Mute mic'}</span>
            </button>

            {!isStreaming ? (
              <button
                type="button"
                onClick={startStreaming}
                disabled={isFinished}
                className="flex items-center gap-2 rounded-[2px] bg-clay px-5 py-2 text-xs font-sans font-medium text-paper hover:bg-clay-deep btn-press disabled:opacity-50"
              >
                <Broadcast size={16} />
                <span>Start streaming (Take {activeTake})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopStreaming}
                className="flex items-center gap-2 rounded-[2px] border-2 border-clay px-4 py-1.5 text-xs font-mono font-medium text-clay bg-paper-2 btn-press"
              >
                <span className="h-2 w-2 rounded-full bg-clay animate-ping" />
                <span>LIVE · Pause Take {activeTake}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isFinished ? (
              <>
                <button
                  type="button"
                  onClick={() => handleReRecordTake(activeTake)}
                  className="flex items-center gap-1.5 rounded-[2px] border border-rule bg-paper-2 px-3 py-2 text-xs font-sans text-ink hover:border-ink-2 btn-press"
                  title="Discard this take and re-record it"
                >
                  <ArrowCounterClockwise size={14} />
                  <span>Re-record Take {activeTake}</span>
                </button>

                <button
                  type="button"
                  onClick={handleAddTake}
                  className="flex items-center gap-1.5 rounded-[2px] bg-clay px-3.5 py-2 text-xs font-sans font-medium text-paper hover:bg-clay-deep btn-press shadow-xs"
                >
                  <Plus size={14} weight="bold" />
                  <span>Record Take {Math.max(...takes, 0) + 1}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleFinishTake}
                className="flex items-center gap-2 rounded-[2px] bg-moss px-4 py-2 text-xs font-sans font-medium text-paper hover:opacity-95 btn-press"
              >
                <Check size={16} />
                <span>Finish Take {activeTake}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Section C: Merge Console */}
      <div className="rounded-[3px] border border-dashed border-rule bg-paper-2 p-6 text-center">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">06 / MERGE</span>
        <h3 className="font-display text-2xl text-ink mt-0.5">Master take mixer</h3>
        <p className="text-xs text-ink-2 font-sans mt-1 max-w-md mx-auto">
          Synchronizes all participant streams by their starting timestamp and merges them into a clean 16-bit WAV file.
        </p>

        {/* Merge Button */}
        <div className="mt-5">
          <button
            type="button"
            onClick={handleTriggerMerge}
            disabled={isMerging}
            className="rounded-[3px] bg-clay px-8 py-3 text-sm font-sans font-medium text-paper hover:bg-clay-deep btn-press shadow-sm disabled:opacity-50"
          >
            {isMerging ? 'Merging tracks…' : 'Merge all tracks into one WAV'}
          </button>
        </div>

        {/* Merging Animation: 3-4 sliding tracks (replacing generic spinner) */}
        {isMerging && (
          <div className="mt-8 flex flex-col items-center justify-center">
            <div className="w-64 flex flex-col gap-2 my-3">
              <div className="h-1.5 w-full bg-sheet relative overflow-hidden rounded-xs">
                <div className="h-full bg-sage animate-[marquee_1.2s_ease-in-out_infinite]" />
              </div>
              <div className="h-1.5 w-full bg-sheet relative overflow-hidden rounded-xs">
                <div className="h-full bg-sage animate-[marquee_1.2s_ease-in-out_infinite_200ms]" />
              </div>
              <div className="h-1.5 w-full bg-sheet relative overflow-hidden rounded-xs">
                <div className="h-full bg-dusk animate-[marquee_1.2s_ease-in-out_infinite_400ms]" />
              </div>
            </div>
            <span className="font-mono text-xs text-ink-2">Aligning timestamps and mixing into one WAV…</span>
          </div>
        )}

        {/* Success Card */}
        {mergedResult && (
          <div className="mt-8 rounded-[3px] border border-rule bg-sheet p-6 border-t-[3px] border-t-moss text-left panel-shadow">
            <span className="font-mono text-[10px] text-moss uppercase tracking-widest font-semibold">
              MERGE COMPLETE ✓
            </span>
            <h4 className="font-display text-2xl text-ink mt-1">{mergedResult.title}</h4>
            <p className="font-mono text-xs text-ink-2 mt-1">
              Length: {Math.round(mergedResult.duration_ms / 1000)}s · Format: 16-bit 48kHz WAV
            </p>

            <div className="mt-4 flex items-center justify-between gap-4">
              {/* Audio player for merged result */}
              <div className="flex items-center gap-3">
                <audio
                  ref={mergedAudioRef}
                  src={getAudioUrl(mergedResult.recording_id)}
                  onEnded={() => setIsPlayingMerged(false)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (mergedAudioRef.current) {
                      if (isPlayingMerged) {
                        mergedAudioRef.current.pause()
                        setIsPlayingMerged(false)
                      } else {
                        mergedAudioRef.current.play()
                        setIsPlayingMerged(true)
                      }
                    }
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-moss text-paper hover:opacity-95 btn-press"
                >
                  {isPlayingMerged ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" className="ml-0.5" />}
                </button>
                <span className="font-sans text-xs text-ink">Preview master take</span>
              </div>

              {/* Link to view in Voice Studio */}
              <button
                type="button"
                onClick={() => onOpenVoiceStudio?.()}
                className="flex items-center gap-1.5 font-sans text-xs text-ink font-medium hover:text-clay underline underline-offset-4"
              >
                <span>Open in Voice Studio</span>
                <ArrowSquareOut size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Copy Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-[2px] border border-rule bg-sheet px-4 py-2.5 font-mono text-xs text-ink shadow-md">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
