import { useApp } from '../store/appStore'
import { IconMoon, IconSun } from './icons'

/**
 * Light/dark, one tap from wherever you are.
 *
 * The desktop header has had this since the start; on a phone it was buried in
 * a settings menu, which is the wrong place for something you flip when the
 * lights go off.
 */
export function ThemeToggle({ size = 19 }: { size?: number }) {
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const dark = theme === 'dark'
  return (
    <button
      className="icon-btn"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={dark}
      onClick={toggleTheme}
    >
      {dark ? <IconMoon width={size} height={size} /> : <IconSun width={size} height={size} />}
    </button>
  )
}
