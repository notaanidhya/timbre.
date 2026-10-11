/**
 * AudioWorkletProcessor for batching PCM samples into 4096-sample Int16 frames (~85ms at 48kHz).
 * Runs on the dedicated audio rendering thread for stutter-free capture.
 */

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.bufferSize = 4096
    this.buffer = new Float32Array(this.bufferSize)
    this.pos = 0
  }

  process(inputs) {
    const inputChannel = inputs[0]?.[0]
    if (!inputChannel) return true

    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.pos++] = inputChannel[i]

      if (this.pos >= this.bufferSize) {
        // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
        const int16 = new Int16Array(this.bufferSize)
        let sumSq = 0

        for (let j = 0; j < this.bufferSize; j++) {
          const s = Math.max(-1.0, Math.min(1.0, this.buffer[j]))
          sumSq += s * s
          int16[j] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767)
        }

        const rms = Math.sqrt(sumSq / this.bufferSize)

        // Post transferable ArrayBuffer + RMS level across the port
        this.port.postMessage(
          {
            buffer: int16.buffer,
            level: rms,
          },
          [int16.buffer]
        )

        this.pos = 0
      }
    }

    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
