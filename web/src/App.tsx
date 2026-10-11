import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// The default export loads the .wasm; the named export is our Rust fn.
import init, { rms_level } from 'timbre_kit'
// The assignment brief, rendered at /. Lives at the repo root; ?raw inlines it.
import assignment from '../../ASSIGNMENT.md?raw'

export default function App() {
  const [wasmOk, setWasmOk] = useState(false)
  const [apiOk, setApiOk] = useState(false)

  // Boot WASM and confirm it runs (RMS of a full-scale signal ≈ 1).
  useEffect(() => {
    init()
      .then(() => setWasmOk(rms_level(new Float32Array([1, -1, 1, -1])) > 0.99))
      .catch(() => setWasmOk(false))
  }, [])

  // Reach the Phoenix API through the dev proxy.
  useEffect(() => {
    fetch('/api/hello')
      .then((r) => setApiOk(r.ok))
      .catch(() => setApiOk(false))
  }, [])

  const Dot = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className="inline-flex items-center gap-1.5 text-xs text-mute">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-link' : 'bg-hairline-strong'}`} />
      {label}
    </span>
  )

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <span className="font-semibold tracking-tight text-ink">timbre</span>
          <div className="flex items-center gap-4">
            <Dot ok={wasmOk} label="WASM" />
            <Dot ok={apiOk} label="API" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <article
          className="prose prose-neutral max-w-none dark:prose-invert prose-headings:text-ink prose-a:text-link prose-code:before:content-none prose-code:after:content-none"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{assignment}</ReactMarkdown>
        </article>
      </main>
    </div>
  )
}
