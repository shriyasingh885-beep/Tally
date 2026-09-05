import { useCallback, useState } from 'react'
import { useApp } from './store/appStore'
import { useNow } from './hooks/useNow'
import { useOrientation } from './hooks/useOrientation'
import { MobileHome } from './mobile/MobileHome'
import { MobileTimetable } from './mobile/MobileTimetable'
import { AttendancePage } from './attendance/AttendancePage'
import { BottomNav } from './mobile/BottomNav'
import { ContextMenu, type CtxTarget } from './components/ContextMenu'
import { SettingsMenu } from './components/SettingsMenu'
import { RotateOverlay } from './components/RotateOverlay'

export function MobileApp() {
  const page = useApp((s) => s.page)
  const setPage = useApp((s) => s.setPage)
  const storageOk = useApp((s) => s.storageOk)
  const retrySave = useApp((s) => s.retrySave)

  const now = useNow(30_000)
  const orient = useOrientation()

  const [ctx, setCtx] = useState<CtxTarget | null>(null)
  const [settingsAnchor, setSettingsAnchor] = useState<DOMRect | null>(null)

  const openContext = useCallback((defId: string, dateISO: string, x: number, y: number) => {
    setCtx({ defId, dateISO, x, y })
  }, [])

  const showRotate = orient.needsRotate && page === 'timetable'

  return (
    <div className="app mobile-app">
      <div className="m-content">
        {page === 'home' && (
          <MobileHome now={now} onNavigate={setPage} onOpenSettings={setSettingsAnchor} />
        )}
        {page === 'timetable' && (
          <MobileTimetable now={now} onContext={openContext} onOpenSettings={setSettingsAnchor} />
        )}
        {page === 'attendance' && <AttendancePage now={now} onOpenSettings={setSettingsAnchor} />}
      </div>

      <BottomNav page={page} onChange={setPage} />

      {ctx && <ContextMenu target={ctx} onClose={() => setCtx(null)} />}
      {settingsAnchor && (
        <SettingsMenu anchor={settingsAnchor} onClose={() => setSettingsAnchor(null)} />
      )}
      {showRotate && <RotateOverlay onViewAttendance={() => setPage('attendance')} />}

      {!storageOk && (
        <div className="toast" role="status">
          Your changes couldn’t be saved.{' '}
          <button className="link-btn" style={{ color: 'var(--bg)' }} onClick={retrySave}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
