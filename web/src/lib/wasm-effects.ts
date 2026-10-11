import {
  apply_gain,
  normalize,
  to_mono,
  noise_gate,
  anonymize_voice,
} from 'timbre_kit'

export interface DspParameters {
  gainDb: number
  normalizeEnabled: boolean
  normalizeTargetDb: number
  noiseGateEnabled: boolean
  noiseGateThresholdDb: number
  noiseGateWindowSize: number
  noiseGateAttack: number
  noiseGateRelease: number
  monoMixdown: boolean
  pitchSemitones: number
}

export const DEFAULT_DSP_PARAMS: DspParameters = {
  gainDb: 0,
  normalizeEnabled: false,
  normalizeTargetDb: -1.0,
  noiseGateEnabled: false,
  noiseGateThresholdDb: -36.0,
  noiseGateWindowSize: 512,
  noiseGateAttack: 2,
  noiseGateRelease: 4,
  monoMixdown: false,
  pitchSemitones: 0,
}

export interface DecodedAudio {
  originalBuffer: AudioBuffer
  originalSamples: Float32Array
  sampleRate: number
  duration: number
}

/**
 * Fetches and decodes an audio file into raw Float32Array PCM samples.
 */
export async function loadAndDecodeAudio(audioUrl: string, audioCtx: AudioContext): Promise<DecodedAudio> {
  const response = await fetch(audioUrl)
  if (!response.ok) throw new Error(`Failed to load audio: ${response.statusText}`)
  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

  // Extract mono or primary channel
  let samples: Float32Array
  if (audioBuffer.numberOfChannels === 1) {
    samples = audioBuffer.getChannelData(0)
  } else {
    // Interleave channels for WASM to_mono downmix if needed
    const ch0 = audioBuffer.getChannelData(0)
    const ch1 = audioBuffer.getChannelData(1)
    const interleaved = new Float32Array(ch0.length * 2)
    for (let i = 0; i < ch0.length; i++) {
      interleaved[i * 2] = ch0[i]
      interleaved[i * 2 + 1] = ch1[i]
    }
    samples = to_mono(interleaved, 2)
  }

  return {
    originalBuffer: audioBuffer,
    originalSamples: samples,
    sampleRate: audioBuffer.sampleRate,
    duration: audioBuffer.duration,
  }
}

/**
 * Executes the WASM DSP processing pipeline on PCM samples.
 */
export function processAudioPipeline(
  inputSamples: Float32Array,
  params: DspParameters,
  sampleRate: number
): Float32Array {
  let current: Float32Array = new Float32Array(inputSamples)

  // 1. Mono Mixdown (if requested)
  if (params.monoMixdown) {
    current = to_mono(current, 1)
  }

  // 2. Noise Gate
  if (params.noiseGateEnabled) {
    current = noise_gate(
      current,
      params.noiseGateThresholdDb,
      params.noiseGateWindowSize,
      params.noiseGateAttack,
      params.noiseGateRelease
    )
  }

  // 3. Gain adjustment
  if (params.gainDb !== 0) {
    current = apply_gain(current, params.gainDb)
  }

  // 4. Voice Anonymizer (Pitch Shift)
  if (params.pitchSemitones !== 0) {
    current = anonymize_voice(current, params.pitchSemitones, sampleRate)
  }

  // 5. Peak Normalize (applied last in chain)
  if (params.normalizeEnabled) {
    current = normalize(current, params.normalizeTargetDb)
  }

  return current
}

/**
 * Helper to compute peak level in dBFS.
 */
export function calculatePeakDb(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }
  if (peak <= 1e-6) return -100
  return 20 * Math.log10(peak)
}

/**
 * Creates an AudioBuffer from a Float32Array.
 */
export function createAudioBufferFromSamples(
  samples: Float32Array,
  sampleRate: number,
  audioCtx: AudioContext
): AudioBuffer {
  const buffer = audioCtx.createBuffer(1, samples.length, sampleRate)
  buffer.getChannelData(0).set(samples)
  return buffer
}

