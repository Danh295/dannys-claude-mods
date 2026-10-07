import type { Note } from '../types'

export function newNote(text: string, now: number): Note {
  const id = now.toString(36) + Math.random().toString(36).slice(2, 8)

  return { id, text, isPinned: false, createdAt: now }
}

export function addNote(list: readonly Note[], note: Note): Note[] {
  // In front, so the stable sort keeps it first among same-millisecond notes.
  return sortNotes([note, ...list])
}

export function removeNote(list: readonly Note[], id: string): Note[] {
  return list.filter(note => note.id !== id)
}

export function editNote(list: readonly Note[], id: string, text: string): Note[] {
  return list.map(note => (note.id === id ? { ...note, text } : note))
}

export function togglePin(list: readonly Note[], id: string): Note[] {
  return sortNotes(list.map(note => (note.id === id ? { ...note, isPinned: !note.isPinned } : note)))
}

/** Pinned first, then newest first. */
export function sortNotes(list: readonly Note[]): Note[] {
  return [...list].sort((a, b) =>
    a.isPinned === b.isPinned ? b.createdAt - a.createdAt : a.isPinned ? -1 : 1,
  )
}

/** A collapsed row's label: the first line as plain text, `…` when more follows, cut to `columns`. */
export function labelFor(note: Note, columns: number): string {
  const more = note.text.trim().includes('\n')
  const label = plainLabel(note.text) + (more ? ' …' : '')
  const room = Math.max(4, columns)

  return label.length > room ? label.slice(0, room - 1) + '…' : label
}

/** Puts a deleted note back in its sorted place; a note already there stays once. */
export function restoreNote(list: readonly Note[], note: Note): Note[] {
  return list.some(one => one.id === note.id) ? [...list] : sortNotes([note, ...list])
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How old a note is, in the fewest characters: `now`, `5m`, `2h`, `3d`, `4w`, `1y`. */
export function ageLabel(now: number, createdAt: number): string {
  const age = Math.max(0, now - createdAt)
  if (age < MINUTE) return 'now'
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`
  if (age < DAY) return `${Math.floor(age / HOUR)}h`
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d`
  if (age < 365 * DAY) return `${Math.floor(age / (7 * DAY))}w`

  return `${Math.floor(age / (365 * DAY))}y`
}

/** The text a focused note shows beneath its row: everything after the first line. */
export function previewText(text: string): string {
  const at = text.trim().indexOf('\n')

  return at < 0 ? '' : text.trim().slice(at + 1).trim()
}

/** A note's first line with its inline Markdown taken out, for a one-line row. */
export function plainLabel(text: string): string {
  const first = (text.trim().split('\n')[0] ?? '').trim()

  return first
    .replace(/^(#{1,6}|[-*+]|>|\d+[.)])\s+/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`|~~)(.+?)\1/g, '$2')
    .trim()
}

export type Layout = {
  start: number
  end: number
  above: number
  below: number
  /** Rows of the focused note's preview. */
  preview: number
  /** Whether the pinned rules are drawn; dropped in a pane too short for them. */
  rules: boolean
}

/** Rule rows a stretch of the list draws: one over the pinned notes, one under them. */
function ruleRows(list: readonly Note[], start: number, end: number): number {
  const drawn = list.slice(start, end)
  const pinned = drawn.some(note => note.isPinned)

  return pinned ? (drawn.some(note => !note.isPinned) ? 2 : 1) : 0
}

/**
 * Which notes to draw in `room` rows, counting the focused note's preview and
 * its row of keys, the pinned rules and the `n more` lines, so the tree never
 * outgrows the pane and the arrows keep walking. The focused note stays
 * centred with a drawn note on each side; a short pane gives up the preview
 * first, then the rules.
 */
export function layoutRows(
  list: readonly Note[],
  focusedId: string | null,
  room: number,
  previewRows: number,
): Layout {
  const count = list.length
  const index = Math.max(0, list.findIndex(note => note.id === focusedId))
  const most = Math.min(previewRows, Math.max(0, Math.floor((room - 5) / 2)))
  for (const rules of [true, false]) {
    for (let preview = most; preview >= 0; preview--) {
      const fixed = preview + 1
      const rulesIn = (start: number, end: number) => (rules ? ruleRows(list, start, end) : 0)
      if (count + fixed + rulesIn(0, count) <= room) {
        return { start: 0, end: count, above: 0, below: 0, preview, rules }
      }
      for (let shown = count - 1; shown >= 3; shown--) {
        const start = Math.min(Math.max(0, index - Math.floor(shown / 2)), count - shown)
        const end = start + shown
        const more = (start > 0 ? 1 : 0) + (end < count ? 1 : 0)
        if (shown + fixed + rulesIn(start, end) + more <= room) {
          return { start, end, above: start, below: count - end, preview, rules }
        }
      }
    }
  }
  const start = Math.min(index, Math.max(0, count - 1))

  return { start, end: Math.min(count, start + 1), above: start, below: Math.max(0, count - start - 1), preview: 0, rules: false }
}

/** A note row's key: the list's generation in it, so a re-sorted list draws new keys. */
export function rowKey(id: string, gen: number | string): string {
  return `note-${id}-${gen}`
}

/** The note id in a row key, or null for any other element. */
export function idOfRowKey(key: string | null): string | null {
  if (key === null || !key.startsWith('note-')) return null
  const end = key.lastIndexOf('-')

  return end > 'note-'.length ? key.slice('note-'.length, end) : key.slice('note-'.length)
}
