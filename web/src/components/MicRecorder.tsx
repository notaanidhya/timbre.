import React, { useState, useEffect, useRef } from 'react'
import {
  Pause,
  Play,
  WarningCircle,
} from '@phosphor-icons/react'
import { WaveformMeter } from './WaveformMeter'
import { startAudioCapture, AudioCaptureSession } from '../lib/audio-capture'
import { uploadRecording } from '../lib/api'

interface MicRecorderProps {
  onRecordingSaved: () => void
}

type RecorderState = 'idle' | 'recording' | 'paused' | 'recorded_preview' | 'uploading'

export const MicRecorder: React.FC<MicRecorderProps> = ({ onRecordingSaved }) => {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [detectedMime, setDetectedMime] = useState('')
  const [sampleRate, setSampleRate] = useState<number>(48000)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false)
  const [previewCurrentTimeMs, setPreviewCurrentTimeMs] = useState(0)

  const sessionRef = useRef<AudioCaptureSession | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerIntervalRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)
  const pausedTimeRef = useRef<number>(0)
  const audioPreviewUrlRef = useRef<string | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  // Format MM:SS.ms (two decimal milliseconds)
  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSec / 60)
    const seconds = totalSec % 60
    const centiseconds = Math.floor((ms % 1000) / 10)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`
  }

  const startTimer = () => {
    startTimeRef.current = Date.now() - pausedTimeRef.current
    timerIntervalRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current)
    }, 25)
  }

  const pauseTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    pausedTimeRef.current = Date.now() - startTimeRef.current
  }

  const stopTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    pausedTimeRef.current = 0
  }

  const handleStartRecording = async () => {
    setErrorMsg(null)
    chunksRef.current = []
    try {
      const session = await startAudioCapture((chunk) => {
        chunksRef.current.push(chunk)
      })
      sessionRef.current = session
      setDetectedMime(session.mimeType)
      setSampleRate(session.sampleRate)

      session.recorder.start(100) // 100ms slices for smooth capture
      setState('recording')
      startTimer()
    } catch (err: any) {
      setErrorMsg(err.message || 'Microphone access denied. Check your browser address bar permissions.')
    }
  }

  const handlePauseResume = () => {
    if (!sessionRef.current) return
    const { recorder } = sessionRef.current

    if (state === 'recording') {
      recorder.pause()
      pauseTimer()
      setState('paused')
    } else if (state === 'paused') {
      recorder.resume()
      startTimer()
      setState('recording')
    }
  }

  const handleStopRecording = () => {
    if (!sessionRef.current) return
    const session = sessionRef.current
    stopTimer()

    session.recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: session.mimeType })
      setRecordedBlob(blob)
      if (audioPreviewUrlRef.current) URL.revokeObjectURL(audioPreviewUrlRef.current)
      audioPreviewUrlRef.current = URL.createObjectURL(blob)

      const now = new Date()
      const defaultTitle = `Recording ${now.toISOString().slice(0, 10)} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      setTitle(defaultTitle)
      setIsPreviewPlaying(false)
      setPreviewCurrentTimeMs(0)
      setState('recorded_preview')
    }

    session.stop()
    sessionRef.current = null
  }

  const handleDiscard = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current.currentTime = 0
    }
    if (audioPreviewUrlRef.current) {
      URL.revokeObjectURL(audioPreviewUrlRef.current)
      audioPreviewUrlRef.current = null
    }
    setIsPreviewPlaying(false)
    setPreviewCurrentTimeMs(0)
    setRecordedBlob(null)
    setElapsedMs(0)
    setState('idle')
  }

  const handleSaveUpload = async () => {
    if (!recordedBlob) return
    setState('uploading')
    setUploadProgress(20)

    try {
      const formData = new FormData()
      formData.append('blob', recordedBlob, 'audio-take')
      formData.append('title', title.trim() || 'Untitled Recording')
      formData.append('duration_ms', Math.round(elapsedMs).toString())
      formData.append('sample_rate', sampleRate.toString())
      formData.append('content_type', detectedMime)

      setUploadProgress(60)
      await uploadRecording(formData)
      setUploadProgress(100)

      setTimeout(() => {
        handleDiscard()
        onRecordingSaved()
      }, 300)
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save recording')
      setState('recorded_preview')
      setUploadProgress(0)
    }
  }

  // Keyboard shortcut: Space to start / stop recording
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return

      if (e.code === 'Space') {
        e.preventDefault()
        if (state === 'idle') handleStartRecording()
        else if (state === 'recording' || state === 'paused') handleStopRecording()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) sessionRef.current.stop()
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
      if (audioPreviewUrlRef.current) URL.revokeObjectURL(audioPreviewUrlRef.current)
    }
  }, [])

  return (
    <section className="relative rounded-[3px] border border-rule bg-sheet p-6 panel-shadow dot-grid">
      {/* Eyebrow & Section Heading */}
      <div className="flex items-center justify-between border-b border-rule pb-3 mb-6">
        <div>
          <span className="font-mono text-[11px] text-ink-3 tracking-widest uppercase">01 / RECORD</span>
          <h2 className="font-display text-2xl tracking-tight text-ink mt-0.5">Capture a take</h2>
        </div>
        {detectedMime && (
          <span className="font-mono text-[10px] text-ink-2 bg-paper-2 border border-rule px-1.5 py-0.5 rounded-[2px]">
            {detectedMime.replace('codecs=', '')}
          </span>
        )}
      </div>

      {/* Permission or runtime error */}
      {errorMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-[3px] border border-brick/40 bg-rose p-3 text-xs font-mono text-brick">
          <WarningCircle size={16} weight="bold" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Timer 56px mono with tabular numerals */}
      <div className="flex flex-col items-center justify-center my-4">
        <div
          className={`font-mono text-5xl font-medium tracking-tight tabular-nums transition-colors duration-200 ${
            state === 'recording'
              ? 'text-ink'
              : state === 'paused'
              ? 'text-clay animate-pulse'
              : 'text-ink-3'
          }`}
        >
          {formatTime(elapsedMs)}
        </div>
        <div className="font-mono text-[11px] text-ink-3 mt-1 uppercase tracking-wider">
          {state === 'recording' ? '● RECORDING' : state === 'paused' ? '◐ PAUSED' : '○ IDLE'}
        </div>
      </div>

      {/* Segmented LED VU Meter & Mini Waveform Strip */}
      <div className="my-6">
        <WaveformMeter
          analyser={sessionRef.current?.analyser || null}
          isRecording={state === 'recording'}
        />
      </div>

      {/* Recording Controls */}
      <div className="flex flex-col items-center gap-4 mt-6">
        <div className="flex items-center justify-center gap-6">
          {/* Pause / Resume Button (40px square outline) */}
          {(state === 'recording' || state === 'paused') && (
            <button
              type="button"
              onClick={handlePauseResume}
              title={state === 'recording' ? 'Pause Take' : 'Resume Take'}
              className="flex h-10 w-10 items-center justify-center rounded-[3px] border border-rule bg-paper-2 text-ink hover:border-ink-2 btn-press"
            >
              {state === 'recording' ? <Pause size={18} weight="light" /> : <Play size={18} weight="light" />}
            </button>
          )}

          {/* Main 72px Circle Record / Stop Button with Breathing Outer Ring */}
          <div className="relative flex items-center justify-center">
            {state === 'recording' && (
              <span className="absolute inset-0 -m-1.5 rounded-full border-2 border-clay opacity-80 animate-ping" />
            )}
            <button
              type="button"
              onClick={state === 'recording' || state === 'paused' ? handleStopRecording : handleStartRecording}
              disabled={state === 'uploading'}
              className={`relative flex h-[72px] w-[72px] items-center justify-center rounded-full transition-transform btn-press ${
                state === 'recording' || state === 'paused'
                  ? 'bg-clay hover:bg-clay-deep text-paper shadow-md'
                  : 'bg-clay hover:bg-clay-deep text-paper shadow-md'
              }`}
            >
              {state === 'recording' || state === 'paused' ? (
                <div className="h-6 w-6 rounded-[3px] bg-paper" />
              ) : (
                <div className="h-6 w-6 rounded-full bg-paper" />
              )}
            </button>
          </div>
        </div>

        {/* Keyboard hint */}
        <p className="font-mono text-[11px] text-ink-3">
          press <span className="border-b border-ink-3 text-ink-2">space</span> to {state === 'recording' ? 'stop' : 'start'}
        </p>
      </div>

      {/* Save Card (Slides down when state === 'recorded_preview' or 'uploading') */}
      {(state === 'recorded_preview' || state === 'uploading') && (
        <div className="mt-8 border-t border-rule pt-5 transition-all duration-200">
          <div className="flex flex-col gap-3">
            <label className="font-mono text-[11px] text-ink-3 uppercase">Take Details</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={state === 'uploading'}
              placeholder="Recording title..."
              className="w-full border-b border-rule bg-transparent py-1.5 font-display text-lg text-ink placeholder:font-sans placeholder:text-sm placeholder:text-ink-3 focus:border-dusk focus:outline-none"
            />

            {/* Custom Field Recorder Audio Preview Player */}
            {audioPreviewUrlRef.current && (
              <div className="mt-2 flex flex-col gap-2 rounded-[3px] border border-rule bg-paper-2 p-3">
                <audio
                  ref={previewAudioRef}
                  src={audioPreviewUrlRef.current}
                  preload="auto"
                  onPlay={() => setIsPreviewPlaying(true)}
                  onPause={() => setIsPreviewPlaying(false)}
                  onTimeUpdate={() => {
                    if (previewAudioRef.current) {
                      setPreviewCurrentTimeMs(previewAudioRef.current.currentTime * 1000)
                    }
                  }}
                  onEnded={() => {
                    setIsPreviewPlaying(false)
                    setPreviewCurrentTimeMs(0)
                    if (previewAudioRef.current) {
                      previewAudioRef.current.currentTime = 0
                    }
                  }}
                  className="hidden"
                />

                <div className="flex items-center gap-3">
                  {/* Play / Pause Toggle Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!previewAudioRef.current) return
                      if (isPreviewPlaying) {
                        previewAudioRef.current.pause()
                      } else {
                        previewAudioRef.current.play().catch(console.error)
                      }
                    }}
                    disabled={state === 'uploading'}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-rule bg-paper text-ink hover:border-ink-2 hover:bg-paper-2 transition-colors btn-press"
                    title={isPreviewPlaying ? 'Pause Preview' : 'Play Preview'}
                  >
                    {isPreviewPlaying ? (
                      <Pause size={14} weight="fill" className="text-clay" />
                    ) : (
                      <Play size={14} weight="fill" className="ml-0.5 text-ink" />
                    )}
                  </button>

                  {/* Scrubber Bar starting at 0:00 on the left */}
                  <div
                    className="group relative flex-1 h-3 flex items-center cursor-pointer select-none"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                      const targetMs = fraction * elapsedMs
                      setPreviewCurrentTimeMs(targetMs)
                      if (previewAudioRef.current) {
                        previewAudioRef.current.currentTime = targetMs / 1000
                      }
                    }}
                  >
                    {/* Track Background */}
                    <div className="h-1.5 w-full rounded-full bg-rule relative overflow-hidden group-hover:h-2 transition-all">
                      {/* Scrubber Progress Fill - starts at 0% */}
                      <div
                        className="h-full bg-clay transition-[width] duration-75"
                        style={{
                          width: `${Math.max(0, Math.min(100, (previewCurrentTimeMs / (elapsedMs || 1)) * 100))}%`,
                        }}
                      />
                    </div>
                    {/* Scrubber Thumb Knob */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-paper border border-clay shadow-xs pointer-events-none transition-transform group-hover:scale-110"
                      style={{
                        left: `calc(${Math.max(0, Math.min(100, (previewCurrentTimeMs / (elapsedMs || 1)) * 100))}% - 6px)`,
                      }}
                    />
                  </div>

                  {/* Tabular Time Readout (0:00.00 / MM:SS.ms) */}
                  <div className="shrink-0 font-mono text-[11px] tabular-nums text-ink-2 tracking-tight">
                    <span className="text-ink font-medium">{formatTime(previewCurrentTimeMs)}</span>
                    <span className="text-ink-3 mx-1">/</span>
                    <span>{formatTime(elapsedMs)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Save & Discard Buttons */}
            <div className="mt-3 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={handleDiscard}
                disabled={state === 'uploading'}
                className="text-xs font-sans text-ink-3 hover:text-brick underline underline-offset-4 disabled:opacity-40"
              >
                Discard take
              </button>

              <button
                type="button"
                onClick={handleSaveUpload}
                disabled={state === 'uploading'}
                className="relative overflow-hidden rounded-[3px] bg-moss px-5 py-2.5 text-xs font-sans font-medium text-paper hover:opacity-95 btn-press disabled:opacity-70"
              >
                <span>{state === 'uploading' ? 'Uploading…' : 'Save & Upload'}</span>

                {/* Bottom 2px progress bar during upload (no spinner) */}
                {state === 'uploading' && (
                  <span
                    className="absolute bottom-0 left-0 h-[2px] bg-paper transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
