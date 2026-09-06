import { useCallback, useRef, useState } from 'react'
import type * as React from 'react'
import { useApp } from './store/appStore'
import { useNow } from './hooks/useNow'
import { Header } from './components/Header'
import { TimetablePage } from './timetable/TimetablePage'
import { AttendancePage } from './attendance/AttendancePage'
import { ContextMenu, type CtxTarget } from './components/ContextMenu'
import { EditClassModal } from './components/EditClassModal'
import { SettingsMenu } from './components/SettingsMenu'

export function DesktopApp() {
  const rawPage = useApp((s) => s.page)
  // 'home' only exists in the mobile shell — desktop never lands there.
  const page = rawPage === 'home' ? 'timetable' : rawPage
  const setPage = useApp((s) => s.setPage)
  const goToday = useApp((s) => s.goToday)
  const storageOk = useApp((s) => s.storageOk)
  const retrySave = useApp((s) => s.retrySave)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)

  const now = useNow(30_000)

  const [ctx, setCtx] = useState<CtxTarget | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [settingsAnchor, setSettingsAnchor] = useState<DOMRect | null>(null)

  const openContext = useCallback((defId: string, dateISO: string, x: number, y: number) => {
    setCtx({ defId, dateISO, x, y })
  }, [])

  // `inert` isn't in React 18's JSX types yet; apply it as a raw attribute.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inertWhen = (hidden: boolean): any => (hidden ? { inert: '' } : {})

  // ---- swipe between the two panes -------------------------------------------
  const viewportRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{
    x: number
    y: number
    axis: 'x' | 'y' | null
    fromCell: boolean
    w: number
  } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const w = viewportRef.current?.clientWidth ?? window.innerWidth
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      axis: null,
      fromCell: !!(e.target as HTMLElement).closest?.('.cell, .ctx, .menu, .modal, input, select, button'),
      w,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      if (Math.abs(dx) > Math.abs(dy) * 1.3 && Math.abs(dx) > (g.fromCell ? 30 : 12)) {
        g.axis = 'x'
        setDragging(true)
      } else {
        g.axis = 'y'
      }
    }
    if (g.axis !== 'x') return
    const lo = page === 'timetable' ? -g.w : 0
    const hi = page === 'timetable' ? 0 : g.w
    setDrag(Math.max(lo, Math.min(hi, dx)))
  }

  const endGesture = () => {
    const g = gesture.current
    gesture.current = null
    setDragging(false)
    if (g?.axis === 'x') {
      const threshold = Math.min(g.w * 0.22, 110)
      if (page === 'timetable' && drag < -threshold) setPage('attendance')
      else if (page === 'attendance' && drag > threshold) setPage('timetable')
    }
    setDrag(0)
  }

  const trackBase = page === 'attendance' ? '-50%' : '0%'

  return (
    <div className="app">
      <Header
        page={page}
        onPage={setPage}
        onToday={() => {
          goToday()
          setPage('timetable')
        }}
        onOpenSettings={(a) => setSettingsAnchor(a)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div
        className="viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <div
          className={`track${dragging ? ' dragging' : ''}`}
          style={{ transform: `translateX(calc(${trackBase} + ${drag}px))` }}
        >
          <section className="pane" aria-label="Timetable" {...inertWhen(page !== 'timetable')}>
            <TimetablePage now={now} onContext={openContext} />
          </section>
          <section className="pane" aria-label="Attendance" {...inertWhen(page !== 'attendance')}>
            <AttendancePage now={now} onOpenSettings={setSettingsAnchor} />
          </section>
        </div>
      </div>

      {ctx && <ContextMenu target={ctx} onClose={() => setCtx(null)} onEdit={setEditingId} />}
      {editingId && <EditClassModal defId={editingId} onClose={() => setEditingId(null)} />}
      {settingsAnchor && (
        <SettingsMenu anchor={settingsAnchor} onClose={() => setSettingsAnchor(null)} />
      )}

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
