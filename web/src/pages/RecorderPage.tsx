import React, { useState, useEffect, useCallback } from 'react'
import { MicRecorder } from '../components/MicRecorder'
import { RecordingsList } from '../components/RecordingsList'
import { RecordingItemData, fetchRecordings } from '../lib/api'

export const RecorderPage: React.FC = () => {
  const [recordings, setRecordings] = useState<RecordingItemData[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [activeEffectId, setActiveEffectId] = useState<number | null>(null)
  const [activeTranscribeId, setActiveTranscribeId] = useState<number | null>(null)

  const loadRecordings = useCallback(async () => {
    try {
      const data = await fetchRecordings()
      setRecordings(data)
    } catch (err) {
      console.warn('Could not load recordings from backend:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRecordings()
  }, [loadRecordings])

  const handleToggleEffects = (id: number) => {
    setActiveEffectId((prev) => (prev === id ? null : id))
    setActiveTranscribeId(null) // Only one drawer active at a time
  }

  const handleToggleTranscribe = (id: number) => {
    setActiveTranscribeId((prev) => (prev === id ? null : id))
    setActiveEffectId(null) // Only one drawer active at a time
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* 2-column layout on desktop: Left (5 cols) sticky recorder, Right (7 cols) library */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
        {/* Left Column: MicRecorder */}
        <div className="lg:col-span-5 lg:sticky lg:top-24">
          <MicRecorder onRecordingSaved={loadRecordings} />
        </div>

        {/* Right Column: RecordingsList */}
        <div className="lg:col-span-7">
          <RecordingsList
            recordings={recordings}
            loading={loading}
            onRefresh={loadRecordings}
            onToggleEffects={handleToggleEffects}
            activeEffectId={activeEffectId}
            onToggleTranscribe={handleToggleTranscribe}
            activeTranscribeId={activeTranscribeId}
          />
        </div>
      </div>
    </div>
  )
}
