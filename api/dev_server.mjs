import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(path.resolve('web/package.json'))
const Busboy = require('busboy')
const { WebSocketServer } = require('ws')

const PORT = parseInt(process.env.PORT || '4010', 10)
const ROOT_DIR = path.resolve('.')
const TMP_DIR = path.join(ROOT_DIR, 'api', '.tmp')
const RECORDINGS_DIR = path.join(TMP_DIR, 'recordings')
const DB_FILE = path.join(TMP_DIR, 'recordings.json')
const ENV_FILE = path.join(ROOT_DIR, '.env')

// Ensure tmp directories exist
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true })

// Helper: Read recordings JSON DB
function loadRecordings() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.error('Error reading recordings.json:', err)
  }
  return []
}

// Helper: Save recordings JSON DB
function saveRecordings(recordings) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(recordings, null, 2), 'utf-8')
  } catch (err) {
    console.error('Error writing recordings.json:', err)
  }
}

// Helper: Read GEMINI_API_KEY from .env or process.env
function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim()
  try {
    if (fs.existsSync(ENV_FILE)) {
      const lines = fs.readFileSync(ENV_FILE, 'utf-8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('GEMINI_API_KEY=')) {
          return trimmed.slice('GEMINI_API_KEY='.length).trim()
        }
      }
    }
  } catch {}
  return null
}

// In-memory multiplayer session rooms
const rooms = new Map()
// Each room: { id, participants: Map<name, { ws, chunks: ArrayBuffer[], startTs, done: boolean }>, firstStartTs: number }

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      participants: new Map(),
      firstStartTs: 0,
    })
  }
  return rooms.get(roomId)
}

// Helper: Create 16-bit PCM WAV header and buffer from Int16Array
function encodeWav(int16Samples, sampleRate = 48000, numChannels = 1) {
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = int16Samples.length * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  // RIFF Chunk
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)

  // fmt sub-chunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20)  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34) // BitsPerSample

  // data sub-chunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  // Write samples
  for (let i = 0; i < int16Samples.length; i++) {
    buffer.writeInt16LE(int16Samples[i], 44 + i * 2)
  }

  return buffer
}

// Set up HTTP Server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true)
  const pathname = parsedUrl.pathname || '/'

  // Add permissive CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Disposition')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // 1. Health checks
  if (pathname === '/healthz' || pathname === '/readyz') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', service: 'timbre-dev-api', port: PORT }))
    return
  }

  // 2. GET /api/recordings - List recordings
  if (req.method === 'GET' && pathname === '/api/recordings') {
    const recordings = loadRecordings()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ recordings }))
    return
  }

  // 3. POST /api/recordings - Upload new recording
  if (req.method === 'POST' && pathname === '/api/recordings') {
    try {
      const busboy = Busboy({ headers: req.headers })
      const fields = {}
      let fileBuffer = Buffer.alloc(0)
      let fileContentType = ''

      busboy.on('file', (fieldname, file, info) => {
        fileContentType = info.mimeType
        const chunks = []
        file.on('data', (data) => chunks.push(data))
        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks)
        })
      })

      busboy.on('field', (name, val) => {
        fields[name] = val
      })

      busboy.on('finish', () => {
        const recordings = loadRecordings()
        const id = recordings.length > 0 ? Math.max(...recordings.map((r) => r.id || 0)) + 1 : 1
        const now = new Date().toISOString()
        const contentType = fields.content_type || fileContentType || 'audio/webm'

        let ext = 'webm'
        if (contentType.includes('wav')) ext = 'wav'
        else if (contentType.includes('ogg')) ext = 'ogg'

        const filename = `audio_${id}.${ext}`
        const filePath = path.join(RECORDINGS_DIR, filename)
        fs.writeFileSync(filePath, fileBuffer)

        const durationMs = fields.duration_ms ? parseInt(fields.duration_ms, 10) : null
        const sampleRate = fields.sample_rate ? parseInt(fields.sample_rate, 10) : 48000
        const sizeBytes = fileBuffer.length

        const newRecording = {
          id,
          title: fields.title || `Recording ${now.slice(0, 10)}`,
          duration_ms: durationMs,
          size_bytes: sizeBytes,
          content_type: contentType,
          sample_rate: sampleRate,
          session_id: fields.session_id || null,
          participant: fields.participant || null,
          filename,
          inserted_at: now,
          updated_at: now,
          transcript: {
            status: 'not_requested',
            text: null,
            summary: null,
            title: null,
            error: null,
          },
        }

        recordings.unshift(newRecording)
        saveRecordings(recordings)

        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            id: newRecording.id,
            title: newRecording.title,
            duration_ms: newRecording.duration_ms,
            size_bytes: newRecording.size_bytes,
            content_type: newRecording.content_type,
            sample_rate: newRecording.sample_rate,
          })
        )
      })

      req.pipe(busboy)
    } catch (err) {
      console.error('Error handling recording upload:', err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ errors: { base: [err.message] } }))
    }
    return
  }

  // 4. GET /api/recordings/:id/audio - Stream audio file with Range support
  const audioMatch = pathname.match(/^\/api\/recordings\/(\d+)\/audio$/)
  if (req.method === 'GET' && audioMatch) {
    const id = parseInt(audioMatch[1], 10)
    const recordings = loadRecordings()
    const recording = recordings.find((r) => r.id === id)

    if (!recording) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Recording not found' }))
      return
    }

    const filePath = path.join(RECORDINGS_DIR, recording.filename)
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Audio file missing from storage' }))
      return
    }

    const stat = fs.statSync(filePath)
    const totalSize = stat.size
    const range = req.headers.range

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1
      const chunkSize = end - start + 1
      const stream = fs.createReadStream(filePath, { start, end })

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': recording.content_type,
        'Content-Disposition': `inline; filename="recording-${id}"`,
      })
      stream.pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': totalSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': recording.content_type,
        'Content-Disposition': `inline; filename="recording-${id}"`,
      })
      fs.createReadStream(filePath).pipe(res)
    }
    return
  }

  // 5. DELETE /api/recordings/:id - Delete recording
  const deleteMatch = pathname.match(/^\/api\/recordings\/(\d+)$/)
  if (req.method === 'DELETE' && deleteMatch) {
    const id = parseInt(deleteMatch[1], 10)
    const recordings = loadRecordings()
    const index = recordings.findIndex((r) => r.id === id)

    if (index !== -1) {
      const recording = recordings[index]
      const filePath = path.join(RECORDINGS_DIR, recording.filename)
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath)
        } catch {}
      }
      recordings.splice(index, 1)
      saveRecordings(recordings)
    }

    res.writeHead(204)
    res.end()
    return
  }

  // 6. POST /api/recordings/:id/transcribe - Request AI transcription
  const transcribeMatch = pathname.match(/^\/api\/recordings\/(\d+)\/transcribe$/)
  if (req.method === 'POST' && transcribeMatch) {
    const id = parseInt(transcribeMatch[1], 10)
    const recordings = loadRecordings()
    const recording = recordings.find((r) => r.id === id)

    if (!recording) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Recording not found' }))
      return
    }

    // Set transcript status to processing
    recording.transcript = {
      status: 'processing',
      text: null,
      summary: null,
      title: null,
      error: null,
    }
    saveRecordings(recordings)

    // Respond immediately with 202 Accepted
    res.writeHead(202, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'accepted', recording_id: id }))

    // Trigger async transcription with Gemini 1.5 Flash
    ;(async () => {
      const apiKey = getGeminiApiKey()
      if (!apiKey) {
        recording.transcript = {
          status: 'error',
          text: null,
          summary: null,
          title: null,
          error: 'GEMINI_API_KEY is not configured in .env file',
        }
        saveRecordings(loadRecordings())
        return
      }

      try {
        const filePath = path.join(RECORDINGS_DIR, recording.filename)
        const audioBuffer = fs.readFileSync(filePath)
        const b64Data = audioBuffer.toString('base64')

        let mimeType = 'audio/webm'
        if (recording.content_type.includes('ogg')) mimeType = 'audio/ogg'
        else if (recording.content_type.includes('wav')) mimeType = 'audio/wav'

        const prompt = `Transcribe this audio recording verbatim.
Also generate a concise, descriptive title (maximum 8 words) and a 2-3 sentence summary.
Return ONLY a valid JSON object matching this exact schema:
{
  "title": "short descriptive title",
  "summary": "2-3 sentence summary",
  "text": "full verbatim transcript"
}`

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`
        const response = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: mimeType, data: b64Data } },
                ],
              },
            ],
            generationConfig: {
              response_mime_type: 'application/json',
            },
          }),
        })

        if (!response.ok) {
          const errText = await response.text()
          throw new Error(`Gemini API HTTP ${response.status}: ${errText}`)
        }

        const data = await response.json()
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text
        let parsed = {}
        if (candidate) {
          try {
            parsed = JSON.parse(candidate)
          } catch {
            parsed = { text: candidate, summary: 'Generated summary', title: recording.title }
          }
        }

        const updatedRecordings = loadRecordings()
        const rec = updatedRecordings.find((r) => r.id === id)
        if (rec) {
          rec.transcript = {
            status: 'done',
            title: parsed.title || rec.title,
            summary: parsed.summary || 'Summary unavailable',
            text: parsed.text || '',
            error: null,
          }
          saveRecordings(updatedRecordings)
        }
      } catch (err) {
        console.error('Transcription error for recording', id, err)
        const updatedRecordings = loadRecordings()
        const rec = updatedRecordings.find((r) => r.id === id)
        if (rec) {
          rec.transcript = {
            status: 'error',
            text: null,
            summary: null,
            title: null,
            error: err.message || 'Transcription failed',
          }
          saveRecordings(updatedRecordings)
        }
      }
    })()

    return
  }

  // 7. GET /api/recordings/:id/transcript - Get transcript status & content
  const transcriptMatch = pathname.match(/^\/api\/recordings\/(\d+)\/transcript$/)
  if (req.method === 'GET' && transcriptMatch) {
    const id = parseInt(transcriptMatch[1], 10)
    const recordings = loadRecordings()
    const recording = recordings.find((r) => r.id === id)

    if (!recording || !recording.transcript) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'not_requested',
          text: null,
          summary: null,
          title: null,
          error: null,
        })
      )
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(recording.transcript))
    return
  }

  // 404 for any other path
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not Found' }))
})

// Set up WebSocket Server on the same HTTP server handling /socket and /socket/websocket
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const parsed = url.parse(req.url || '')
  const pathname = parsed.pathname || ''
  if (pathname.startsWith('/socket')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

wss.on('connection', (ws, req) => {
  const parsedUrl = url.parse(req.url, true)
  const participantName = parsedUrl.query?.participant || 'Anonymous'
  let currentTopic = null
  let currentRoom = null

  ws.on('message', (message) => {
    try {
      const frame = JSON.parse(message.toString())
      if (!Array.isArray(frame)) return
      const [joinRef, msgRef, topic, event, payload] = frame

      // Handle heartbeat
      if (topic === 'phoenix' && event === 'heartbeat') {
        ws.send(JSON.stringify([joinRef, msgRef, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]))
        return
      }

      // Handle session channel join
      if (topic.startsWith('session:') && event === 'phx_join') {
        const roomId = topic.replace('session:', '')
        currentTopic = topic
        currentRoom = getOrCreateRoom(roomId)

        const initialTrack = payload?.track || (participantName.includes('(Take') ? participantName : `${participantName} (Take 1)`)

        currentRoom.participants.set(initialTrack, {
          ws,
          participant: participantName,
          track: initialTrack,
          chunks: [],
          startTs: 0,
          done: false,
        })

        // Acknowledge join
        ws.send(JSON.stringify([joinRef, msgRef, topic, 'phx_reply', { status: 'ok', response: {} }]))

        // Broadcast participant joined to others
        for (const [pName, pData] of currentRoom.participants) {
          if (pName !== initialTrack && pData.ws.readyState === 1) {
            pData.ws.send(
              JSON.stringify([null, null, topic, 'participant_joined', { participant: initialTrack }])
            )
          }
        }

        // Send current session state to this participant
        const participantsList = Array.from(currentRoom.participants.entries()).map(([name, data]) => ({
          name,
          chunks_count: data.chunks.length,
          done: data.done,
          start_ts: data.startTs,
        }))

        ws.send(
          JSON.stringify([
            null,
            null,
            topic,
            'session_state',
            { session_id: roomId, participants: participantsList },
          ])
        )
        return
      }

      if (!currentRoom || !currentTopic) return

      // Handle add_take for multiple takes
      if (event === 'add_take') {
        const trackName = payload?.track
        if (trackName) {
          currentRoom.participants.set(trackName, {
            ws,
            participant: participantName,
            track: trackName,
            chunks: [],
            startTs: 0,
            done: false,
          })

          // Broadcast participant_joined
          for (const [pName, pData] of currentRoom.participants) {
            if (pData.ws.readyState === 1) {
              pData.ws.send(
                JSON.stringify([null, null, topic, 'participant_joined', { participant: trackName }])
              )
            }
          }

          // Broadcast session_state update
          const participantsList = Array.from(currentRoom.participants.entries()).map(([name, data]) => ({
            name,
            chunks_count: data.chunks.length,
            done: data.done,
            start_ts: data.startTs,
          }))

          for (const [, pData] of currentRoom.participants) {
            if (pData.ws.readyState === 1) {
              pData.ws.send(
                JSON.stringify([
                  null,
                  null,
                  topic,
                  'session_state',
                  { session_id: currentRoom.id, participants: participantsList },
                ])
              )
            }
          }
        }
        return
      }

      // Handle reset_take to re-record a take
      if (event === 'reset_take') {
        const trackName = payload?.track || participantName
        const pData = currentRoom.participants.get(trackName)
        if (pData) {
          pData.chunks = []
          pData.startTs = 0
          pData.done = false

          const participantsList = Array.from(currentRoom.participants.entries()).map(([name, data]) => ({
            name,
            chunks_count: data.chunks.length,
            done: data.done,
            start_ts: data.startTs,
          }))

          for (const [, p] of currentRoom.participants) {
            if (p.ws.readyState === 1) {
              p.ws.send(
                JSON.stringify([
                  null,
                  null,
                  topic,
                  'session_state',
                  { session_id: currentRoom.id, participants: participantsList },
                ])
              )
            }
          }
        }
        return
      }

      // Determine target track for audio events
      const targetTrack = payload?.track || (currentRoom.participants.has(participantName) ? participantName : `${participantName} (Take 1)`)
      const pData = currentRoom.participants.get(targetTrack) || currentRoom.participants.get(participantName)

      // Handle first chunk with start_ts
      if (event === 'first_chunk') {
        if (pData) {
          pData.startTs = payload.start_ts || Date.now()
          if (!currentRoom.firstStartTs) currentRoom.firstStartTs = pData.startTs
          const buf = Buffer.from(payload.chunk, 'base64')
          pData.chunks.push(buf)
        }
        return
      }

      // Handle continuous audio chunk
      if (event === 'audio_chunk') {
        if (pData) {
          const buf = Buffer.from(payload.chunk, 'base64')
          pData.chunks.push(buf)
        }
        return
      }

      // Handle VU meter level
      if (event === 'level') {
        for (const [pName, peer] of currentRoom.participants) {
          if (pName !== targetTrack && peer.ws.readyState === 1) {
            peer.ws.send(
              JSON.stringify([
                null,
                null,
                topic,
                'peer_level',
                { participant: targetTrack, level: payload.level },
              ])
            )
          }
        }
        return
      }

      // Handle participant done
      if (event === 'participant_done') {
        if (pData) pData.done = true
        for (const [, pInfo] of currentRoom.participants) {
          if (pInfo.ws.readyState === 1) {
            pInfo.ws.send(
              JSON.stringify([null, null, topic, 'participant_done', { participant: targetTrack }])
            )
          }
        }
        return
      }

      // Handle merge_now
      if (event === 'merge_now') {
        const pEntries = Array.from(currentRoom.participants.entries())
        const firstStart = currentRoom.firstStartTs || Date.now()
        const tracks = []
        let maxSamples = 0

        for (const [pName, data] of pEntries) {
          if (!data.chunks || data.chunks.length === 0) continue

          const fullBuf = Buffer.concat(data.chunks)
          if (fullBuf.length < 2) continue
          const sampleCount = Math.floor(fullBuf.length / 2)
          const int16Samples = new Int16Array(sampleCount)
          for (let i = 0; i < sampleCount; i++) {
            int16Samples[i] = fullBuf.readInt16LE(i * 2)
          }

          // Relative delay from the earliest participant's start time
          let delayMs = Math.max(0, (data.startTs || firstStart) - firstStart)
          // If delay is more than 4s (e.g. overdub / second take pass), align to 0 so layers sync cleanly
          if (delayMs > 4000) {
            delayMs = 0
          }
          const offsetSamples = Math.floor((delayMs * 48000) / 1000)
          tracks.push({ name: pName, samples: int16Samples, offset: offsetSamples })

          if (offsetSamples + sampleCount > maxSamples) {
            maxSamples = offsetSamples + sampleCount
          }
        }

        if (maxSamples === 0) maxSamples = 48000 // 1s fallback

        const mixed = new Int16Array(maxSamples)
        for (let i = 0; i < maxSamples; i++) {
          let sum = 0
          for (const track of tracks) {
            const trackIdx = i - track.offset
            if (trackIdx >= 0 && trackIdx < track.samples.length) {
              sum += track.samples[trackIdx]
            }
          }
          // Clamp to Int16 limits [-32768, 32767]
          mixed[i] = Math.max(-32768, Math.min(32767, Math.round(sum)))
        }

        const wavBuffer = encodeWav(mixed, 48000, 1)
        const durationMs = Math.round((maxSamples / 48000) * 1000)
        const recordings = loadRecordings()
        const id = recordings.length > 0 ? Math.max(...recordings.map((r) => r.id || 0)) + 1 : 1
        const now = new Date().toISOString()
        const filename = `audio_${id}.wav`
        fs.writeFileSync(path.join(RECORDINGS_DIR, filename), wavBuffer)

        const title = `Session Merge ${currentRoom.id.toUpperCase()} (${now.slice(0, 10)})`
        const newRecording = {
          id,
          title,
          duration_ms: durationMs,
          size_bytes: wavBuffer.length,
          content_type: 'audio/wav',
          sample_rate: 48000,
          session_id: currentRoom.id,
          participant: 'Merged Session',
          filename,
          inserted_at: now,
          updated_at: now,
          transcript: {
            status: 'not_requested',
            text: null,
            summary: null,
            title: null,
            error: null,
          },
        }

        recordings.unshift(newRecording)
        saveRecordings(recordings)

        // Broadcast merge_complete
        for (const [, pInfo] of currentRoom.participants) {
          if (pInfo.ws.readyState === 1) {
            pInfo.ws.send(
              JSON.stringify([
                null,
                null,
                topic,
                'merge_complete',
                { recording_id: id, title, duration_ms: durationMs },
              ])
            )
          }
        }

        // Reply to requester
        ws.send(
          JSON.stringify([
            joinRef,
            msgRef,
            topic,
            'phx_reply',
            { status: 'ok', response: { recording_id: id } },
          ])
        )
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err)
    }
  })

  ws.on('close', () => {
    if (currentRoom) {
      for (const [tName, tData] of currentRoom.participants) {
        if (tData.ws === ws) {
          currentRoom.participants.delete(tName)
        }
      }
    }
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[timbre-dev-api] Listening on http://localhost:${PORT}`)
  console.log(`[timbre-dev-api] Health check ready at http://localhost:${PORT}/healthz`)
  console.log(`[timbre-dev-api] Recordings stored in ${RECORDINGS_DIR}`)
})
