import { useRef } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'

interface Options {
  onTap: () => void
  onLongPress: (x: number, y: number) => void
  longPressMs?: number
  moveThreshold?: number
}

/**
 * Shared press handling for anything that behaves like a class cell: a plain
 * tap toggles attendance, a long-press (touch) or right-click (desktop) opens
 * the correction menu, and neither fires if the pointer drifted (a scroll or
 * a text selection in progress).
 */
export function useTapOrLongPress({ onTap, onLongPress, longPressMs = 480, moveThreshold = 8 }: Options) {
  const down = useRef<{ x: number; y: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const moved = useRef(false)

  const clearTimer = () => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = undefined
    }
  }

  return {
    onPointerDown(e: ReactPointerEvent) {
      down.current = { x: e.clientX, y: e.clientY }
      moved.current = false
      if (e.pointerType === 'touch') {
        clearTimer()
        const x = e.clientX
        const y = e.clientY
        timer.current = window.setTimeout(() => {
          onLongPress(x, y)
          down.current = null
        }, longPressMs)
      }
    },
    onPointerMove(e: ReactPointerEvent) {
      if (!down.current) return
      if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > moveThreshold) {
        moved.current = true
        clearTimer()
      }
    },
    onPointerUp() {
      clearTimer()
    },
    onPointerCancel() {
      clearTimer()
      down.current = null
    },
    onClick() {
      clearTimer()
      if (moved.current || !down.current) {
        down.current = null
        return
      }
      down.current = null
      if (window.getSelection()?.toString()) return
      onTap()
    },
    // Keyboard activation bypasses the pointer guard entirely — a synthesised
    // click from Enter/Space has no preceding pointerdown, so without this a
    // keyboard user could focus a card and never be able to mark it.
    onKeyDown(e: ReactKeyboardEvent) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onTap()
      }
    },
    onContextMenu(e: ReactMouseEvent) {
      e.preventDefault()
      onLongPress(e.clientX, e.clientY)
    },
  }
}
