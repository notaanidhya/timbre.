import React, { useEffect, useRef } from 'react'
import { rms_level } from 'timbre_kit'

interface WaveformMeterProps {
  analyser: AnalyserNode | null
  isRecording: boolean
}

const TOTAL_SEGMENTS = 32
const PEAK_THRESHOLD = 0.8 // Top 20% turns clay

export const WaveformMeter: React.FC<WaveformMeterProps> = ({ analyser, isRecording }) => {
  const ladderRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const smoothedLevelRef = useRef<number>(0)
  const waveHistoryRef = useRef<number[]>([])

  useEffect(() => {
    let animId: number
    const dataArray = new Float32Array(analyser ? analyser.fftSize : 256)

    const updateFrame = () => {
      let currentRms = 0

      if (analyser && isRecording) {
        analyser.getFloatTimeDomainData(dataArray)
        currentRms = rms_level(dataArray)
      }

      // Fast attack (0.6), slow release (0.08) smoothing
      const prev = smoothedLevelRef.current
      const smoothed = currentRms > prev ? prev + (currentRms - prev) * 0.6 : prev + (currentRms - prev) * 0.08
      smoothedLevelRef.current = Math.max(0, Math.min(1, smoothed))

      // 1. Update 32-segment LED ladder directly on DOM elements
      if (ladderRef.current) {
        const segments = ladderRef.current.children
        const activeCount = Math.round(smoothedLevelRef.current * TOTAL_SEGMENTS)
        const peakIndex = Math.floor(TOTAL_SEGMENTS * PEAK_THRESHOLD)

        for (let i = 0; i < TOTAL_SEGMENTS; i++) {
          const el = segments[i] as HTMLElement
          if (!el) continue

          if (i < activeCount) {
            if (i >= peakIndex) {
              el.style.backgroundColor = 'var(--color-clay)' // upper 20% clay
            } else {
              el.style.backgroundColor = 'var(--color-sage)' // lower 80% sage
            }
          } else {
            el.style.backgroundColor = 'var(--color-paper-2)' // unlit paper-2
          }
        }
      }

      // 2. Update mini waveform strip (scrolling right to left)
      if (canvasRef.current) {
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const width = canvas.width
          const height = canvas.height
          const midY = height / 2

          if (isRecording) {
            waveHistoryRef.current.push(smoothedLevelRef.current)
            if (waveHistoryRef.current.length > width) {
              waveHistoryRef.current.shift()
            }
          } else if (waveHistoryRef.current.length > 0) {
            waveHistoryRef.current.push(0)
            if (waveHistoryRef.current.length > width) {
              waveHistoryRef.current.shift()
            }
          }

          ctx.clearRect(0, 0, width, height)

          // Center hairline
          ctx.strokeStyle = '#D8CDAE'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(0, midY)
          ctx.lineTo(width, midY)
          ctx.stroke()

          // Draw vertical 1px bars in --moss
          ctx.fillStyle = '#5F6F52'
          const history = waveHistoryRef.current
          const startX = width - history.length

          for (let i = 0; i < history.length; i++) {
            const barH = Math.max(2, history[i] * (height - 6))
            ctx.fillRect(startX + i, midY - barH / 2, 1, barH)
          }
        }
      }

      animId = requestAnimationFrame(updateFrame)
    }

    animId = requestAnimationFrame(updateFrame)

    return () => {
      cancelAnimationFrame(animId)
    }
  }, [analyser, isRecording])

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* 32-segment LED ladder */}
      <div className="flex items-center justify-between text-[10px] font-mono text-ink-3 mb-1">
        <span>VU METER</span>
        <span>-24dB · 0dB · +3dB</span>
      </div>
      <div ref={ladderRef} className="flex h-3 w-full gap-[2px]">
        {Array.from({ length: TOTAL_SEGMENTS }).map((_, i) => (
          <div
            key={i}
            className="flex-1 transition-colors duration-75"
            style={{ backgroundColor: 'var(--color-paper-2)' }}
          />
        ))}
      </div>

      {/* 48px Mini Waveform Canvas Strip */}
      <div className="relative mt-2 h-12 w-full border border-rule bg-sheet">
        <canvas
          ref={canvasRef}
          width={360}
          height={48}
          className="h-full w-full block"
        />
      </div>
    </div>
  )
}
