export interface RecordingItemData {
  id: number
  title: string
  duration_ms: number | null
  size_bytes: number | null
  content_type: string
  sample_rate: number | null
  session_id: string | null
  participant: string | null
  inserted_at: string
  updated_at: string
}

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export async function fetchRecordings(): Promise<RecordingItemData[]> {
  const res = await fetch(`${API_BASE}/api/recordings`)
  if (!res.ok) throw new Error(`Failed to fetch recordings: ${res.statusText}`)
  const data = await res.json()
  return data.recordings || []
}

export async function uploadRecording(formData: FormData): Promise<{ id: number; title: string }> {
  const res = await fetch(`${API_BASE}/api/recordings`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const errorJson = await res.json().catch(() => null)
    const errorMsg = errorJson?.errors ? JSON.stringify(errorJson.errors) : res.statusText
    throw new Error(`Upload failed (${res.status}): ${errorMsg}`)
  }
  return res.json()
}

export async function deleteRecording(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/recordings/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete recording ${id}: ${res.statusText}`)
  }
}

export function getAudioUrl(id: number): string {
  return `${API_BASE}/api/recordings/${id}/audio`
}

export interface TranscriptData {
  status: 'not_requested' | 'pending' | 'processing' | 'done' | 'error'
  text: string | null
  summary: string | null
  title: string | null
  error: string | null
}

export async function requestTranscription(id: number): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/api/recordings/${id}/transcribe`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Transcription request failed: ${res.statusText}`)
  return res.json()
}

export async function getTranscript(id: number): Promise<TranscriptData> {
  const res = await fetch(`${API_BASE}/api/recordings/${id}/transcript`)
  if (!res.ok) throw new Error(`Failed to load transcript: ${res.statusText}`)
  return res.json()
}

