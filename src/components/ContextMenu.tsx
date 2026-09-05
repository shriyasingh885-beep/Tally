import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { IconCheck, IconReset, IconX } from './icons'

export interface CtxTarget {
  defId: string
  dateISO: string
  x: number
  y: number
}

export function ContextMenu({ target, onClose }: { target: CtxTarget; onClose: () => void }) {
  const setStatus = useApp((s) => s.setStatus)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: target.x, y: target.y })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.min(target.x, window.innerWidth - r.width - 8),
      y: Math.min(target.y, window.innerHeight - r.height - 8),
    })
  }, [target])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  const act = (status: 'present' | 'absent' | 'cancelled' | 'unmarked') => {
    setStatus(target.defId, target.dateISO, status)
    onClose()
  }

  return (
    <div className="ctx" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      <button role="menuitem" onClick={() => act('present')}>
        <IconCheck width={15} height={15} /> Mark present
      </button>
      <button role="menuitem" onClick={() => act('absent')}>
        <IconX width={15} height={15} /> Mark absent
      </button>
      <button role="menuitem" className="muted" onClick={() => act('cancelled')}>
        <IconX width={15} height={15} /> Class cancelled
      </button>
      <div className="sep" />
      <button role="menuitem" className="muted" onClick={() => act('unmarked')}>
        <IconReset width={15} height={15} /> Reset
      </button>
    </div>
  )
}
