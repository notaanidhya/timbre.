# timbre — Field Recorder & Audio Studio

> **Live Application:** **[https://timbre-studio.vercel.app](https://timbre-studio.vercel.app)**  
> **Demo Video:** `[Add your Loom/Drive link here]`  
> **Submission Branch:** `main` (synced with the invited interview repository)

A high-fidelity full-stack audio application built with **Elixir/Phoenix API + React + Rust/WASM**.

Designed with the **“Field Recorder”** aesthetic: tactile, printed field notebook meets tape deck with warm paper tones, hairline rules, tabular numerals, 60fps LED ladder meters, and zero generic SaaS bloat.

---

## Deliverables Summary

| Deliverable | Status | Description |
|---|---|---|
| **Part 1: Record & Save** | Complete | In-browser mic capture, cross-browser codec negotiation, waveform playback, persistent storage |
| **Part 2: WASM DSP Effects** | Complete | Rust crate `timbre_kit` with 5 DSP filters, A/B buffer comparison, 16-bit WAV encoder |
| **Part 3: Multiplayer Studio** | Complete | Phoenix Channels WebSockets, LED VU meters, Multi-Take overdub layering, master take WAV mixer |
| **Bonus: AI Transcription** | Complete | Google Gemini 3.8 Flash multimodal audio transcription + stamped title & executive summary |
| **Deployment** | Complete | Live on Vercel with IndexedDB client-side fallback + Dockerfile / Render / Fly.io backend support |

---

## Architecture Overview

```
timbre/
├── api/                        Phoenix 1.8 JSON API + SQLite (Ecto) — :4010
│   ├── lib/timbre/             Recordings context, Sessions GenServer, WavEncoder, TranscriptionWorker
│   ├── lib/timbre_web/         RecordingsController, TranscriptionController, UserSocket, SessionChannel
│   └── priv/repo/migrations/   SQLite schema for recordings & transcripts
├── web/                        Vite + React 19 + Tailwind 4 — :5173
│   ├── src/components/         MicRecorder, WaveformMeter, RecordingsList, EffectPanel, TranscriptDrawer, Header
│   ├── src/pages/              RecorderPage (Voice Studio), SessionPage (Multiplayer Stage)
│   ├── src/lib/                audio-capture.ts, wasm-effects.ts, wav-encode.ts, socket.ts, api.ts, idb.ts
│   └── crates/timbre_kit/      Rust compiled to WebAssembly (wasm-pack)
├── Dockerfile                  Production multi-stage build (Rust WASM + Vite + Phoenix release)
├── render.yaml                 Render blueprint for 1-click backend deployment
├── fly.toml                    Fly.io deployment with persistent SQLite volume
└── vercel.json                 Vercel frontend deployment configuration
```

---

## Features Implemented

### Part 1: Record & Save Audio
- **True Cross-Browser Parity:** Standardized codec negotiation prioritizing `audio/webm;codecs=opus` → `audio/ogg;codecs=opus` → fallback.
- **Firefox Fix:** Uses native `AudioContext` without forcing sample rate (preventing Firefox crash) and passes hardware `sample_rate` as metadata.
- **Upload Limit Raised:** Configured `Plug.Parsers length: 200_000_000` (200MB), preventing the default 8MB / 80s upload cutoff.
- **Accurate Playback:** Uses backend-stored `duration_ms` so custom scrubbers and timelines work accurately regardless of missing container headers.
- **Dual Persistence:** Automatically uses server API when available, and smoothly falls back to browser **IndexedDB** on static hosts like Vercel.

### Part 2: WASM DSP Effects Lab
- **Rust Audio Engine (`timbre_kit`):**
  1. `apply_gain(samples, gain_db)`: Volume adjustment with strict `[-1.0, 1.0]` sample clamping.
  2. `normalize(samples, target_db)`: Peak scaling to target dBFS (e.g. -1.0 dBFS) with silence guard.
  3. `to_mono(samples, channels)`: Multichannel interleaved downmix into balanced mono.
  4. `noise_gate(samples, threshold_db, window_size, attack, release)`: Sliding-window RMS threshold gate with window-based smoothing.
  5. `anonymize_voice(samples, semitones, sample_rate)`: Pitch-shifting via linear interpolation resampling (Advanced Bonus).
- **A/B Comparison Player:** Instant live audio buffer swap during playback preserving playback position, dual stacked 56px canvases, and shared clay playhead.
- **Client-Side WAV Encoder (`wav-encode.ts`):** Converts processed `Float32Array` PCM into standard 16-bit WAV blobs to save back to the API.

### Part 3: Multiplayer Sessions & Multi-Take Master Merge
- **Phoenix Channels:** Real-time WebSockets mounted at `/socket` (`session:<id>`).
- **Low-Latency Worklet Streaming:** `web/public/pcm-processor.js` batches 4096-sample `Int16Array` frames (~85ms) on a dedicated audio rendering thread.
- **No Acoustic Loopback:** Audio streams only to the server. Participants receive live volume level signals to power 16-segment VU meters without feedback loops.
- **Multiple Takes & Overdub Layering:** A single participant can record multiple passes (`Take 1`, `Take 2`, etc.), select takes from the hardware Takes Ribbon, or re-record specific takes.
- **Timing Alignment & Clamping:** Server-side `Timbre.Sessions` GenServer records participant `start_ts` and pads delay silence before mixing, while `Timbre.WavEncoder` clamps summed samples to eliminate clipping. Overdub layers are synchronized so harmonies and backing tracks play together starting at `0:00`.

### Bonus: AI Transcription & Summarization (Gemini Multimodal)
- **Supervised Task:** Managed by `Timbre.TranscriptionSupervisor` in OTP supervision tree.
- **Single-Call Efficiency:** Transcribes and generates an 8-word stamped title + executive summary in a single Gemini 3.8 Flash request with structured JSON output.
- **Sequential Line Drawing:** Custom ruled-paper line drawing animation during processing (no generic shimmer skeletons).
- **One-Click Copy:** Verbatim transcript box with clipboard copy button.
- **Client-Side Fallback:** Supports direct client transcription via user-supplied API key when running on static hosting.

---

## Local Development

### Prerequisites
- Node.js 22+
- Elixir 1.18+ & Erlang/OTP 27+
- Rust & wasm-pack (if building WASM locally)

```bash
# 1. Install frontend dependencies and build
cd web
npm install
npm run typecheck

# 2. Run backend (in a separate terminal)
cd api
mix setup
mix phx.server

# 3. Run frontend
cd web
npm run dev
```

Visit **http://localhost:5173** to use the application.

---

## Deployment Guide

### Option 1: Deploy Frontend on Vercel (Split Deployment)
You can deploy the React frontend directly to **Vercel**:

1. Import the repository into Vercel.
2. Set **Root Directory** to `web` (or leave at root; `vercel.json` is configured for both).
3. Under **Environment Variables**, add:
   - `VITE_API_URL`: URL of your deployed Phoenix API (e.g. `https://timbre-api.fly.dev`)
   - `VITE_WS_URL`: WebSocket URL of your deployed Phoenix API (e.g. `wss://timbre-api.fly.dev/socket`)
4. Hit **Deploy**. The frontend will automatically route API and WebSocket traffic to your Phoenix backend.
   *(CORS and WebSocket origins are already pre-configured to allow Vercel domains).*

### Option 2: Deploy Full-Stack Single Container (Fly.io / Render / Docker)
Because Phoenix and SQLite require persistent storage and long-running WebSocket processes, running the full stack in a single container is the most robust setup:

```bash
# Deploy to Fly.io with a persistent SQLite volume
fly launch
fly volumes create timbre_data --size 1
fly deploy
```

---

## Testing

```bash
# Run web typecheck
cd web && npm run typecheck

# Run Elixir test suite
cd api && mix test

# Run Rust DSP unit tests
cd web/crates/timbre_kit && cargo test
```
