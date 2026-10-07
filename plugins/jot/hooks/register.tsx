import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, UiOpenResult } from 'claude-code'

import type { Note } from '../types'
import type { ActionKey } from './keys'
import { addNote, editNote, idOfRowKey, newNote, removeNote, restoreNote, togglePin } from './notes'
import { drawPane, selectedRowKey } from './view'
import type { PaneModel } from './view'

// Every function that takes `$`, and every atom, lives in this file: the
// engine follows `$` and state references only within the module's own file.

const notes = atom({ plugin: 'jot', key: 'notes' } as const, [])
const focusedId = atom({ plugin: 'jot', key: 'focusedId' } as const, null)
const editingId = atom({ plugin: 'jot', key: 'editingId' } as const, null)
const lastPrompt = atom({ plugin: 'jot', key: 'lastPrompt' } as const, null)
const draftGen = atom({ plugin: 'jot', key: 'draftGen' } as const, 0)
const ringOn = atom({ plugin: 'jot', key: 'ringOn' } as const, null)
const listGen = atom({ plugin: 'jot', key: 'listGen' } as const, 0)
const lastDeleted = atom({ plugin: 'jot', key: 'lastDeleted' } as const, null)
const showKeys = atom({ plugin: 'jot', key: 'showKeys' } as const, false)

const AGAIN = 'ctrl+x tab for another.'

// The keys the ring can reach, in drawing order, as the last draw reported
// them: what the focus hook steers by. Redrawn on every render, so a reload
// losing it costs nothing.
let reachable: string[] = []

// The list window's first row as last drawn. A scroll draws every row under a
// new key, and the engine's ring keeps a place, not a key, so a scroll
// re-seats the ring on the selected note by its new key.
let windowStart: number | null = null

// The last model the pane was drawn from: what an action's selection is laid
// out against to know the row key it will be drawn under.
let lastModel: PaneModel | null = null

/** Where a ring may rest: a note row or the new-note field; the rest have hotkeys. */
function isRestingKey(key: string): boolean {
  return key.startsWith('note-') || key.startsWith('draft-')
}

/**
 * Where a move of the person's ring onto `target` should land instead: the
 * nearest resting key past it in the direction of travel, or null to stay.
 */
function steer(from: string | null, target: string): string | null {
  const to = reachable.indexOf(target)
  const at = from === null ? -1 : reachable.indexOf(from)
  const step = at >= 0 && to < at ? -1 : 1
  for (let i = to + step; i >= 0 && i < reachable.length; i += step) {
    if (isRestingKey(reachable[i]!)) return reachable[i]!
  }

  return null
}

// ── Store ──────────────────────────────────────────────────────────────────

const STORE_KEY = 'notes'

/** The notes this session starts with: the store's, unless state already holds some (a reload). */
async function loadNotes($: EngineInterface): Promise<Note[]> {
  const current = await read($, notes)
  if (current.length > 0) {
    return current
  }
  const kept = await $.store.get(STORE_KEY)
  if (Array.isArray(kept) && kept.length > 0) {
    await update($, notes, () => kept as Note[])

    return kept as Note[]
  }

  return current
}

/**
 * Applies `change` to the notes as the store holds them, not this session's
 * copy, so a note another open session saved is never overwritten.
 */
async function saveNotes($: EngineInterface, change: (list: Note[]) => Note[]): Promise<Note[]> {
  const kept = await $.store.get(STORE_KEY)
  const base = Array.isArray(kept) ? (kept as Note[]) : await read($, notes)
  const next = change(base)
  await $.store.set(STORE_KEY, next)
  await update($, notes, () => next)
  await update($, listGen, n => n + 1)

  return next
}

async function jot($: EngineInterface, text: string): Promise<Note | undefined> {
  const trimmed = text.trim()
  if (trimmed === '') {
    return undefined
  }
  const note = newNote(trimmed, await $.clock.now())
  await saveNotes($, list => addNote(list, note))

  return note
}

// ── Focus ──────────────────────────────────────────────────────────────────

const PANE = 'jot'
const TITLE = 'Notes'

/** Moves the pane's focus ring; best effort, so a refused move never sinks the action. */
async function focusKey($: EngineInterface, key: string): Promise<void> {
  try {
    await $.ui.focus({ requestId: PANE, key })
  } catch {
    // The ring stays where it was; the person can still arrow to it.
  }
}

/**
 * Hands the keyboard back to the prompt without Esc: closing the pane returns
 * the keys, and reopening it without `focus` keeps it on screen.
 */
async function returnToPrompt($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE })
  await $.ui.open({ id: PANE, title: TITLE })
}

/** Opens the pane with the keyboard, reseating one left waiting undrawn. */
async function openFocused($: EngineInterface): Promise<UiOpenResult> {
  let opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
  if (!opened.isPlaced) {
    // The unasked open at session start can leave the pane waiting undrawn
    // on a narrow terminal, and opening an open id only retitles it: close
    // that instance so this asked open seats a fresh one.
    await $.ui.close({ id: PANE })
    opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
  }

  return opened
}

// ── Actions ────────────────────────────────────────────────────────────────

/** What an action leaves for the pane to do: where the ring goes, what to say. */
type Outcome = {
  /** An element to move the ring to by key: the draft field. */
  focus?: string
  /** A note to select and move the ring to; its row key is worked out at apply. */
  select?: string
  toast?: string
  toPrompt?: true
}

type ActionContext = { note?: Note; list: Note[]; surface: RenderSurface }

async function grabSelection($: EngineInterface): Promise<string> {
  const selected = await $.ui.selection()
  if (selected === undefined || selected.text.trim() === '') {
    return 'Nothing is selected. Select text with the mouse first (fullscreen terminal).'
  }
  await jot($, selected.text)

  return 'Saved the selection as a note.'
}

async function paste($: EngineInterface, text: string, mode: 'insert' | 'replace'): Promise<Outcome> {
  const filled = await $.prompt.fill({ text, mode })
  if (!filled.isFilled) {
    return { toast: `Could not paste${filled.refusal ? ` (${filled.refusal})` : ''}.` }
  }

  // The fill hands the keys to the prompt by itself; an Esc now would be the
  // prompt's (and stops a running reply), so the toast never asks for one.
  return { toast: mode === 'insert' ? `Pasted. ${AGAIN}` : `Prompt replaced. ${AGAIN}` }
}

/** The note the action buttons act on: the highlighted one, else the first. */
async function target($: EngineInterface): Promise<Note | undefined> {
  const list = await read($, notes)
  const id = await read($, focusedId)

  return list.find(note => note.id === id) ?? list[0]
}

/** Saves the draft field: an edit of the note being edited, else a new note. */
async function submitDraft($: EngineInterface, value: string): Promise<Outcome> {
  const text = value.trim()
  const id = await read($, editingId)
  await update($, editingId, () => null)
  // Edit only a note that still exists; one deleted meanwhile makes this an add.
  if (id !== null && (await read($, notes)).some(note => note.id === id)) {
    if (text !== '') {
      await saveNotes($, current => editNote(current, id, text))
    }
    await update($, draftGen, n => n + 1)

    return { select: id }
  }
  if (text === '') {
    return {}
  }
  await jot($, text)
  const nextGen = await update($, draftGen, n => n + 1)

  return { focus: `draft-${nextGen}` }
}

async function runAction($: EngineInterface, key: ActionKey, ctx: ActionContext): Promise<Outcome> {
  if (key === 'grab') {
    return { toast: await grabSelection($) }
  }
  if (key === 'last') {
    const prompt = await read($, lastPrompt)
    if (prompt === null) {
      return { toast: 'No prompt sent yet this session.' }
    }
    await jot($, prompt)

    return { toast: 'Saved the last prompt as a note.' }
  }
  if (key === 'prompt') {
    return { toPrompt: true }
  }
  if (key === 'add') {
    return { focus: `draft-${await read($, draftGen)}` }
  }
  if (key === 'keys') {
    await update($, showKeys, shown => !shown)

    return {}
  }
  if (key === 'undo') {
    const gone = await read($, lastDeleted)
    if (gone === null) {
      return { toast: 'Nothing to undo.' }
    }
    await saveNotes($, current => restoreNote(current, gone))
    await update($, lastDeleted, () => null)
    await update($, focusedId, () => gone.id)

    return { select: gone.id, toast: 'Restored.' }
  }
  const note = ctx.note
  if (note === undefined) {
    return { toast: 'No note to act on.' }
  }
  if (key === 'delete') {
    const after = await saveNotes($, current => removeNote(current, note.id))
    await update($, lastDeleted, () => note)
    await update($, editingId, id => (id === note.id ? null : id))
    const index = ctx.list.findIndex(one => one.id === note.id)
    const neighbour = after[Math.min(index, after.length - 1)]
    await update($, focusedId, () => neighbour?.id ?? null)
    const toast = 'Deleted. u undoes it.'

    return neighbour === undefined ? { toast } : { select: neighbour.id, toast }
  }
  if (key === 'edit') {
    await update($, editingId, () => note.id)
    const nextGen = await update($, draftGen, n => n + 1)

    return { focus: `draft-${nextGen}` }
  }
  if (key === 'pin') {
    await saveNotes($, current => togglePin(current, note.id))
    await update($, focusedId, () => note.id)

    // The re-sort draws new keys, so the focus call waits for that drawing
    // instead of landing on the note's old place in this one.
    return { select: note.id }
  }
  if (key === 'copy') {
    const copied = await $.ui.copy({ text: note.text, surface: ctx.surface })

    return { toast: copied.isCopied ? 'Copied to the clipboard.' : 'Could not copy.' }
  }

  return paste($, note.text, 'replace')
}

// ── Wiring ─────────────────────────────────────────────────────────────────

/** Does what an action left for the pane: moves the ring, says its line, hands back the keys. */
async function apply($: EngineInterface, outcome: Outcome): Promise<void> {
  if (outcome.select !== undefined && lastModel !== null) {
    const id = outcome.select
    await update($, focusedId, () => id)
    const model = { ...lastModel, list: await read($, notes), focused: id, listGen: await read($, listGen) }
    outcome = { ...outcome, focus: selectedRowKey(model, id) }
  }
  if (outcome.focus !== undefined) {
    const key = outcome.focus
    await update($, ringOn, () => key)
    await focusKey($, key)
  }
  if (outcome.toast !== undefined) {
    $.ui.toast(outcome.toast)
  }
  if (outcome.toPrompt) {
    await returnToPrompt($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadNotes($)
    await $.command.register({
      name: 'notes',
      description: 'Notes pane: /notes to pick a note, /notes <n> to paste note n',
      argumentHint: '[n]',
    })
    await $.command.register({
      name: 'note',
      description: 'Save a note: /note <text>, or /note alone to save the mouse selection',
      argumentHint: '[text]',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'notes' }, async ($, e) => {
    const arg = e.args.trim()
    if (/^\d+$/.test(arg)) {
      const n = Number(arg)
      const note = (await read($, notes))[n - 1]
      if (note === undefined) {
        return { text: `No note ${n}.` }
      }
      const filled = await $.prompt.fill({ text: note.text, mode: 'insert' })

      return { text: filled.isFilled ? `Pasted note ${n}.` : `Could not paste note ${n}.` }
    }
    const opened = await openFocused($)

    return { text: opened.isPlaced ? 'Notes pane opened.' : `Notes pane is waiting to be shown: ${opened.reason}` }
  })

  on('command.run', { command: 'note' }, async ($, e) => {
    if (e.args.trim() === '') {
      return { text: await grabSelection($) }
    }
    await jot($, e.args)

    return { text: 'Note saved.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (text !== '' && !text.startsWith('/')) {
      await update($, lastPrompt, () => text)
    }

    return next(e)
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // Arrows and Tab walk every drawn button; keep the person's ring on the
    // field and the notes, so ↓ past the last note stays there instead of
    // wandering into the key rows (each of which has a hotkey anyway).
    if (e.origin.kind === 'person' && e.element !== undefined && !isRestingKey(e.element) && reachable.includes(e.element)) {
      const landing = steer(await read($, ringOn), e.element)
      if (landing !== null) {
        // The engine keeps a person's move where the keys sent it, whatever a
        // hook rewrites, so refuse this one and make the move ourselves once
        // this event has settled. Our own move skips this hook: record it here.
        await update($, ringOn, () => landing)
        const id = idOfRowKey(landing)
        if (id !== null) {
          await update($, focusedId, () => id)
        }
        $.clock.after(0, () => void focusKey($, landing))
      }

      return { deny: 'the ring stays on the notes' }
    }
    const element = e.element ?? null
    await update($, ringOn, () => element)
    const id = idOfRowKey(element)
    if (id !== null) {
      await update($, focusedId, () => id)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, notes)
    const editId = await read($, editingId)
    const model: PaneModel = {
      list,
      focused: await read($, focusedId),
      editing: list.find(note => note.id === editId),
      gen: await read($, draftGen),
      listGen: await read($, listGen),
      ring: await read($, ringOn),
      cols: e.props.bodyColumns,
      bodyRows: e.props.scroll.bodyRows,
      isFocused: e.props.isFocused,
      showKeys: await read($, showKeys),
      now: await $.clock.now(),
      surface: e.surface,
    }
    const kit = $.ui.resolve(e)
    lastModel = model

    return drawPane(kit, model, {
      press: key => {
        void (async () => {
          // A key pressed from the key list does its job and closes the list.
          if (key !== 'keys') await update($, showKeys, () => false)
          const note = await target($)
          await apply($, await runAction($, key, { note, list: await read($, notes), surface: e.surface }))
        })()
      },
      submit: value => {
        void submitDraft($, value).then(outcome => apply($, outcome))
      },
      paste: note => {
        void paste($, note.text, 'insert').then(outcome => apply($, outcome))
      },
      order: (keys, start) => {
        reachable = keys
        const scrolled = windowStart !== null && start !== windowStart
        windowStart = start
        const selected = keys.find(key => idOfRowKey(key) === model.focused)
        if (scrolled && e.props.isFocused && selected !== undefined && model.ring?.startsWith('note-')) {
          $.clock.after(0, () => {
            void (async () => {
              await update($, ringOn, () => selected)
              await focusKey($, selected)
            })()
          })
        }
      },
    })
  })
}
