# timbre

A **Phoenix + React + Rust/WASM** scaffold — the starting point for the
full-stack engineering assignment. You'll be given a feature to build on top of
it. Using AI tools is expected and allowed — what matters is that you deeply
understand and can reason about the code you submit.

```
timbre/
├── api/                        Phoenix 1.8 JSON API + SQLite (Ecto) — :4010
│   └── lib/timbre_web/         controllers (health, hello) + router
├── web/                        Vite + React 19 + Tailwind 4 — :5173
│   ├── src/                    App.tsx — status of the API + WASM legs
│   └── crates/timbre_kit/      Rust → WASM (the DSP seam)
├── flake.nix                   pinned toolchain (Elixir, Node, Rust + wasm)
├── justfile                    setup / dev / build / test / db-*
└── ASSIGNMENT.md               the assignment brief
```

## Quick start

The whole toolchain (Elixir/OTP, Node, Rust + the `wasm32` target, `wasm-pack`,
`wasm-bindgen`, `just`) is pinned by the **Nix flake** — you don't install any of
it by hand.

```bash
# with Nix (flakes) + direnv:
direnv allow          # drops you into the dev shell automatically (uses flake.nix)
# ...or without direnv:
nix develop --impure  # same shell, one-off

just setup     # build WASM, install web deps, set up the API + SQLite DB
just dev       # API :4010 + web :5173 together
```

No Nix? Install the toolchain yourself — Elixir 1.18+, Node 22+, Rust via
[rustup](https://rustup.rs) (bundles the wasm linker), plus
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/) and
[`just`](https://github.com/casey/just) — then run the same `just` commands.

Open http://localhost:5173 — when both status dots turn blue, the full stack
(Phoenix API + Rust/WASM) is wired.

| Command          | What                                             |
| ---------------- | ------------------------------------------------ |
| `just setup`     | build WASM + install all deps                    |
| `just dev`       | run API and web together                         |
| `just api`       | Phoenix only (IEx-attached), :4010               |
| `just web`       | Vite dev server only, :5173                      |
| `just build-wasm`| recompile the Rust crate to WASM                 |
| `just build`     | production build of web + API                    |
| `just db-migrate`| run pending SQLite migrations                    |
| `just test`      | Rust (`cargo test`) + Elixir (`mix test`) suites |
| `just check`     | web typecheck + API format check                 |

Run `just --list` for everything else (`db-setup`, `db-gen-migration`, `db-reset`).
