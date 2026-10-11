//! timbre_kit — client-side Rust compiled to WebAssembly.
//!
//! Provides real-time DSP operations for in-browser audio manipulation:
//! - RMS level metering
//! - Gain / volume scaling with [-1.0, 1.0] clamping
//! - Peak normalization to target dBFS
//! - Multichannel to mono mixdown
//! - Noise gate with attack / release smoothing
//! - Voice anonymizer (pitch-shift resample)

use wasm_bindgen::prelude::*;

/// Root-mean-square level of a block of `f32` PCM samples (each in -1.0..=1.0).
#[wasm_bindgen]
pub fn rms_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// Applies gain in decibels.
/// Clamps output samples to [-1.0, 1.0] to prevent audio clipping / wrap-around.
#[wasm_bindgen]
pub fn apply_gain(samples: &[f32], gain_db: f32) -> Vec<f32> {
    let linear = 10.0_f32.powf(gain_db / 20.0);
    samples.iter().map(|&s| (s * linear).clamp(-1.0, 1.0)).collect()
}

/// Scales audio peak to target_db (e.g. -1.0 dBFS).
/// If the signal is silent (peak < 1e-6), returns samples unmodified.
#[wasm_bindgen]
pub fn normalize(samples: &[f32], target_db: f32) -> Vec<f32> {
    let peak = samples.iter().map(|&s| s.abs()).fold(0.0_f32, f32::max);
    if peak < 1e-6 {
        return samples.to_vec();
    }
    let target = 10.0_f32.powf(target_db / 20.0);
    let scale = target / peak;
    samples.iter().map(|&s| (s * scale).clamp(-1.0, 1.0)).collect()
}

/// Folds interleaved multichannel audio into single-channel mono.
/// If already mono (`channels <= 1`), returns samples as-is.
#[wasm_bindgen]
pub fn to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 || samples.is_empty() {
        return samples.to_vec();
    }
    let ch_f32 = channels as f32;
    samples
        .chunks_exact(channels)
        .map(|chunk| chunk.iter().sum::<f32>() / ch_f32)
        .collect()
}

/// Attenuates blocks whose RMS level falls below `threshold_db`.
///
/// - `threshold_db`: Cutoff threshold (e.g. -36.0 dBFS).
/// - `window_size`: Analysis block size in samples.
/// - `attack_windows`: Smoothing factor when gate opens.
/// - `release_windows`: Smoothing factor when gate closes.
#[wasm_bindgen]
pub fn noise_gate(
    samples: &[f32],
    threshold_db: f32,
    window_size: usize,
    attack_windows: usize,
    release_windows: usize,
) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }
    let win = window_size.max(1);
    let threshold_linear = 10.0_f32.powf(threshold_db / 20.0);
    let n = samples.len();
    let mut out = vec![0.0_f32; n];
    let mut gain = 0.0_f32;
    let mut i = 0;

    let attack_rate = 1.0 / (attack_windows.max(1) as f32);
    let release_rate = 1.0 / (release_windows.max(1) as f32);

    while i < n {
        let end = (i + win).min(n);
        let chunk = &samples[i..end];
        let sum_sq: f32 = chunk.iter().map(|&s| s * s).sum();
        let rms = (sum_sq / chunk.len() as f32).sqrt();

        let target = if rms >= threshold_linear { 1.0_f32 } else { 0.0_f32 };
        let smoothing = if target > gain { attack_rate } else { release_rate };

        for j in i..end {
            gain += (target - gain) * smoothing;
            out[j] = samples[j] * gain;
        }
        i = end;
    }
    out
}

/// Shifts pitch by `semitones` using linear interpolation resampling.
/// Positive semitones raise the pitch, negative semitones lower the pitch.
#[wasm_bindgen]
pub fn anonymize_voice(samples: &[f32], semitones: f32, _sample_rate: u32) -> Vec<f32> {
    if samples.is_empty() || semitones.abs() < 1e-4 {
        return samples.to_vec();
    }
    let ratio = 2.0_f32.powf(semitones / 12.0);
    let out_len = ((samples.len() as f32) / ratio).round() as usize;
    if out_len == 0 {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(out_len);
    let max_idx = samples.len() - 1;

    for i in 0..out_len {
        let src = (i as f32) * ratio;
        let lo = src.floor() as usize;
        if lo >= max_idx {
            out.push(samples[max_idx]);
        } else {
            let hi = lo + 1;
            let t = src - (lo as f32);
            out.push(samples[lo] * (1.0 - t) + samples[hi] * t);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_of_silence_is_zero() {
        assert_eq!(rms_level(&[0.0; 128]), 0.0);
    }

    #[test]
    fn rms_of_empty_is_zero() {
        assert_eq!(rms_level(&[]), 0.0);
    }

    #[test]
    fn rms_of_full_scale_is_one() {
        assert!((rms_level(&[1.0, -1.0, 1.0, -1.0]) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn gain_at_zero_db_is_identity() {
        let input = [0.5, -0.25, 0.75, -0.5];
        let output = apply_gain(&input, 0.0);
        for (a, b) in input.iter().zip(output.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }

    #[test]
    fn gain_clips_at_unity() {
        let input = [0.8, -0.9];
        let output = apply_gain(&input, 12.0); // +12 dB roughly 4x
        assert_eq!(output[0], 1.0);
        assert_eq!(output[1], -1.0);
    }

    #[test]
    fn normalize_peaks_at_target() {
        let input = [0.25, -0.5, 0.1];
        let output = normalize(&input, -1.0); // -1.0 dB ≈ 0.89125
        let peak = output.iter().map(|&s| s.abs()).fold(0.0_f32, f32::max);
        let target_linear = 10.0_f32.powf(-1.0 / 20.0);
        assert!((peak - target_linear).abs() < 1e-5);
    }

    #[test]
    fn normalize_handles_silence() {
        let input = [0.0, 0.0, 0.0];
        let output = normalize(&input, -1.0);
        assert_eq!(output, vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn to_mono_averages_stereo_channels() {
        // Interleaved L, R, L, R
        let input = [1.0, 0.0, -0.5, 0.5];
        let output = to_mono(&input, 2);
        assert_eq!(output.len(), 2);
        assert!((output[0] - 0.5).abs() < 1e-6);
        assert!((output[1] - 0.0).abs() < 1e-6);
    }

    #[test]
    fn to_mono_passes_mono_untouched() {
        let input = [0.2, -0.4, 0.6];
        let output = to_mono(&input, 1);
        assert_eq!(output, input.to_vec());
    }

    #[test]
    fn noise_gate_silences_quiet_signal() {
        let input = vec![0.001; 64];
        let output = noise_gate(&input, -30.0, 16, 1, 1);
        for sample in output {
            assert!(sample.abs() < 1e-4);
        }
    }

    #[test]
    fn anonymize_voice_shifts_length() {
        let input = vec![0.5; 100];
        // +12 semitones = 1 octave higher (2x speed, half length)
        let higher = anonymize_voice(&input, 12.0, 48000);
        assert!((higher.len() as i32 - 50).abs() <= 1);

        // -12 semitones = 1 octave lower (0.5x speed, double length)
        let lower = anonymize_voice(&input, -12.0, 48000);
        assert!((lower.len() as i32 - 200).abs() <= 1);
    }
}
