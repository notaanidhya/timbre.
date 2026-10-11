import React, { useState, useEffect, useRef } from 'react'
import { Copy, Check, WarningCircle, ArrowClockwise } from '@phosphor-icons/react'
import { TranscriptData, getTranscript, requestTranscription } from '../lib/api'

interface TranscriptDrawerProps {
  recordingId: number
}

export const TranscriptDrawer: React.FC<TranscriptDrawerProps> = ({ recordingId }) => {
  const [data, setData] = useState<TranscriptData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const pollTimerRef = useRef<number | null>(null)

  const fetchStatus = async () => {
    try {
      const res = await getTranscript(recordingId)
      setData(res)
      setLoading(false)

      // Keep polling if pending or processing
      if (res.status === 'pending' || res.status === 'processing') {
        pollTimerRef.current = window.setTimeout(fetchStatus, 2000)
      }
    } catch {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [recordingId])

  const handleStartTranscribe = async () => {
    setLoading(true)
    try {
      await requestTranscription(recordingId)
      setData((prev) => ({
        status: 'processing',
        text: prev?.text || null,
        summary: prev?.summary || null,
        title: prev?.title || null,
        error: null,
      }))
      setLoading(false)
      pollTimerRef.current = window.setTimeout(fetchStatus, 1500)
    } catch (err: any) {
      alert(`Transcription trigger failed: ${err.message}`)
      setLoading(false)
    }
  }

  const handleCopyText = () => {
    if (data?.text) {
      navigator.clipboard.writeText(data.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const status = data?.status || 'not_requested'

  return (
    <div className="mt-4 rounded-[3px] border border-rule bg-sheet p-6 text-ink shadow-xs">
      {/* Header strip with 04 / TRANSCRIBE and status indicator */}
      <div className="flex items-center justify-between border-b border-rule pb-3 mb-5">
        <div>
          <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">04 / TRANSCRIBE</span>
          <h4 className="font-display text-xl text-ink">Typed transcript & take summary</h4>
        </div>

        {/* Small mono line with square dot */}
        <div className="flex items-center gap-1.5 font-mono text-xs text-ink-2">
          <span
            className={`h-2 w-2 ${
              status === 'done'
                ? 'bg-moss'
                : status === 'pending' || status === 'processing'
                ? 'bg-clay animate-pulse'
                : status === 'error'
                ? 'bg-brick'
                : 'border border-ink-3 bg-transparent'
            }`}
          />
          <span className="uppercase text-[11px]">
            {status === 'done'
              ? 'done'
              : status === 'processing' || status === 'pending'
              ? 'transcribing…'
              : status === 'error'
              ? 'failed'
              : 'not requested'}
          </span>
        </div>
      </div>

      {/* State 1: Not Requested */}
      {status === 'not_requested' && !loading && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-4">
          <p className="font-display text-lg text-ink">
            Generate verbatim text and an executive take summary powered by Gemini.
          </p>
          <button
            type="button"
            onClick={handleStartTranscribe}
            className="rounded-[3px] bg-moss px-4 py-2 text-xs font-sans font-medium text-paper hover:opacity-95 btn-press shrink-0"
          >
            <span>Transcribe with Gemini</span>
          </button>
        </div>
      )}

      {/* State 2: Processing (Ruled paper lines drawing in sequentially, NO shimmer skeleton) */}
      {(status === 'processing' || status === 'pending' || (loading && !data)) && (
        <div className="py-6 flex flex-col items-center justify-center">
          <div className="w-full max-w-md flex flex-col gap-3 my-4">
            <div className="h-[1px] w-full bg-rule relative overflow-hidden">
              <div className="h-full bg-clay animate-[marquee_1.6s_ease-in-out_infinite]" />
            </div>
            <div className="h-[1px] w-full bg-rule relative overflow-hidden">
              <div className="h-full bg-clay animate-[marquee_1.6s_ease-in-out_infinite_200ms]" />
            </div>
            <div className="h-[1px] w-full bg-rule relative overflow-hidden">
              <div className="h-full bg-clay animate-[marquee_1.6s_ease-in-out_infinite_400ms]" />
            </div>
            <div className="h-[1px] w-full bg-rule relative overflow-hidden">
              <div className="h-full bg-clay animate-[marquee_1.6s_ease-in-out_infinite_600ms]" />
            </div>
          </div>
          <span className="font-mono text-xs text-ink-2 mt-2">Listening to your recording…</span>
        </div>
      )}

      {/* State 3: Error */}
      {status === 'error' && (
        <div className="rounded-[3px] border border-brick/40 bg-rose p-4 text-xs font-mono text-brick flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <WarningCircle size={18} weight="bold" className="shrink-0" />
              <span>{data?.error || 'Transcription failed'}</span>
            </div>
            <button
              type="button"
              onClick={handleStartTranscribe}
              className="flex items-center gap-1 text-ink underline font-bold hover:text-brick shrink-0"
            >
              <ArrowClockwise size={14} /> Try again
            </button>
          </div>

          {data?.error?.includes('GEMINI_API_KEY') && (
            <div className="flex items-center gap-2 pt-2 border-t border-brick/20">
              <input
                type="password"
                placeholder="Paste Gemini API Key here"
                defaultValue={localStorage.getItem('timbre_gemini_api_key') || ''}
                onChange={(e) => localStorage.setItem('timbre_gemini_api_key', e.target.value.trim())}
                className="flex-1 bg-paper px-2 py-1 text-xs border border-rule text-ink rounded-xs font-mono"
              />
              <button
                type="button"
                onClick={handleStartTranscribe}
                className="bg-clay text-paper px-3 py-1 rounded-xs font-sans text-xs font-medium hover:bg-clay-deep shrink-0 btn-press"
              >
                Save & Transcribe
              </button>
            </div>
          )}
        </div>
      )}

      {/* State 4: Done */}
      {status === 'done' && data && (
        <div className="flex flex-col gap-6">
          {/* AI Generated Stamped Title */}
          {data.title && (
            <div className="pt-2">
              <div className="h-[2px] w-12 bg-clay mb-2" />
              <h3 className="font-display text-2xl italic tracking-tight text-ink">
                “{data.title}”
              </h3>
            </div>
          )}

          {/* AI Executive Summary Block with 3px sage left border */}
          {data.summary && (
            <div className="rounded-[2px] border-l-[3px] border-l-sage bg-sheet p-4 border border-rule/50">
              <span className="font-mono text-[10px] text-ink-3 uppercase tracking-wider block mb-1">
                SUMMARY
              </span>
              <p className="font-sans text-base leading-relaxed text-ink font-normal">
                {data.summary}
              </p>
            </div>
          )}

          {/* Full Verbatim Transcript Box */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[11px] text-ink-3 uppercase tracking-wider">
                VERBATIM TRANSCRIPT
              </span>
              <button
                type="button"
                onClick={handleCopyText}
                className="flex items-center gap-1.5 font-mono text-xs text-ink-2 hover:text-ink px-2 py-1 border border-rule rounded-[2px] bg-paper-2 btn-press"
              >
                {copied ? <Check size={14} className="text-moss" /> : <Copy size={14} />}
                <span>{copied ? 'Copied ✓' : 'Copy text'}</span>
              </button>
            </div>

            <div className="h-60 overflow-y-auto rounded-[2px] border border-rule bg-paper-2 p-4 font-mono text-xs leading-relaxed text-ink select-text whitespace-pre-wrap">
              {data.text || 'No text detected in this recording.'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
