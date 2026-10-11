export function rms_level(samples: Float32Array): number;
export function apply_gain(samples: Float32Array, gain_db: number): Float32Array;
export function normalize(samples: Float32Array, target_db: number): Float32Array;
export function to_mono(samples: Float32Array, channels: number): Float32Array;
export function noise_gate(
  samples: Float32Array,
  threshold_db: number,
  window_size: number,
  attack_windows: number,
  release_windows: number
): Float32Array;
export function anonymize_voice(samples: Float32Array, semitones: number, sample_rate: number): Float32Array;

export default function init(): Promise<any>;
