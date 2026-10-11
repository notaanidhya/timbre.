# timbre — Field Recorder & Audio Studio

> **Live Application:** **[https://timbre-studio.vercel.app](https://timbre-studio.vercel.app)**  
> **Demo Video:** **[https://youtu.be/ecTUnFGKZMY](https://youtu.be/ecTUnFGKZMY)**

A high-fidelity full-stack audio application built with **Elixir/Phoenix API + React + Rust/WASM**.

Designed with the **“Field Recorder”** aesthetic: tactile, printed field notebook meets tape deck with warm paper tones, hairline rules, tabular numerals, 60fps LED ladder meters, and zero generic SaaS bloat.

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

## Technical Highlights & Features

### Part 1: Record & Save Audio
- **Cross-Browser Audio Capture:** Standardized codec negotiation prioritizing `audio/webm;codecs=opus` → `audio/ogg;codecs=opus` with container metadata preservation.
- **Hardware-Aware Audio Context:** Uses native browser `AudioContext` without forcing sample rate (preventing Firefox audio context panics) while passing hardware `sample_rate` as metadata.
- **High-Capacity Ingestion:** Raised `Plug.Parsers` body limit to 200MB, eliminating the standard 8MB / 80-second upload cutoff for extended sessions.
- **Accurate Waveform Scrubbing:** Custom scrubbers and canvas renderers rely on server-computed `duration_ms` rather than imprecise browser container headers.
- **Resilient Dual Storage:** Persists to the Phoenix API + SQLite database when connected, with transparent fallback to browser **IndexedDB** on static hosting.

### Part 2: Rust/WASM DSP Audio Engine (`timbre_kit`)
- **WebAssembly DSP Pipeline:** High-performance, zero-garbage-collection audio processing routines:
  1. `apply_gain(samples, gain_db)`: Volume adjustment with strict `[-1.0, 1.0]` sample clamping.
  2. `normalize(samples, target_db)`: Peak scaling to target dBFS with silence-floor guards.
  3. `to_mono(samples, channels)`: Interleaved multichannel downmixing to balanced mono.
  4. `noise_gate(samples, threshold_db, window_size, attack, release)`: Sliding-window RMS threshold gate with window-based smoothing.
  5. `anonymize_voice(samples, semitones, sample_rate)`: Formant/pitch modulation via linear interpolation resampling.
- **Seamless A/B Comparison Player:** Instant audio buffer swap during playback preserving real-time playhead position across stacked 56px canvas waveforms.
- **Client-Side WAV Encoder (`wav-encode.ts`):** Converts processed `Float32Array` PCM into standardized 16-bit WAV containers for persistent storage.

### Part 3: Multiplayer Sessions & Multi-Take Studio
- **Phoenix Channels Real-Time Fabric:** Real-time WebSockets mounted at `/socket` (`session:<id>`) managing presence and room state.
- **Low-Latency Audio Worklet:** `pcm-processor.js` batches 4096-sample `Int16Array` frames (~85ms) on a dedicated audio thread, keeping the UI at 60fps.
- **Feedback-Free Monitoring:** Streams live PCM to the server mixer while broadcasting volume telemetry to peers to power 16-segment LED VU meters without acoustic feedback.
- **Multi-Take Overdub Layering:** Musicians can record multiple synchronized passes (`Take 1`, `Take 2`, etc.), select takes from the Takes Ribbon, or punch-in re-records.
- **Server-Side Sample Summing & Alignment:** `Timbre.Sessions` GenServer aligns timestamps, inserts silence padding for late joiners, and sums multi-track layers with soft-clipping protection via `Timbre.WavEncoder`.

### Bonus: AI Transcription & Summarization (Gemini Multimodal)
- **Supervised Background Tasks:** Managed under OTP supervision tree (`Timbre.TranscriptionSupervisor`).
- **Single-Shot Multimodal Analysis:** Generates an 8-word stamped title, executive summary, and verbatim transcript in a single Google Gemini request using structured JSON schemas.
- **Sequential Line Drawing:** Custom ruled-paper line drawing animation during processing states.
- **Dual-Mode Execution:** Server-side Gemini API execution with client-side key injection fallback for static deployments.

---

## Local Development

### Prerequisites
- Node.js 22+
- Elixir 1.18+ & Erlang/OTP 27+
- Rust & wasm-pack
- `just` task runner (recommended)

### Quickstart (with `just`)

```bash
# 1. Setup everything (compiles WASM, installs frontend & backend dependencies)
just setup

# 2. Start Phoenix API (:4010) and Vite frontend (:5173) concurrently
just dev
```

### Manual Setup

```bash
# 1. Build WASM package & install web dependencies
cd web
npm install
npm run build:wasm

# 2. Start Phoenix API (Terminal 1)
cd ../api
mix setup
mix phx.server

# 3. Start Frontend (Terminal 2)
cd ../web
npm run dev
```

The application will be live at **http://localhost:5173** (proxies `/api` and `/socket` to `:4010`).

---

## Testing & Quality

```bash
# Run all suites (Rust + Elixir)
just test

# Run type checking & Elixir format checks
just check

# Or test individual components:
cd web && npm run typecheck            # TypeScript typecheck
cd api && mix test                     # Phoenix API / OTP tests
cd web/crates/timbre_kit && cargo test # Rust DSP unit tests
```

---

## Deployment

### Option 1: Static Frontend (Vercel)
The React client can run standalone on **Vercel** with client-side IndexedDB storage:
1. Import repository into Vercel (Root Directory: `web` or repo root; `vercel.json` handles both).
2. Set environment variables (optional, to connect a live Phoenix backend):
   - `VITE_API_URL`: Backend URL (e.g. `https://timbre-api.fly.dev`)
   - `VITE_WS_URL`: WebSocket URL (e.g. `wss://timbre-api.fly.dev/socket`)
3. Deploy.

### Option 2: Full-Stack Container (Fly.io / Render / Docker)
Because Phoenix Channels and SQLite benefit from persistent storage and persistent WebSocket processes, single-container deployment is supported via the root `Dockerfile`:

```bash
# Deploy to Fly.io with a persistent volume for SQLite
fly launch
fly volumes create timbre_data --size 1
fly deploy
```
