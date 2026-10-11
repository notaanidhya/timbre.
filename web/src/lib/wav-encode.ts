/**
 * Pure browser-side 16-bit PCM WAV encoder.
 *
 * Converts a Float32Array of audio samples (-1.0 to 1.0) into a standard
 * RIFF/WAVE container Blob. Requires zero external dependencies.
 */

export function encodeWav(samples: Float32Array, sampleRate: number, numChannels: number = 1): Blob {
  const bytesPerSample = 2 // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // 1. RIFF Chunk Descriptor
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true) // file size - 8
  writeAscii(view, 8, 'WAVE')

  // 2. "fmt " Sub-chunk
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true) // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true) // NumChannels
  view.setUint32(24, sampleRate, true) // SampleRate
  view.setUint32(28, byteRate, true) // ByteRate
  view.setUint16(32, blockAlign, true) // BlockAlign
  view.setUint16(34, 16, true) // BitsPerSample (16 bits)

  // 3. "data" Sub-chunk
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // 4. Write 16-bit PCM samples with [-1.0, 1.0] clamping
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1.0, Math.min(1.0, samples[i]))
    const int16 = s < 0 ? s * 32768 : s * 32767
    view.setInt16(offset, Math.round(int16), true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeAscii(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}
