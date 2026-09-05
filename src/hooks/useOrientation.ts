import { useEffect, useState } from 'react'

export interface OrientationInfo {
  portrait: boolean
  /** viewport width in px */
  width: number
  height: number
  /** small screen held upright — the timetable should ask to rotate */
  needsRotate: boolean
}

function read(): OrientationInfo {
  const width = window.innerWidth
  const height = window.innerHeight
  const portrait = height >= width
  // The mobile shell (Home + single-day agenda) handles ordinary phone
  // portrait widths on its own now. This only fires as a safety net for
  // widths too narrow for even that — genuinely unusable, not just "a phone".
  const needsRotate = portrait && width < 300
  return { portrait, width, height, needsRotate }
}

export function useOrientation(): OrientationInfo {
  const [info, setInfo] = useState(read)
  useEffect(() => {
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setInfo(read()))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])
  return info
}
