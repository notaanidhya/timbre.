import { useEffect, useState } from 'react'
import init, { rms_level } from 'timbre_kit'
import { API_BASE } from './lib/api'
import { Header } from './components/Header'
import { RecorderPage } from './pages/RecorderPage'
import { SessionPage } from './pages/SessionPage'

export default function App() {
  const [activeTab, setActiveTab] = useState<'studio' | 'multiplayer'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.has('room') || window.location.hash === '#multiplayer') {
        return 'multiplayer'
      }
    }
    return 'studio'
  })
  const [wasmReady, setWasmReady] = useState(false)
  const [apiReady, setApiReady] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)

  // Verify WASM init
  useEffect(() => {
    init()
      .then(() => {
        const testSignal = new Float32Array([1, -1, 1, -1])
        setWasmReady(rms_level(testSignal) > 0.99)
      })
      .catch(() => setWasmReady(false))
  }, [])

  // Check Phoenix API health
  useEffect(() => {
    const checkApi = () => {
      fetch(`${API_BASE}/healthz`)
        .then((res) => setApiReady(res.ok))
        .catch(() => setApiReady(false))
    }
    checkApi()
    const interval = setInterval(checkApi, 10000)
    return () => clearInterval(interval)
  }, [])

  // Listen for browser back/forward or hash changes to sync tabs
  useEffect(() => {
    const handleUrlChange = () => {
      const params = new URLSearchParams(window.location.search)
      if (params.has('room') || window.location.hash === '#multiplayer') {
        setActiveTab('multiplayer')
      }
    }
    window.addEventListener('popstate', handleUrlChange)
    window.addEventListener('hashchange', handleUrlChange)
    return () => {
      window.removeEventListener('popstate', handleUrlChange)
      window.removeEventListener('hashchange', handleUrlChange)
    }
  }, [])

  const handleSelectTab = (tab: 'studio' | 'multiplayer') => {
    setActiveTab(tab)
    if (tab === 'multiplayer') {
      const params = new URLSearchParams(window.location.search)
      if (!params.has('room')) {
        window.location.hash = '#multiplayer'
      }
    } else {
      if (window.location.hash === '#multiplayer') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }
  }

  return (
    <div className="relative min-h-screen bg-paper text-ink selection:bg-clay/20 selection:text-ink font-sans">
      {/* Paper grain overlay SVG with feTurbulence */}
      <svg className="paper-grain" xmlns="http://www.w3.org/2000/svg">
        <filter id="noiseFilter">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noiseFilter)" />
      </svg>

      {/* Main Field Recorder Header */}
      <Header
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        wasmReady={wasmReady}
        apiReady={apiReady}
        wsConnected={wsConnected}
      />

      {/* Main Page Area - keep both pages mounted so room & websocket state are preserved */}
      <main className="relative z-10 pb-20">
        <div style={{ display: activeTab === 'studio' ? 'block' : 'none' }}>
          <RecorderPage />
        </div>
        <div style={{ display: activeTab === 'multiplayer' ? 'block' : 'none' }}>
          <SessionPage
            onOpenVoiceStudio={() => handleSelectTab('studio')}
            onWsStateChange={setWsConnected}
          />
        </div>
      </main>
    </div>
  )
}
