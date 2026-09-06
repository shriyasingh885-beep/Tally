import { describe, expect, it } from 'vitest'
import { cleanTaskTitle, countDone, sortTasks } from './tasks'
import type { Task } from '../types'

const task = (p: Partial<Task> & { id: string }): Task => ({
  title: p.id,
  done: false,
  createdAt: '2026-09-06T09:00:00.000Z',
  ...p,
})

describe('ordering a to-do list', () => {
  it('puts unfinished work first, oldest at the top', () => {
    const list = sortTasks([
      task({ id: 'b', createdAt: '2026-09-06T11:00:00.000Z' }),
      task({ id: 'a', createdAt: '2026-09-06T09:00:00.000Z' }),
      task({ id: 'c', createdAt: '2026-09-06T13:00:00.000Z' }),
    ])
    expect(list.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('sinks finished items without losing them', () => {
    const list = sortTasks([
      task({ id: 'done-old', done: true, completedAt: '2026-09-06T10:00:00.000Z' }),
      task({ id: 'todo', createdAt: '2026-09-06T12:00:00.000Z' }),
    ])
    expect(list.map((t) => t.id)).toEqual(['todo', 'done-old'])
  })

  it('keeps the one you just ticked at the top of the finished group', () => {
    const list = sortTasks([
      task({ id: 'earlier', done: true, completedAt: '2026-09-06T10:00:00.000Z' }),
      task({ id: 'latest', done: true, completedAt: '2026-09-06T15:00:00.000Z' }),
    ])
    expect(list.map((t) => t.id)).toEqual(['latest', 'earlier'])
  })

  it('stays stable when two tasks were created in the same millisecond', () => {
    const same = '2026-09-06T09:00:00.000Z'
    const list = sortTasks([task({ id: 'b', createdAt: same }), task({ id: 'a', createdAt: same })])
    expect(list.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('does not mutate what it was given', () => {
    const input = [task({ id: 'z', done: true }), task({ id: 'a' })]
    sortTasks(input)
    expect(input.map((t) => t.id)).toEqual(['z', 'a'])
  })
})

describe('counting', () => {
  it('counts only the finished ones', () => {
    expect(countDone([task({ id: 'a', done: true }), task({ id: 'b' }), task({ id: 'c', done: true })])).toBe(2)
  })

  it('handles an empty list', () => {
    expect(countDone([])).toBe(0)
  })
})

describe('cleaning a title', () => {
  it('collapses stray whitespace', () => {
    expect(cleanTaskTitle('  Finish   DS   assignment \n')).toBe('Finish DS assignment')
  })

  it('treats a blank entry as nothing to add', () => {
    expect(cleanTaskTitle('   ')).toBe('')
    expect(cleanTaskTitle('')).toBe('')
  })

  it('caps a pasted essay so it cannot wreck the row', () => {
    expect(cleanTaskTitle('x'.repeat(500))).toHaveLength(140)
  })
})
