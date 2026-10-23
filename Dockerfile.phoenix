# ==============================================================================
# Multi-stage production build for Timbre:
# 1. Rust -> wasm32 compilation with pinned wasm-bindgen
# 2. Node -> Vite React build into Phoenix priv/static
# 3. Elixir -> Phoenix OTP release with SQLite
# 4. Minimal Debian runtime
# ==============================================================================

# Stage 1: Build Rust WASM
FROM rust:1.85-slim AS wasm-builder
RUN apt-get update && apt-get install -y --no-install-recommends curl build-essential pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown
RUN cargo install wasm-pack --version 0.13.1
WORKDIR /app
COPY web/crates/timbre_kit ./web/crates/timbre_kit
WORKDIR /app/web/crates/timbre_kit
RUN wasm-pack build --target web --out-dir pkg --release

# Stage 2: Build Vite Frontend Assets
FROM node:22-slim AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY --from=wasm-builder /app/web/crates/timbre_kit/pkg ./crates/timbre_kit/pkg
COPY web/ ./
RUN npx vite build --outDir ../api/priv/static

# Stage 3: Build Phoenix OTP Release
FROM hexpm/elixir:1.18.2-erlang-27.2.1-debian-bookworm-20250113-slim AS api-builder
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git && rm -rf /var/lib/apt/lists/*
WORKDIR /app/api
RUN mix local.hex --force && mix local.rebar --force
ENV MIX_ENV=prod
COPY api/mix.exs api/mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile
COPY api/config ./config
COPY api/lib ./lib
COPY api/priv ./priv
COPY --from=web-builder /app/api/priv/static ./priv/static
RUN mix phx.digest
RUN mix compile
RUN mix release

# Stage 4: Minimal Production Runner
FROM debian:bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
    libstdc++6 \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /data
ENV MIX_ENV=prod \
    PHX_SERVER=true \
    PORT=4010 \
    DATABASE_PATH=/data/timbre.db

COPY --from=api-builder /app/api/_build/prod/rel/timbre ./
EXPOSE 4010

CMD ["bin/timbre", "start"]
