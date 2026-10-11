// Client-side IndexedDB persistent storage for Timbre recordings and audio Blobs
// Ensures full functionality even on static hosts like Vercel when a remote backend is not connected.

export interface StoredRecording {
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
  blob: Blob
  transcript?: {
    status: 'not_requested' | 'pending' | 'processing' | 'done' | 'error'
    text: string | null
    summary: string | null
    title: string | null
    error: string | null
  }
}

const DB_NAME = 'timbre_recorder_db'
const DB_VERSION = 1
const STORE_NAME = 'recordings'

let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

// In-memory cache of object URLs for blob playback
const blobUrlCache = new Map<number, string>()

export async function idbSaveRecording(item: Omit<StoredRecording, 'id'> & { id?: number }): Promise<StoredRecording> {
  const db = await getDB()
  const now = new Date().toISOString()

  // Generate ID if not provided (timestamp based)
  const id = item.id || Date.now()
  const record: StoredRecording = {
    ...item,
    id,
    inserted_at: item.inserted_at || now,
    updated_at: now,
    transcript: item.transcript || {
      status: 'not_requested',
      text: null,
      summary: null,
      title: null,
      error: null,
    },
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(record)

    req.onsuccess = () => {
      // Cache object URL
      if (blobUrlCache.has(id)) {
        URL.revokeObjectURL(blobUrlCache.get(id)!)
      }
      blobUrlCache.set(id, URL.createObjectURL(record.blob))
      resolve(record)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function idbGetAllRecordings(): Promise<StoredRecording[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()

    req.onsuccess = () => {
      const records: StoredRecording[] = req.result || []
      // Sort newest first
      records.sort((a, b) => new Date(b.inserted_at).getTime() - new Date(a.inserted_at).getTime())
      // Cache blob URLs
      for (const r of records) {
        if (!blobUrlCache.has(r.id) && r.blob) {
          blobUrlCache.set(r.id, URL.createObjectURL(r.blob))
        }
      }
      resolve(records)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function idbGetRecording(id: number): Promise<StoredRecording | null> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(id)

    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export async function idbDeleteRecording(id: number): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.delete(id)

    req.onsuccess = () => {
      if (blobUrlCache.has(id)) {
        URL.revokeObjectURL(blobUrlCache.get(id)!)
        blobUrlCache.delete(id)
      }
      resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

export function idbGetBlobUrl(id: number): string | null {
  return blobUrlCache.get(id) || null
}

export async function idbUpdateTranscript(
  id: number,
  transcript: StoredRecording['transcript']
): Promise<void> {
  const record = await idbGetRecording(id)
  if (!record) return
  record.transcript = transcript
  record.updated_at = new Date().toISOString()
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(record)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
