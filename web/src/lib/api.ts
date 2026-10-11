import {
  idbSaveRecording,
  idbGetAllRecordings,
  idbGetRecording,
  idbDeleteRecording,
  idbGetBlobUrl,
  idbUpdateTranscript,
} from './idb'

export interface RecordingItemData {
  id: number
  title: string
  duration_ms: number | null
  size_bytes: number | null
  content_type: string
  sample_rate: number | null
  session_id: string | null
  participant: string | null
  client_id?: string | null
  inserted_at: string
  updated_at: string
}

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const isStaticVercelHost =
  typeof window !== 'undefined' &&
  window.location.hostname.endsWith('vercel.app') &&
  !API_BASE

/**
 * Returns a stable, anonymous device/client UUID stored in localStorage.
 * Isolates each visitor's audio studio library so recordings are personal.
 */
export function getClientId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('timbre_client_id')
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `client_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
    localStorage.setItem('timbre_client_id', id)
  }
  return id
}

export async function fetchRecordings(): Promise<RecordingItemData[]> {
  let serverRecordings: RecordingItemData[] = []
  const clientId = getClientId()

  if (!isStaticVercelHost) {
    try {
      const url = `${API_BASE}/api/recordings?client_id=${encodeURIComponent(clientId)}`
      const res = await fetch(url, {
        headers: {
          'X-Client-Id': clientId,
        },
      })
      if (res.ok) {
        const data = await res.json()
        serverRecordings = data.recordings || []
      }
    } catch {
      // Backend offline or unreachable, will fallback to IndexedDB
    }
  }

  // Load client-side IndexedDB recordings (filtered for this client)
  const localRecords = await idbGetAllRecordings()
  const localAsItems: RecordingItemData[] = localRecords
    .filter((r) => !r.client_id || r.client_id === clientId)
    .map((r) => ({
      id: r.id,
      title: r.title,
      duration_ms: r.duration_ms,
      size_bytes: r.size_bytes,
      content_type: r.content_type,
      sample_rate: r.sample_rate,
      session_id: r.session_id,
      participant: r.participant,
      client_id: r.client_id,
      inserted_at: r.inserted_at,
      updated_at: r.updated_at,
    }))

  // Merge server + local recordings without duplicates
  const serverIds = new Set(serverRecordings.map((r) => r.id))
  const combined = [...serverRecordings]
  for (const local of localAsItems) {
    if (!serverIds.has(local.id)) {
      combined.push(local)
    }
  }

  // Sort newest first
  combined.sort((a, b) => new Date(b.inserted_at).getTime() - new Date(a.inserted_at).getTime())
  return combined
}

export async function uploadRecording(formData: FormData): Promise<{ id: number; title: string }> {
  const clientId = getClientId()
  if (!formData.has('client_id')) {
    formData.append('client_id', clientId)
  }

  // If remote or local API is configured, try server upload
  if (!isStaticVercelHost) {
    try {
      const res = await fetch(`${API_BASE}/api/recordings`, {
        method: 'POST',
        headers: {
          'X-Client-Id': clientId,
        },
        body: formData,
      })
      if (res.ok) {
        return await res.json()
      }
    } catch {
      // Network error, fallback below
    }
  }

  // Fallback to high-performance client-side IndexedDB storage
  // (Ensures zero-config recording functionality on static Vercel deployments)
  const blob = formData.get('blob') as Blob | null
  const title = (formData.get('title') as string) || 'Untitled Recording'
  const durationMs = formData.get('duration_ms') ? parseInt(formData.get('duration_ms') as string, 10) : null
  const sampleRate = formData.get('sample_rate') ? parseInt(formData.get('sample_rate') as string, 10) : 48000
  const contentType = (formData.get('content_type') as string) || blob?.type || 'audio/webm'

  if (!blob) {
    throw new Error('No audio blob provided for upload')
  }

  const saved = await idbSaveRecording({
    title,
    blob,
    duration_ms: durationMs,
    size_bytes: blob.size,
    content_type: contentType,
    sample_rate: sampleRate,
    session_id: null,
    participant: null,
    client_id: clientId,
    inserted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  return { id: saved.id, title: saved.title }
}

export async function deleteRecording(id: number): Promise<void> {
  await idbDeleteRecording(id)
  const clientId = getClientId()
  if (!isStaticVercelHost) {
    try {
      await fetch(`${API_BASE}/api/recordings/${id}?client_id=${encodeURIComponent(clientId)}`, {
        method: 'DELETE',
        headers: {
          'X-Client-Id': clientId,
        },
      })
    } catch {}
  }
}

export function getAudioUrl(id: number): string {
  const localUrl = idbGetBlobUrl(id)
  if (localUrl) return localUrl
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
  if (!isStaticVercelHost) {
    try {
      const res = await fetch(`${API_BASE}/api/recordings/${id}/transcribe`, {
        method: 'POST',
      })
      if (res.ok) return await res.json()
    } catch {}
  }

  // Client-side fallback for static deployments
  const localRecord = await idbGetRecording(id)
  if (!localRecord || !localRecord.blob) {
    throw new Error('Recording not found')
  }

  const apiKey =
    import.meta.env.VITE_GEMINI_API_KEY ||
    localStorage.getItem('timbre_gemini_api_key') ||
    ''

  if (!apiKey) {
    await idbUpdateTranscript(id, {
      status: 'error',
      text: null,
      summary: null,
      title: null,
      error: 'GEMINI_API_KEY not found. Please set VITE_GEMINI_API_KEY in your Vercel Environment Variables.',
    })
    return { status: 'error' }
  }

  await idbUpdateTranscript(id, {
    status: 'processing',
    text: null,
    summary: null,
    title: null,
    error: null,
  })

  // Run client-side Gemini request
  runClientGeminiTranscription(id, localRecord.blob, apiKey)

  return { status: 'processing' }
}

export async function getTranscript(id: number): Promise<TranscriptData> {
  if (!isStaticVercelHost) {
    try {
      const res = await fetch(`${API_BASE}/api/recordings/${id}/transcript`)
      if (res.ok) return await res.json()
    } catch {}
  }

  const localRecord = await idbGetRecording(id)
  if (localRecord?.transcript) {
    return localRecord.transcript
  }

  return {
    status: 'not_requested',
    text: null,
    summary: null,
    title: null,
    error: null,
  }
}

async function runClientGeminiTranscription(id: number, blob: Blob, apiKey: string) {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64Audio = window.btoa(binary)

    let mimeType = 'audio/webm'
    if (blob.type.includes('wav')) mimeType = 'audio/wav'
    else if (blob.type.includes('ogg')) mimeType = 'audio/ogg'

    const prompt =
      'Transcribe this audio recording verbatim. Provide output in JSON format with fields: "title" (a concise 3-6 word title), "summary" (a 1-2 sentence overview), and "transcript" (the exact verbatim transcription).'

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: base64Audio,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Gemini API HTTP ${res.status}: ${errText}`)
    }

    const json = await res.json()
    const candidate = json.candidates?.[0]?.content?.parts?.[0]?.text
    if (!candidate) throw new Error('Empty response from Gemini API')

    const parsed = JSON.parse(candidate)
    await idbUpdateTranscript(id, {
      status: 'done',
      text: parsed.transcript || '',
      summary: parsed.summary || '',
      title: parsed.title || null,
      error: null,
    })
  } catch (err: any) {
    await idbUpdateTranscript(id, {
      status: 'error',
      text: null,
      summary: null,
      title: null,
      error: err.message,
    })
  }
}
