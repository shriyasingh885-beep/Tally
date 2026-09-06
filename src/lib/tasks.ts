import type { Task } from '../types'

/**
 * Order a to-do list the way it gets read.
 *
 * Unfinished work first, oldest at the top, because the point of the list is to
 * put the next thing to do under your thumb. Finished items sink but do not
 * disappear — seeing what you got done is half of why anyone keeps a list — and
 * the one you just ticked sits at the top of that group, where you'd look to
 * undo a mis-tap.
 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (a.done) return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  })
}

export function countDone(tasks: Task[]): number {
  return tasks.reduce((n, t) => (t.done ? n + 1 : n), 0)
}

/**
 * A task title worth storing. Collapses whitespace and caps the length so a
 * pasted essay can't wreck the layout; empty means "don't add it".
 */
export function cleanTaskTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 140)
}
