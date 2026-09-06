import { useRef } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'

interface Options {
  onLeft: () => void
  onRight: () => void
  /** how far a thumb must travel before it counts as a swipe, in px */
  threshold?: number
}

/**
 * Horizontal swipe on a touch screen.
 *
 * Deliberately strict about which way the finger went: a gesture only counts
 * when it is clearly sideways, so scrolling a long day never flips the date by
 * accident. And because it only fires on touchend after a real distance, the
 * cards underneath still get their own taps — their press handler cancels
 * itself once a finger drifts, so a swipe can't mark attendance on the way past.
 */
export function useSwipe({ onLeft, onRight, threshold = 55 }: Options) {
  const start = useRef<{ x: number; y: number } | null>(null)

  return {
    onTouchStart(e: ReactTouchEvent) {
      if (e.touches.length !== 1) {
        start.current = null
        return
      }
      const t = e.touches[0]
      start.current = { x: t.clientX, y: t.clientY }
    },
    onTouchMove(e: ReactTouchEvent) {
      // a second finger means a pinch, not a swipe
      if (e.touches.length > 1) start.current = null
    },
    onTouchEnd(e: ReactTouchEvent) {
      const from = start.current
      start.current = null
      if (!from) return
      const t = e.changedTouches[0]
      if (!t) return
      const dx = t.clientX - from.x
      const dy = t.clientY - from.y
      if (Math.abs(dx) < threshold) return
      // mostly-vertical travel is a scroll
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) return
      if (dx < 0) onLeft()
      else onRight()
    },
  }
}
