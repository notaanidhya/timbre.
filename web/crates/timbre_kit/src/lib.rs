//! timbre_kit — the client-side Rust that compiles to WebAssembly.
//!
//! The browser captures audio, hands the raw PCM samples to Rust, and Rust does
//! the DSP before the samples go back out. `rms_level` is a minimal example of
//! that seam; build the real work (anonymization / modulation / mixing) here.

use wasm_bindgen::prelude::*;

/// Root-mean-square level of a block of `f32` PCM samples (each in -1.0..=1.0).
///
/// Takes a `Float32Array` straight from the Web Audio API and returns a single
/// scalar the UI can render as a meter.
#[wasm_bindgen]
pub fn rms_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
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
}
