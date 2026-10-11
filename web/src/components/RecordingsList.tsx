import React, { useState, useRef } from 'react'
import {
  Play,
  Pause,
  DownloadSimple,
  Trash,
  SpeakerHigh,
  SpeakerX,
  Waveform,
} from '@phosphor-icons/react'
import { RecordingItemData, getAudioUrl, deleteRecording } from '../lib/api'
import { EffectPanel } from './EffectPanel'
import { TranscriptDrawer } from './TranscriptDrawer'

interface RecordingsListProps {
  recordings: RecordingItemData[]
  loading: boolean
  onRefresh: () => void
  onToggleEffects?: (id: number) => void
  activeEffectId?: number | null
  onToggleTranscribe?: (id: number) => void
  activeTranscribeId?: number | null
}

export const RecordingsList: React.FC<RecordingsListProps> = ({
  recordings,
  loading,
  onRefresh,
  onToggleEffects,
  activeEffectId,
  onToggleTranscribe,
  activeTranscribeId,
}) => {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [isMuted, setIsMuted] = useState<boolean>(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  const formatMs = (ms: number | null) => {
    if (!ms || ms <= 0) return '0:00'
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return '0 KB'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handlePlayToggle = (id: number) => {
    if (playingId === id) {
      if (audioRef.current) {
        if (audioRef.current.paused) audioRef.current.play()
        else audioRef.current.pause()
      }
    } else {
      setPlayingId(id)
      setCurrentTime(0)
    }
  }

  const handleSeek = (newTimeSec: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = newTimeSec
      setCurrentTime(newTimeSec)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      if (playingId === id) {
        setPlayingId(null)
      }
      await deleteRecording(id)
      setConfirmDeleteId(null)
      onRefresh()
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`)
    }
  }

  return (
    <section className="rounded-[3px] border border-rule bg-sheet p-6 panel-shadow">
      {/* Header with 02 / LIBRARY and clip counter */}
      <div className="flex items-center justify-between border-b border-rule pb-3 mb-6">
        <div>
          <span className="font-mono text-[11px] text-ink-3 tracking-widest uppercase">02 / LIBRARY</span>
          <h2 className="font-display text-2xl tracking-tight text-ink mt-0.5">Your recordings</h2>
        </div>
        <span className="font-mono text-xs text-ink-3">
          {recordings.length} {recordings.length === 1 ? 'clip' : 'clips'}
        </span>
      </div>

      {/* Hidden native audio tag to play the active stream */}
      {playingId && (
        <audio
          ref={audioRef}
          src={getAudioUrl(playingId)}
          autoPlay
          muted={isMuted}
          onTimeUpdate={() => {
            if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
          }}
          onEnded={() => setPlayingId(null)}
          onPause={() => {}}
          onError={() => setPlayingId(null)}
        />
      )}

      {/* Empty State */}
      {!loading && recordings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 text-moss/80">
            <Waveform size={40} weight="light" />
          </div>
          <p className="font-display text-xl text-ink">Nothing recorded yet</p>
          <p className="font-mono text-xs text-ink-3 mt-1">press space to begin</p>
        </div>
      )}

      {/* Recordings Tape Cards List */}
      <div className="flex flex-col gap-4">
        {recordings.map((item) => {
          const isPlaying = playingId === item.id
          const totalSec = (item.duration_ms || 1000) / 1000
          const progressPercent = isPlaying ? Math.min(100, (currentTime / totalSec) * 100) : 0
          const shortDate = new Date(item.inserted_at).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
          const formatLabel = item.content_type?.includes('ogg')
            ? 'ogg'
            : item.content_type?.includes('wav')
            ? 'wav'
            : 'webm'

          return (
            <div
              key={item.id}
              className="group rounded-[3px] border border-rule bg-sheet p-4 transition-all hover:border-ink-3"
              style={{ boxShadow: '2px 2px 0 var(--color-rule)' }}
            >
              {/* Card Header Info */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-display text-lg tracking-tight text-ink group-hover:text-moss transition-colors">
                    {item.title}
                  </h3>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-ink-2">
                    <span>{formatMs(item.duration_ms)}</span>
                    <span className="text-rule">·</span>
                    <span>{formatBytes(item.size_bytes)}</span>
                    <span className="text-rule">·</span>
                    <span>{item.sample_rate ? `${item.sample_rate / 1000} kHz` : '48 kHz'}</span>
                    <span className="text-rule">·</span>
                    <span className="rounded-[2px] bg-paper-2 border border-rule px-1 py-0.2 text-[10px]">
                      {formatLabel}
                    </span>
                  </div>
                </div>

                <span className="font-mono text-[11px] text-ink-3 shrink-0">{shortDate}</span>
              </div>

              {/* Audio Player Scrubber Row */}
              <div className="mt-4 flex items-center gap-3 border-t border-rule/60 pt-3">
                {/* 36px Moss Play / Pause Circle */}
                <button
                  type="button"
                  onClick={() => handlePlayToggle(item.id)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-moss text-paper hover:opacity-95 btn-press"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" className="ml-0.5" />}
                </button>

                {/* 2px Scrubber with 10px square thumb */}
                <div className="relative flex flex-1 flex-col justify-center">
                  <div
                    className="relative h-2 w-full cursor-pointer flex items-center"
                    onClick={(e) => {
                      if (!isPlaying) handlePlayToggle(item.id)
                      const rect = e.currentTarget.getBoundingClientRect()
                      const clickX = e.clientX - rect.left
                      const pct = Math.max(0, Math.min(1, clickX / rect.width))
                      handleSeek(pct * totalSec)
                    }}
                  >
                    {/* Unplayed background line in --rule */}
                    <div className="h-[2px] w-full bg-rule relative">
                      {/* Played portion in --moss */}
                      <div className="h-full bg-moss" style={{ width: `${progressPercent}%` }} />
                    </div>

                    {/* 10px Square Thumb */}
                    {isPlaying && (
                      <div
                        className="absolute h-2.5 w-2.5 bg-ink shadow-xs transition-transform pointer-events-none -ml-1"
                        style={{ left: `${progressPercent}%` }}
                      />
                    )}
                  </div>

                  {/* Time Display */}
                  <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-3 tabular-nums">
                    <span>{isPlaying ? formatMs(currentTime * 1000) : '0:00'}</span>
                    <span>{formatMs(item.duration_ms)}</span>
                  </div>
                </div>

                {/* Mute button */}
                <button
                  type="button"
                  onClick={() => setIsMuted(!isMuted)}
                  title={isMuted ? 'Unmute' : 'Mute'}
                  className="text-ink-3 hover:text-ink p-1.5 rounded-[2px]"
                >
                  {isMuted ? <SpeakerX size={18} weight="light" /> : <SpeakerHigh size={18} weight="light" />}
                </button>

                {/* Download audio */}
                <a
                  href={getAudioUrl(item.id)}
                  download={`recording-${item.id}`}
                  title="Download raw audio"
                  className="text-ink-3 hover:text-ink p-1.5 rounded-[2px]"
                >
                  <DownloadSimple size={18} weight="light" />
                </a>
              </div>

              {/* Action Bar (Effects, Transcribe, Delete) */}
              <div className="mt-3 flex items-center justify-between border-t border-rule/60 pt-2 text-xs font-sans">
                <div className="flex items-center gap-4">
                  {onToggleEffects && (
                    <button
                      type="button"
                      onClick={() => onToggleEffects(item.id)}
                      className={`font-medium transition-colors ${
                        activeEffectId === item.id ? 'text-dusk underline underline-offset-4' : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      Effects lab
                    </button>
                  )}

                  <span className="text-rule">|</span>

                  {onToggleTranscribe && (
                    <button
                      type="button"
                      onClick={() => onToggleTranscribe(item.id)}
                      className={`font-medium transition-colors ${
                        activeTranscribeId === item.id ? 'text-clay underline underline-offset-4' : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      AI Transcribe
                    </button>
                  )}
                </div>

                {/* Inline Delete Confirmation */}
                {confirmDeleteId === item.id ? (
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-brick">Delete?</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="text-brick hover:underline font-bold"
                    >
                      Yes
                    </button>
                    <span className="text-rule">/</span>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-ink-3 hover:text-ink"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(item.id)}
                    className="text-ink-3 hover:text-brick flex items-center gap-1 transition-colors"
                  >
                    <Trash size={14} weight="light" />
                    <span>Delete</span>
                  </button>
                )}
              </div>

              {/* Expandable Effects Lab Drawer (Part 2) */}
              {activeEffectId === item.id && (
                <EffectPanel
                  recordingId={item.id}
                  recordingTitle={item.title}
                  onSaved={() => {
                    onRefresh()
                    if (onToggleEffects) onToggleEffects(item.id)
                  }}
                  onClose={() => onToggleEffects && onToggleEffects(item.id)}
                />
              )}

              {/* Expandable AI Transcript Drawer (Bonus) */}
              {activeTranscribeId === item.id && (
                <TranscriptDrawer recordingId={item.id} />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
