import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play,
  Pause,
  CaretDown,
  CaretRight,
  FloppyDisk,
  Check,
} from '@phosphor-icons/react'
import {
  DspParameters,
  DEFAULT_DSP_PARAMS,
  loadAndDecodeAudio,
  processAudioPipeline,
  calculatePeakDb,
  createAudioBufferFromSamples,
} from '../lib/wasm-effects'
import { encodeWav } from '../lib/wav-encode'
import { uploadRecording, getAudioUrl } from '../lib/api'

interface EffectPanelProps {
  recordingId: number
  recordingTitle: string
  onSaved: () => void
  onClose: () => void
}

export const EffectPanel: React.FC<EffectPanelProps> = ({
  recordingId,
  recordingTitle,
  onSaved,
}) => {
  const [params, setParams] = useState<DspParameters>(DEFAULT_DSP_PARAMS)
  const [loadingAudio, setLoadingAudio] = useState(true)
  const [processingDsp, setProcessingDsp] = useState(false)
  const [savingWav, setSavingWav] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [showAdvancedGate, setShowAdvancedGate] = useState(false)

  // Comparison Player State
  const [activeTrack, setActiveTrack] = useState<'original' | 'processed'>('processed')
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const [originalPeak, setOriginalPeak] = useState<number>(-100)
  const [processedPeak, setProcessedPeak] = useState<number>(-100)

  // Audio nodes and refs
  const audioCtxRef = useRef<AudioContext | null>(null)
  const originalBufferRef = useRef<AudioBuffer | null>(null)
  const processedBufferRef = useRef<AudioBuffer | null>(null)
  const rawOriginalSamplesRef = useRef<Float32Array | null>(null)
  const rawProcessedSamplesRef = useRef<Float32Array | null>(null)
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const playbackStartTimeRef = useRef<number>(0)
  const playbackOffsetRef = useRef<number>(0)
  const animFrameRef = useRef<number | null>(null)

  // Canvas refs for dual stacked waveforms
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const processedCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // 1. Initialize AudioContext and load audio
  useEffect(() => {
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const audioUrl = getAudioUrl(recordingId)

    setLoadingAudio(true)
    loadAndDecodeAudio(audioUrl, ctx)
      .then((decoded) => {
        originalBufferRef.current = decoded.originalBuffer
        rawOriginalSamplesRef.current = decoded.originalSamples
        setOriginalPeak(calculatePeakDb(decoded.originalSamples))

        // Initial DSP run with defaults
        const processed = processAudioPipeline(
          decoded.originalSamples,
          DEFAULT_DSP_PARAMS,
          decoded.sampleRate
        )
        rawProcessedSamplesRef.current = processed
        processedBufferRef.current = createAudioBufferFromSamples(processed, decoded.sampleRate, ctx)
        setProcessedPeak(calculatePeakDb(processed))
        setLoadingAudio(false)
      })
      .catch((err) => {
        console.error('Failed to load audio for effects:', err)
        setLoadingAudio(false)
      })

    return () => {
      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.stop()
        } catch {}
      }
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      ctx.close().catch(() => {})
    }
  }, [recordingId])

  // 2. Debounced DSP re-computation whenever params change
  useEffect(() => {
    if (!rawOriginalSamplesRef.current || !audioCtxRef.current || loadingAudio) return

    setProcessingDsp(true)
    const timeout = setTimeout(() => {
      const orig = rawOriginalSamplesRef.current!
      const ctx = audioCtxRef.current!
      const processed = processAudioPipeline(orig, params, ctx.sampleRate)

      rawProcessedSamplesRef.current = processed
      processedBufferRef.current = createAudioBufferFromSamples(processed, ctx.sampleRate, ctx)
      setProcessedPeak(calculatePeakDb(processed))
      setProcessingDsp(false)

      // If currently playing processed track, seamlessly swap source
      if (isPlaying && activeTrack === 'processed') {
        swapActiveBuffer('processed')
      }
    }, 150)

    return () => clearTimeout(timeout)
  }, [params, loadingAudio])

  // Draw waveform helper
  const drawWaveform = useCallback(
    (canvas: HTMLCanvasElement | null, samples: Float32Array | null, color: string) => {
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const w = canvas.width
      const h = canvas.height
      const mid = h / 2
      ctx.clearRect(0, 0, w, h)

      // Center hairline
      ctx.strokeStyle = '#D8CDAE'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(w, mid)
      ctx.stroke()

      if (!samples || samples.length === 0) {
        // Flat dashed line when loading
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = '#8A907C'
        ctx.beginPath()
        ctx.moveTo(0, mid)
        ctx.lineTo(w, mid)
        ctx.stroke()
        ctx.setLineDash([])
        return
      }

      ctx.fillStyle = color
      const step = Math.ceil(samples.length / w)
      const amp = (h - 8) / 2

      for (let i = 0; i < w; i++) {
        let min = 1.0
        let max = -1.0
        for (let j = 0; j < step; j++) {
          const datum = samples[i * step + j]
          if (datum < min) min = datum
          if (datum > max) max = datum
        }
        const barH = Math.max(2, (max - min) * amp)
        ctx.fillRect(i, mid - barH / 2, 1, barH)
      }
    },
    []
  )

  // Re-draw waveforms
  useEffect(() => {
    drawWaveform(originalCanvasRef.current, rawOriginalSamplesRef.current, '#5F6F52') // --moss
    drawWaveform(processedCanvasRef.current, rawProcessedSamplesRef.current, '#748DA6') // --dusk
  }, [rawOriginalSamplesRef.current, rawProcessedSamplesRef.current, drawWaveform, processingDsp])

  // 3. Audio Playback Engine (seamless A/B swap preserving playhead position)
  const playFromOffset = (offsetSec: number, track: 'original' | 'processed') => {
    const ctx = audioCtxRef.current
    if (!ctx) return

    if (ctx.state === 'suspended') ctx.resume()

    const buffer = track === 'original' ? originalBufferRef.current : processedBufferRef.current
    if (!buffer) return

    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop()
      } catch {}
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)

    const safeOffset = Math.max(0, Math.min(buffer.duration, offsetSec))
    source.start(0, safeOffset)

    playbackStartTimeRef.current = ctx.currentTime
    playbackOffsetRef.current = safeOffset
    activeSourceRef.current = source
    setIsPlaying(true)

    source.onended = () => {
      // Check if finished naturally
      if (ctx.currentTime - playbackStartTimeRef.current + playbackOffsetRef.current >= buffer.duration) {
        setIsPlaying(false)
        setPlaybackProgress(0)
        playbackOffsetRef.current = 0
      }
    }
  }

  const stopPlayback = () => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop()
      } catch {}
      activeSourceRef.current = null
    }
    const ctx = audioCtxRef.current
    if (ctx) {
      const elapsed = ctx.currentTime - playbackStartTimeRef.current
      playbackOffsetRef.current += elapsed
    }
    setIsPlaying(false)
  }

  const swapActiveBuffer = (newTrack: 'original' | 'processed') => {
    setActiveTrack(newTrack)
    if (isPlaying && audioCtxRef.current) {
      const elapsed = audioCtxRef.current.currentTime - playbackStartTimeRef.current
      const currentOffset = playbackOffsetRef.current + elapsed
      playFromOffset(currentOffset, newTrack)
    }
  }

  // Animation frame for shared playhead tracking
  useEffect(() => {
    const updatePlayhead = () => {
      if (isPlaying && audioCtxRef.current) {
        const buffer = activeTrack === 'original' ? originalBufferRef.current : processedBufferRef.current
        if (buffer && buffer.duration > 0) {
          const elapsed = audioCtxRef.current.currentTime - playbackStartTimeRef.current
          const currentSec = playbackOffsetRef.current + elapsed
          const pct = Math.min(1, currentSec / buffer.duration)
          setPlaybackProgress(pct)
        }
      }
      animFrameRef.current = requestAnimationFrame(updatePlayhead)
    }

    animFrameRef.current = requestAnimationFrame(updatePlayhead)
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isPlaying, activeTrack])

  // 4. Save Processed Audio as New Recording
  const handleSaveAsNew = async () => {
    if (!rawProcessedSamplesRef.current || !audioCtxRef.current) return
    setSavingWav(true)

    try {
      const wavBlob = encodeWav(rawProcessedSamplesRef.current, audioCtxRef.current.sampleRate, 1)
      const durationMs = Math.round((rawProcessedSamplesRef.current.length / audioCtxRef.current.sampleRate) * 1000)

      const formData = new FormData()
      formData.append('blob', wavBlob, 'processed.wav')
      formData.append('title', `${recordingTitle} (Processed)`)
      formData.append('duration_ms', durationMs.toString())
      formData.append('sample_rate', audioCtxRef.current.sampleRate.toString())
      formData.append('content_type', 'audio/wav')

      await uploadRecording(formData)
      setSavingWav(false)
      setSavedSuccess(true)
      setTimeout(() => {
        onSaved()
      }, 700)
    } catch (err: any) {
      alert(`Failed to save processed audio: ${err.message}`)
      setSavingWav(false)
    }
  }

  return (
    <div className="mt-4 rounded-[3px] border border-rule bg-paper-2 p-5 text-ink relative overflow-hidden">
      {/* Top thin progress line during processing */}
      {processingDsp && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-dusk animate-pulse" />
      )}

      {/* Eyebrow & Title */}
      <div className="flex items-center justify-between border-b border-rule pb-3 mb-5">
        <div>
          <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">03 / PROCESS</span>
          <h4 className="font-display text-xl text-ink">Effects lab</h4>
        </div>
        <div className="flex items-center gap-3">
          {savedSuccess && (
            <span className="flex items-center gap-1 font-mono text-xs text-moss font-medium">
              <Check size={14} weight="bold" /> Saved ✓
            </span>
          )}
          <button
            type="button"
            onClick={handleSaveAsNew}
            disabled={savingWav || loadingAudio}
            className="flex items-center gap-1.5 rounded-[3px] bg-dusk px-3.5 py-1.5 text-xs font-sans font-medium text-paper hover:opacity-95 btn-press disabled:opacity-50"
          >
            <FloppyDisk size={14} weight="light" />
            <span>{savingWav ? 'Encoding WAV…' : 'Save as new recording'}</span>
          </button>
        </div>
      </div>

      {/* 2×3 Controls Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* Module 1: Gain */}
        <div
          className={`rounded-[3px] border border-rule bg-sheet p-3 transition-colors ${
            params.gainDb !== 0 ? 'border-l-2 border-l-dusk' : ''
          }`}
        >
          <div className="flex justify-between items-center text-xs font-mono mb-2">
            <span className="text-ink-3">GAIN</span>
            <span className="text-ink font-medium">
              {params.gainDb > 0 ? `+${params.gainDb.toFixed(1)}` : params.gainDb.toFixed(1)} dB
            </span>
          </div>
          <input
            type="range"
            min="-24"
            max="24"
            step="0.5"
            value={params.gainDb}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              // Snap near zero
              setParams((p) => ({ ...p, gainDb: Math.abs(val) < 0.8 ? 0 : val }))
            }}
            className="w-full accent-dusk cursor-pointer h-1.5 bg-paper-2 rounded-none"
          />
          <div className="flex justify-between text-[10px] font-mono text-ink-3 mt-1">
            <span>-24dB</span>
            <span>0</span>
            <span>+24dB</span>
          </div>
        </div>

        {/* Module 2: Peak Normalize */}
        <div
          className={`rounded-[3px] border border-rule bg-sheet p-3 transition-colors ${
            params.normalizeEnabled ? 'border-l-2 border-l-dusk' : ''
          }`}
        >
          <div className="flex justify-between items-center text-xs font-mono mb-2">
            <span className="text-ink-3">NORMALIZE</span>
            <button
              type="button"
              onClick={() => setParams((p) => ({ ...p, normalizeEnabled: !p.normalizeEnabled }))}
              className={`h-4 w-7 rounded-[2px] transition-colors relative flex items-center p-0.5 ${
                params.normalizeEnabled ? 'bg-moss' : 'bg-paper-2 border border-rule'
              }`}
            >
              <div
                className={`h-3 w-3 bg-paper shadow-xs transition-transform ${
                  params.normalizeEnabled ? 'translate-x-2.5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-3 whitespace-nowrap">
            <label className="text-[11px] font-mono text-ink-3 shrink-0">Target:</label>
            <input
              type="number"
              step="0.5"
              max="0"
              min="-12"
              value={params.normalizeTargetDb}
              disabled={!params.normalizeEnabled}
              onChange={(e) => setParams((p) => ({ ...p, normalizeTargetDb: parseFloat(e.target.value) || -1 }))}
              className="w-12 border border-rule bg-paper-2 px-1 py-0.5 font-mono text-xs text-ink rounded-[2px] disabled:opacity-40 text-center"
            />
            <span className="font-mono text-[10px] text-ink-3 shrink-0">dBFS</span>
          </div>
        </div>

        {/* Module 3: Mono Mixdown */}
        <div
          className={`rounded-[3px] border border-rule bg-sheet p-3 transition-colors ${
            params.monoMixdown ? 'border-l-2 border-l-dusk' : ''
          }`}
        >
          <div className="flex justify-between items-center text-xs font-mono mb-2">
            <span className="text-ink-3">MONO MIXDOWN</span>
            <button
              type="button"
              onClick={() => setParams((p) => ({ ...p, monoMixdown: !p.monoMixdown }))}
              className={`h-4 w-7 rounded-[2px] transition-colors relative flex items-center p-0.5 ${
                params.monoMixdown ? 'bg-moss' : 'bg-paper-2 border border-rule'
              }`}
            >
              <div
                className={`h-3 w-3 bg-paper shadow-xs transition-transform ${
                  params.monoMixdown ? 'translate-x-2.5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <p className="text-[11px] font-sans text-ink-2 mt-3">
            Folds multichannel audio into a balanced single mono stream.
          </p>
        </div>

        {/* Module 4: Noise Gate */}
        <div
          className={`rounded-[3px] border border-rule bg-sheet p-3 transition-colors ${
            params.noiseGateEnabled ? 'border-l-2 border-l-dusk' : ''
          }`}
        >
          <div className="flex justify-between items-center text-xs font-mono mb-1">
            <span className="text-ink-3">NOISE GATE</span>
            <button
              type="button"
              onClick={() => setParams((p) => ({ ...p, noiseGateEnabled: !p.noiseGateEnabled }))}
              className={`h-4 w-7 rounded-[2px] transition-colors relative flex items-center p-0.5 ${
                params.noiseGateEnabled ? 'bg-moss' : 'bg-paper-2 border border-rule'
              }`}
            >
              <div
                className={`h-3 w-3 bg-paper shadow-xs transition-transform ${
                  params.noiseGateEnabled ? 'translate-x-2.5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <div className="flex justify-between items-center text-[11px] font-mono text-ink-2 my-1">
            <span>Threshold</span>
            <span>{params.noiseGateThresholdDb} dB</span>
          </div>
          <input
            type="range"
            min="-60"
            max="-10"
            step="1"
            disabled={!params.noiseGateEnabled}
            value={params.noiseGateThresholdDb}
            onChange={(e) => setParams((p) => ({ ...p, noiseGateThresholdDb: parseFloat(e.target.value) }))}
            className="w-full accent-dusk cursor-pointer h-1.5 bg-paper-2 rounded-none disabled:opacity-40"
          />

          <button
            type="button"
            onClick={() => setShowAdvancedGate(!showAdvancedGate)}
            className="mt-2 flex items-center gap-1 text-[10px] font-mono text-ink-3 hover:text-ink"
          >
            {showAdvancedGate ? <CaretDown size={10} /> : <CaretRight size={10} />}
            <span>Advanced (attack/release)</span>
          </button>

          {showAdvancedGate && (
            <div className="mt-2 pt-2 border-t border-rule/60 grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div>
                <span className="text-ink-3">Attack win:</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={params.noiseGateAttack}
                  onChange={(e) => setParams((p) => ({ ...p, noiseGateAttack: parseInt(e.target.value) || 1 }))}
                  className="w-full border border-rule bg-paper-2 p-1 text-xs"
                />
              </div>
              <div>
                <span className="text-ink-3">Release win:</span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={params.noiseGateRelease}
                  onChange={(e) => setParams((p) => ({ ...p, noiseGateRelease: parseInt(e.target.value) || 1 }))}
                  className="w-full border border-rule bg-paper-2 p-1 text-xs"
                />
              </div>
            </div>
          )}
        </div>

        {/* Module 5: Voice Anonymizer (Pitch Shift) */}
        <div
          className={`rounded-[3px] border border-rule bg-sheet p-3 transition-colors ${
            params.pitchSemitones !== 0 ? 'border-l-2 border-l-dusk' : ''
          }`}
        >
          <div className="flex justify-between items-center text-xs font-mono mb-1">
            <span className="text-ink-3">ANONYMIZER</span>
            <span className="text-ink font-medium whitespace-nowrap text-xs tabular-nums shrink-0">
              {params.pitchSemitones > 0 ? `+${params.pitchSemitones} st` : `${params.pitchSemitones} st`}
            </span>
          </div>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            value={params.pitchSemitones}
            onChange={(e) => setParams((p) => ({ ...p, pitchSemitones: parseInt(e.target.value) }))}
            className="w-full accent-dusk cursor-pointer h-1.5 bg-paper-2 rounded-none mt-2"
          />
          <div className="flex justify-between text-[10px] font-mono text-ink-3 mt-1">
            <span>-12 st</span>
            <span>0</span>
            <span>+12 st</span>
          </div>
        </div>
      </div>

      {/* Comparison Player (A/B Test) */}
      <div className="rounded-[3px] border border-rule bg-sheet p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-3">
            {/* Play/Pause Button */}
            <button
              type="button"
              onClick={() => {
                if (isPlaying) stopPlayback()
                else playFromOffset(playbackOffsetRef.current, activeTrack)
              }}
              disabled={loadingAudio}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-paper hover:opacity-90 btn-press"
            >
              {isPlaying ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" className="ml-0.5" />}
            </button>

            {/* Segmented A/B Switch: Original (moss) vs Processed (dusk) */}
            <div className="inline-flex rounded-[2px] border border-rule p-[2px] bg-paper-2 text-[11px] font-sans">
              <button
                type="button"
                onClick={() => swapActiveBuffer('original')}
                className={`px-2.5 py-0.5 font-medium transition-colors ${
                  activeTrack === 'original'
                    ? 'bg-moss text-paper rounded-[2px]'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Original
              </button>
              <button
                type="button"
                onClick={() => swapActiveBuffer('processed')}
                className={`px-2.5 py-0.5 font-medium transition-colors ${
                  activeTrack === 'processed'
                    ? 'bg-dusk text-paper rounded-[2px]'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Processed
              </button>
            </div>
          </div>

          {/* Peak Level Readouts */}
          <div className="flex items-center gap-3 text-[11px] font-mono text-ink-3 shrink-0 whitespace-nowrap">
            <span className="whitespace-nowrap">
              Orig Peak: <strong className="text-ink tabular-nums">{originalPeak.toFixed(1)} dBFS</strong>
            </span>
            <span className="text-rule">|</span>
            <span className="whitespace-nowrap">
              Proc Peak: <strong className="text-dusk tabular-nums">{processedPeak.toFixed(1)} dBFS</strong>
            </span>
          </div>
        </div>

        {/* Dual Stacked Waveforms with Shared Clay Playhead */}
        <div className="relative flex flex-col gap-2 bg-paper-2/60 p-2 border border-rule">
          {/* Shared Clay Playhead Line */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-clay z-10 pointer-events-none transition-all duration-75"
            style={{ left: `calc(${playbackProgress * 100}% + 8px)` }}
          />

          {/* Top Waveform: Original (Moss) */}
          <div className="relative">
            <span className="absolute top-1 left-2 font-mono text-[9px] text-moss uppercase tracking-wider select-none">
              Original Track
            </span>
            <canvas ref={originalCanvasRef} width={640} height={56} className="h-14 w-full block bg-sheet" />
          </div>

          {/* Bottom Waveform: Processed (Dusk) */}
          <div className="relative">
            <span className="absolute top-1 left-2 font-mono text-[9px] text-dusk uppercase tracking-wider select-none">
              Processed Track
            </span>
            <canvas ref={processedCanvasRef} width={640} height={56} className="h-14 w-full block bg-sheet" />
          </div>
        </div>
      </div>
    </div>
  )
}
