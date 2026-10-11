export function rms_level(samples) {
  if (!samples || samples.length === 0) return 0.0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

export function apply_gain(samples, gain_db) {
  const linear = Math.pow(10, gain_db / 20.0);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-1.0, Math.min(1.0, samples[i] * linear));
  }
  return out;
}

export function normalize(samples, target_db) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  if (peak < 1e-6) return new Float32Array(samples);
  const target = Math.pow(10, target_db / 20.0);
  const scale = target / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-1.0, Math.min(1.0, samples[i] * scale));
  }
  return out;
}

export function to_mono(samples, channels) {
  if (channels <= 1) return new Float32Array(samples);
  const len = Math.floor(samples.length / channels);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += samples[i * channels + c];
    }
    out[i] = sum / channels;
  }
  return out;
}

export function noise_gate(samples, threshold_db, window_size, attack_windows, release_windows) {
  const thresholdLinear = Math.pow(10, threshold_db / 20.0);
  const n = samples.length;
  const out = new Float32Array(n);
  let gain = 0;
  let i = 0;
  while (i < n) {
    const end = Math.min(i + window_size, n);
    let sq = 0;
    for (let j = i; j < end; j++) sq += samples[j] * samples[j];
    const rms = Math.sqrt(sq / (end - i));
    const target = rms >= thresholdLinear ? 1.0 : 0.0;
    const smoothing = target > gain ? 1.0 / Math.max(1, attack_windows) : 1.0 / Math.max(1, release_windows);
    for (let j = i; j < end; j++) {
      gain += (target - gain) * smoothing;
      out[j] = samples[j] * gain;
    }
    i = end;
  }
  return out;
}

export function anonymize_voice(samples, semitones, sample_rate) {
  const ratio = Math.pow(2, semitones / 12.0);
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, samples.length - 1);
    const t = src - lo;
    out[i] = samples[lo] * (1.0 - t) + samples[hi] * t;
  }
  return out;
}

export default async function init() {
  return Promise.resolve(true);
}
