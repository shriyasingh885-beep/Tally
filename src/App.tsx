import { useEffect } from 'react'
import { useApp } from './store/appStore'
import { useIsMobile } from './hooks/useIsMobile'
import { SetupFlow } from './setup/SetupFlow'
import { DesktopApp } from './DesktopApp'
import { MobileApp } from './MobileApp'

export function App() {
  const hydrated = useApp((s) => s.hydrated)
  const phase = useApp((s) => s.phase)
  const hydrate = useApp((s) => s.hydrate)
  const isMobile = useIsMobile()

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (!hydrated) {
    return (
      <div className="app">
        <div className="boot">Loading…</div>
      </div>
    )
  }

  if (phase === 'setup') {
    return (
      <div className="app">
        <header className="header" style={{ gridTemplateColumns: '1fr' }}>
          <div className="brand">
            Tally<span className="dot">.</span>
          </div>
        </header>
        <SetupFlow />
      </div>
    )
  }

  return isMobile ? <MobileApp /> : <DesktopApp />
}
