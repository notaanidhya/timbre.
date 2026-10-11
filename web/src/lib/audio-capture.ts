/**
 * Cross-browser audio capture abstraction.
 *
 * Implements standardized codec negotiation (Chrome & Firefox parity):
 * prefers audio/webm;codecs=opus -> audio/ogg;codecs=opus -> audio/webm -> fallback.
 *
 * Does NOT force sampleRate on AudioContext (Firefox failure mode) — uses
 * the native hardware rate and reports it as metadata.
 */

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
]

export function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime
    }
  }
  return ''
}

export interface AudioCaptureSession {
  stream: MediaStream
  recorder: MediaRecorder
  context: AudioContext
  analyser: AnalyserNode
  mimeType: string
  sampleRate: number
  stop: () => void
}

export async function startAudioCapture(onDataAvailable?: (chunk: Blob) => void): Promise<AudioCaptureSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported by your browser.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: false, // keep natural acoustics for processing
      autoGainControl: false,
    },
  })

  // Use native sample rate without forcing — prevents Firefox mismatch exceptions
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 256
  source.connect(analyser)

  const mimeType = getSupportedMimeType()
  const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {}
  const recorder = new MediaRecorder(stream, recorderOptions)

  if (onDataAvailable) {
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        onDataAvailable(e.data)
      }
    }
  }

  const stop = () => {
    try {
      if (recorder.state !== 'inactive') {
        recorder.stop()
      }
    } catch {
      // ignore
    }
    stream.getTracks().forEach((track) => track.stop())
    context.close().catch(() => {})
  }

  return {
    stream,
    recorder,
    context,
    analyser,
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    sampleRate: context.sampleRate,
    stop,
  }
}
