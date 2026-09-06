import { useEffect, useState } from 'react'

const QUERY = '(max-width: 767px)'

/** Drives which shell (mobile app / desktop app) renders — a deliberate product choice, not a squeeze-to-fit. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(QUERY).matches : false,
  )
  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    // Some environments (device emulation, split-screen resizes) resize the
    // viewport without firing a matchMedia change, so watch resize as well.
    window.addEventListener('resize', onChange)
    return () => {
      mql.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [])
  return isMobile
}
