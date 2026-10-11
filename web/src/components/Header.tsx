import React from 'react'

interface HeaderProps {
  activeTab: 'studio' | 'multiplayer'
  onSelectTab: (tab: 'studio' | 'multiplayer') => void
  wasmReady: boolean
  apiReady: boolean
  wsConnected: boolean
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  wasmReady,
  apiReady,
  wsConnected,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-xs">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Left: timbre wordmark */}
        <div className="flex items-center gap-2">
          <span className="font-display text-2xl italic tracking-tight text-ink select-none">
            timbre<span className="inline-block ml-0.5 w-1.5 h-1.5 rounded-full bg-clay align-baseline" />
          </span>
          <span className="text-[10px] font-mono text-ink-3 uppercase tracking-widest pl-2 border-l border-rule hidden sm:inline-block">
            Field Recorder
          </span>
        </div>

        {/* Center: Text Navigation Tabs with sliding clay underline */}
        <nav className="flex items-center gap-8">
          <button
            type="button"
            onClick={() => onSelectTab('studio')}
            className={`relative py-5 text-sm font-sans font-medium transition-colors ${
              activeTab === 'studio' ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            Voice Studio
            {activeTab === 'studio' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-clay transition-all duration-200" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('multiplayer')}
            className={`relative py-5 text-sm font-sans font-medium transition-colors ${
              activeTab === 'multiplayer' ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            Multiplayer Room
            {activeTab === 'multiplayer' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-clay transition-all duration-200" />
            )}
          </button>
        </nav>

        {/* Right: Status cluster (6px square dot + mono label) */}
        <div className="flex items-center gap-3 text-xs font-mono text-ink-2">
          <div className="flex items-center gap-1.5" title={wasmReady ? 'Rust/WASM DSP loaded' : 'WASM initializing'}>
            <span
              className={`h-1.5 w-1.5 transition-all duration-150 ${
                wasmReady ? 'bg-moss' : 'border border-ink-3 bg-transparent'
              }`}
            />
            <span className="hidden md:inline">WASM · {wasmReady ? 'ready' : 'init'}</span>
          </div>

          <span className="text-rule">|</span>

          <div className="flex items-center gap-1.5" title={apiReady ? 'Phoenix API connected (:4010)' : 'API unreachable'}>
            <span
              className={`h-1.5 w-1.5 transition-all duration-150 ${
                apiReady ? 'bg-moss' : 'bg-brick'
              }`}
            />
            <span className="hidden md:inline">API · {apiReady ? 'ready' : 'offline'}</span>
          </div>

          <span className="text-rule">|</span>

          <div className="flex items-center gap-1.5" title={wsConnected ? 'WebSocket Channel active' : 'WebSocket standby'}>
            <span
              className={`h-1.5 w-1.5 transition-all duration-150 ${
                wsConnected ? 'bg-moss' : 'border border-ink-3 bg-transparent'
              }`}
            />
            <span className="hidden md:inline">WS · {wsConnected ? 'live' : 'idle'}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
