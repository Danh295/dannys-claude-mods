import { expect, test } from 'claude-code/testing'

import { ageLabel, layoutRows, newNote, plainLabel, previewText, restoreNote, sortNotes, togglePin } from './notes'

test('restore puts a deleted note back in its sorted place, once', () => {
  const older = newNote('older', 1)
  const newer = newNote('newer', 2)
  expect(restoreNote([older], newer).map(n => n.text)).toEqual(['newer', 'older'])
  const twice = restoreNote(restoreNote([older], newer), newer)
  expect(twice.map(n => n.text)).toEqual(['newer', 'older'])
})

test('ages read as now, minutes, hours, days, weeks, years', () => {
  const minute = 60_000
  const day = 24 * 60 * minute
  expect(ageLabel(100_000, 99_000)).toBe('now')
  expect(ageLabel(5 * minute, 0)).toBe('5m')
  expect(ageLabel(7_200_000, 0)).toBe('2h')
  expect(ageLabel(3 * day, 0)).toBe('3d')
  expect(ageLabel(29 * day, 0)).toBe('4w')
  expect(ageLabel(400 * day, 0)).toBe('1y')
})

test('the preview is what follows the first line', () => {
  expect(previewText('one\n**two**\nthree')).toBe('**two**\nthree')
  expect(previewText('solo')).toBe('')
  expect(previewText('  head  \n\n  body  ')).toBe('body')
})

test('labels drop inline markdown', () => {
  expect(plainLabel('**Fix** the `api` [docs](http://x)')).toBe('Fix the api docs')
  expect(plainLabel('# Title')).toBe('Title')
  expect(plainLabel('- item\nsecond line')).toBe('item')
  expect(plainLabel('> __quoted__')).toBe('quoted')
})

/** Rows a layout draws: notes, the focused note's preview and hint row, the rules, the "more" lines. */
function rowsUsed(list: ReturnType<typeof sortNotes>, l: ReturnType<typeof layoutRows>): number {
  const drawn = list.slice(l.start, l.end)
  const pinned = drawn.some(n => n.isPinned)
  const unpinned = drawn.some(n => !n.isPinned)
  const rules = l.rules ? (pinned ? 1 : 0) + (pinned && unpinned ? 1 : 0) : 0
  return drawn.length + l.preview + 1 + rules + (l.above > 0 ? 1 : 0) + (l.below > 0 ? 1 : 0)
}

test('layout never outgrows the room and keeps the focused note drawn', () => {
  let list = sortNotes(Array.from({ length: 30 }, (_, i) => newNote(`n${i}`, i)))
  list = togglePin(togglePin(list, list[20]!.id), list[25]!.id)
  for (const room of [7, 8, 10, 14, 20]) {
    for (let i = 0; i < list.length; i++) {
      const l = layoutRows(list, list[i]!.id, room, 4)
      expect(rowsUsed(list, l)).toBeLessThanOrEqual(room)
      expect(i).toBeGreaterThanOrEqual(l.start)
      expect(i).toBeLessThan(l.end)
      if (i > 0) expect(i - 1).toBeGreaterThanOrEqual(l.start)
      if (i < list.length - 1) expect(i + 1).toBeLessThan(l.end)
    }
  }
})

test('a short pane shrinks the preview to one line', () => {
  const list = sortNotes(Array.from({ length: 30 }, (_, i) => newNote(`n${i}`, i)))
  expect(layoutRows(list, list[10]!.id, 7, 4).preview).toBeLessThanOrEqual(1)
  expect(layoutRows(list, list[10]!.id, 20, 4).preview).toBe(4)
})

test('layout draws everything when it fits', () => {
  const list = [newNote('a', 2), newNote('b', 1), newNote('c', 0)]
  const l = layoutRows(list, list[0]!.id, 20, 4)
  expect(l).toEqual({ start: 0, end: 3, above: 0, below: 0, preview: 4, rules: true })
})
