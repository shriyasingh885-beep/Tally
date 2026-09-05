import { del, get, set } from 'idb-keyval'
import type { PersistedState } from '../types'

const KEY = 'tally:v1'
const LS_KEY = 'tally:v1:fallback'

export const STATE_VERSION = 1

let idbBroken = false

async function idbGet(): Promise<PersistedState | undefined> {
  try {
    return (await get(KEY)) as PersistedState | undefined
  } catch {
    idbBroken = true
    return undefined
  }
}

function lsGet(): PersistedState | undefined {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as PersistedState) : undefined
  } catch {
    return undefined
  }
}

export async function loadState(): Promise<PersistedState | null> {
  const fromIdb = await idbGet()
  if (fromIdb) return fromIdb
  const fromLs = lsGet()
  if (fromLs) return fromLs
  return null
}

/** Returns true if the write landed somewhere durable. */
export async function saveState(state: PersistedState): Promise<boolean> {
  let ok = false
  if (!idbBroken) {
    try {
      await set(KEY, state)
      ok = true
    } catch {
      idbBroken = true
    }
  }
  // Mirror to localStorage as a cheap redundancy / fallback.
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
    ok = true
  } catch {
    /* quota or disabled */
  }
  return ok
}

export async function clearState(): Promise<void> {
  try {
    await del(KEY)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LS_KEY)
  } catch {
    /* ignore */
  }
}

/** Debounced writer with an immediate-flush option for attendance clicks. */
export function createSaver() {
  let timer: number | undefined
  let pending: PersistedState | null = null
  let lastOk = true
  const listeners = new Set<(ok: boolean) => void>()

  async function write(state: PersistedState) {
    const ok = await saveState(state)
    if (ok !== lastOk) {
      lastOk = ok
      listeners.forEach((l) => l(ok))
    }
  }

  return {
    onStatus(l: (ok: boolean) => void) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    schedule(state: PersistedState) {
      pending = state
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        if (pending) void write(pending)
      }, 180)
    },
    async flush(state: PersistedState) {
      pending = null
      if (timer) {
        window.clearTimeout(timer)
        timer = undefined
      }
      await write(state)
    },
  }
}
