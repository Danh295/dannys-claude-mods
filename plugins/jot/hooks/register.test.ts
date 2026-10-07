import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Note } from '../types'
import { KEYS } from './keys'
import { newNote } from './notes'

// The test runtime has timers; the mod's typings (no DOM, no Node) do not declare them.
declare const setTimeout: (fn: () => void, ms: number) => unknown

const SURFACES = ['terminal', 'desktop'] as const

const PANE_PROPS = {
  title: 'Notes',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

type Fill = { text: string; mode: string }

type Placed = { isPlaced: true } | { isPlaced: false; reason: string }

function world(on: On, open: (count: number) => Placed = () => ({ isPlaced: true })) {
  const fills: Fill[] = []
  const toasts: string[] = []
  const store: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store[key] = JSON.parse(JSON.stringify(value))
    return { value: undefined } as never
  })
  mock.clock(on, { now: 1_000 })
  on('prompt.fill', ($, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })
  const focuses: string[] = []
  on('ui.focus', ($, e) => {
    const f = e as { element?: string; key?: string }
    focuses.push(f.element ?? f.key ?? '')
    return {}
  })
  let opens = 0
  on('ui.open', () => ({ value: open(++opens) }) as never)
  const closes: unknown[] = []
  on('ui.close', ($, e) => {
    closes.push(e)
    return { value: undefined } as never
  })
  on('command.register', ($, e) => ({ value: { command: (e as { name: string }).name } }) as never)

  const kept = () => ((store.notes ?? []) as Note[]).map(n => n.text)

  return { fills, toasts, store, kept, closes, focuses, opens: () => opens }
}

async function mount($: Engine, surface: (typeof SURFACES)[number], props: Partial<typeof PANE_PROPS> | Record<string, unknown> = {}) {
  return $.ui.mount({ plugin: 'jot', surface, component: 'Pane', requestId: 'jot', props: { ...PANE_PROPS, ...props } as typeof PANE_PROPS })
}

/** The ring moving onto a note, as the engine raises it for the person's arrow key. */
function ringTo($: Engine, element: string) {
  return $.ui.focus({ component: 'Pane', requestId: 'jot', plugin: 'jot', element, origin: { kind: 'person' } } as never)
}

async function noteKeys(ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]> }) {
  return (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('note-'))
}

test('/note saves a note to the persistent store', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'note', args: 'hello world' } as never)
  expect(w.kept()).toEqual(['hello world'])
})

for (const surface of SURFACES) {
  test(`${surface}: Enter on a note pastes it at the cursor`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'note', args: 'paste me' } as never)
    const ui = await mount($, surface)
    const [key] = await noteKeys(ui)
    expect(key).toBeDefined()
    await ui.press({ key: key! })
    expect(w.fills).toEqual([{ text: 'paste me', mode: 'insert' }])
    await ui.unmount()
  })

  test(`${surface}: delete removes the focused note from state and store`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'note', args: 'keep' } as never)
    await $.command.run({ command: 'note', args: 'drop' } as never)
    const ui = await mount($, surface)
    const dropKey = (await noteKeys(ui))[0]!
    await ringTo($, dropKey)
    await ui.press({ key: 'delete' })
    expect(w.kept()).toEqual(['keep'])
    expect(await noteKeys(ui)).toHaveLength(1)
    await ui.unmount()
  })

  test(`${surface}: pin moves a note to the top`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'note', args: 'older' } as never)
    await $.command.run({ command: 'note', args: 'newer' } as never)
    const ui = await mount($, surface)
    const keys = await noteKeys(ui)
    await ringTo($, keys[1]!)
    await ui.press({ key: 'pin' })
    expect(w.kept()).toEqual(['older', 'newer'])
    expect((w.store.notes as Note[])[0]!.isPinned).toBe(true)
    await ui.unmount()
  })

  test(`${surface}: the draft field adds a note and remounts empty`, async ($, on) => {
    const w = world(on)
    const ui = await mount($, surface)
    await ui.input({ key: 'draft-0', text: 'typed note' })
    expect(await ui.find({ key: 'draft-1' })).toBeDefined()
    expect(await ui.find({ key: 'draft-0' })).toBeUndefined()
    expect(w.kept()).toEqual(['typed note'])
    await ui.unmount()
  })

  test(`${surface}: edit replaces a note's text`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'note', args: 'typo' } as never)
    const ui = await mount($, surface)
    await ringTo($, (await noteKeys(ui))[0]!)
    await ui.press({ key: 'edit' })
    await ui.input({ key: 'draft-1', text: 'fixed' })
    expect(w.kept()).toEqual(['fixed'])
    expect(await ui.find({ key: 'draft-2' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: last prompt is saved as a note`, async ($, on) => {
    const w = world(on)
    on('prompt.submit', ($, e) => ({ text: e.text }) as never)
    await $.prompt.submit({ text: 'refactor the parser' } as never)
    const ui = await mount($, surface)
    await ui.press({ key: 'last' })
    expect(w.kept()).toEqual(['refactor the parser'])
    await ui.unmount()
  })
}

test('a save keeps notes another session stored meanwhile', async ($, on) => {
  const w = world(on)
  w.store.notes = [newNote('from the other session', 500)]
  await $.command.run({ command: 'note', args: 'from this one' } as never)
  expect(w.kept()).toEqual(['from this one', 'from the other session'])
})

for (const surface of SURFACES) {
  test(`${surface}: deleting the note being edited turns the draft back into an add`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'note', args: 'doomed' } as never)
    const ui = await mount($, surface)
    await ringTo($, (await noteKeys(ui))[0]!)
    await ui.press({ key: 'edit' })
    await ui.press({ key: 'delete' })
    await ui.input({ key: 'draft-1', text: 'not lost' })
    expect(w.kept()).toEqual(['not lost'])
    await ui.unmount()
  })
}

test('/notes reseats a pane left waiting by the unasked open at start', async ($, on) => {
  const w = world(on, n => (n === 1 ? { isPlaced: false, reason: 'narrow' } : { isPlaced: true }))
  const result = await $.command.run({ command: 'notes', args: '' } as never)
  expect(w.closes).toHaveLength(1)
  expect(w.opens()).toBe(2)
  expect((result as { text: string }).text).toBe('Notes pane opened.')
})

test('/notes says why when the pane still cannot be shown', async ($, on) => {
  world(on, () => ({ isPlaced: false, reason: 'terminal is 90 columns' }))
  const result = await $.command.run({ command: 'notes', args: '' } as never)
  expect((result as { text: string }).text).toBe('Notes pane is waiting to be shown: terminal is 90 columns')
})

/**
 * The row the drawing marks `autoFocus`: the note the plugin moved the ring to.
 * The test engine implements no `$.ui.focus` for a plugin, so the drawing is
 * what a test can see; the live ring is checked with expect (plan Task 6).
 */
async function ring(ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string; props: Record<string, unknown> }[]> }): Promise<string> {
  return (await ui.findAll({ type: 'Button' })).find(b => b.props.autoFocus === true)?.key ?? ''
}

/**
 * Waits until the drawing selects note `id`: a real arrow key only ever moves
 * from the drawing on screen, so a test's next ring move waits for it too.
 */
async function selects(ui: Parameters<typeof ring>[0], id: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    if (idOf(await ring(ui)) === id) break
    await new Promise<void>(r => setTimeout(r, 2))
  }
  return idOf(await ring(ui))
}

/** The id inside a row key `note-<id>-<gen>`. */
function idOf(key: string): string {
  return key.slice('note-'.length, key.lastIndexOf('-'))
}

async function buttons(ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string; props: Record<string, unknown> }[]> }) {
  return ui.findAll({ type: 'Button' })
}

for (const surface of SURFACES) {
  test(`${surface}: pin keeps the selection on the pinned note`, async ($, on) => {
    const w = world(on)
    for (const t of ['bottom', 'middle', 'top']) await $.command.run({ command: 'note', args: t } as never)
    const ui = await mount($, surface)
    const keys = await noteKeys(ui)
    const bottom = keys[2]!
    await ringTo($, bottom)
    await ui.press({ key: 'pin' })
    expect((w.store.notes as Note[])[0]!.text).toBe('bottom')
    const last = await ring(ui)
    expect(last.startsWith('note-')).toBe(true)
    expect(idOf(last)).toBe(idOf(bottom))
    // The key is new, so the focus call waits for the re-sorted drawing.
    expect(last).not.toBe(bottom)
    expect((await noteKeys(ui))[0]).toBe(last)
    await ui.unmount()
  })

  test(`${surface}: a paste never tells the person to press Esc`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'note', args: 'paste me' } as never)
    const ui = await mount($, surface)
    const opens = w.opens()
    await ui.press({ key: (await noteKeys(ui))[0]! })
    expect(w.fills).toEqual([{ text: 'paste me', mode: 'insert' }])
    expect(w.toasts.join(' ')).not.toContain('Esc')
    expect(w.toasts.join(' ')).toContain('ctrl+x tab')
    expect(w.closes).toHaveLength(0)
    expect(w.opens()).toBe(opens)
    await ui.unmount()
  })

  test(`${surface}: digits paste the note in that place`, async ($, on) => {
    const w = world(on)
    for (const t of ['third', 'second', 'first']) await $.command.run({ command: 'note', args: t } as never)
    const ui = await mount($, surface)
    const two = (await buttons(ui)).find(b => b.props.hotkey === '2')
    expect(two).toBeDefined()
    await ui.press({ key: two!.key! })
    expect(w.fills).toEqual([{ text: 'second', mode: 'insert' }])
    expect((await buttons(ui)).some(b => b.props.hotkey === '4')).toBe(false)
    await ui.unmount()
  })

  test(`${surface}: u undoes a delete, even after another note was added`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'note', args: 'keep' } as never)
    await $.command.run({ command: 'note', args: 'oops' } as never)
    const ui = await mount($, surface)
    const oops = (await noteKeys(ui))[0]!
    await ringTo($, oops)
    await ui.press({ key: 'delete' })
    expect(w.kept()).toEqual(['keep'])
    expect(w.toasts[w.toasts.length - 1]).toBe('Deleted. u undoes it.')
    await $.command.run({ command: 'note', args: 'later' } as never)
    await ui.press({ key: 'undo' })
    // The test clock stands still, so all three share a timestamp: check membership, not order.
    expect([...w.kept()].sort()).toEqual(['keep', 'later', 'oops'])
    expect(idOf(await ring(ui))).toBe(idOf(oops))
    await ui.press({ key: 'undo' })
    expect(w.toasts[w.toasts.length - 1]).toBe('Nothing to undo.')
    expect(w.kept()).toHaveLength(3)
    await ui.unmount()
  })

  test(`${surface}: q hands the keys back to the prompt and keeps the pane`, async ($, on) => {
    const w = world(on)
    const ui = await mount($, surface)
    const opens = w.opens()
    await ui.press({ key: 'prompt' })
    expect(w.closes).toHaveLength(1)
    expect(w.opens()).toBe(opens + 1)
    await ui.unmount()
  })

  test(`${surface}: a moves the ring to the new-note field`, async ($, on) => {
    world(on)
    await $.command.run({ command: 'note', args: 'x' } as never)
    const ui = await mount($, surface)
    expect((await buttons(ui)).some(b => b.props.hotkey !== undefined)).toBe(true)
    await ui.press({ key: 'add' })
    // The ring is in the field now, so letters type there: no hotkeys drawn.
    expect((await buttons(ui)).some(b => b.props.hotkey !== undefined)).toBe(false)
    await ui.unmount()
  })

  test(`${surface}: no hotkeys while the ring is in the new-note field`, async ($, on) => {
    world(on)
    await $.command.run({ command: 'note', args: 'x' } as never)
    const ui = await mount($, surface)
    expect((await buttons(ui)).some(b => b.props.hotkey !== undefined)).toBe(true)
    await ringTo($, 'draft-0')
    expect((await buttons(ui)).some(b => b.props.hotkey !== undefined)).toBe(false)
    await ui.unmount()
  })
}

test('/notes <n> pastes note n from the prompt', async ($, on) => {
  const w = world(on)
  for (const t of ['second', 'first']) await $.command.run({ command: 'note', args: t } as never)
  const two = await $.command.run({ command: 'notes', args: '2' } as never)
  expect(w.fills).toEqual([{ text: 'second', mode: 'insert' }])
  expect((two as { text: string }).text).toBe('Pasted note 2.')
  const nine = await $.command.run({ command: 'notes', args: '9' } as never)
  expect((nine as { text: string }).text).toBe('No note 9.')
  expect(w.fills).toHaveLength(1)
})

type Drawn = { type: string; props: Record<string, unknown>; children?: unknown[] }

/** Rows the pane's top-level children take: one each, a fixed-height box its height. */
function rowsOf(root: Drawn): number {
  const kids = (root.children ?? []) as Drawn[]
  return kids.reduce((n, kid) => n + (typeof kid.props?.height === 'number' ? (kid.props.height as number) : 1), 0)
}

function findDeep(node: unknown, test: (n: Drawn) => boolean): Drawn | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const n = node as Drawn
  if (test(n)) return n
  for (const kid of n.children ?? []) {
    const hit = findDeep(kid, test)
    if (hit) return hit
  }
  return undefined
}

for (const surface of SURFACES) {
  test(`${surface}: a focused pane says so and lifts the selected note`, async ($, on) => {
    world(on)
    await $.command.run({ command: 'note', args: 'older' } as never)
    await $.command.run({ command: 'note', args: 'Title line\n**body** with more\n- a list' } as never)
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /keys here/ })).toBeDefined()
    const md = await ui.find({ type: 'Markdown' })
    expect(md?.props.text).toBe('**body** with more\n- a list')
    const hotkeys = (await buttons(ui)).map(b => b.props.hotkey)
    expect(hotkeys).toContain('1')
    expect(hotkeys).toContain('2')
    await ui.unmount()
  })

  test(`${surface}: an unfocused pane says how to get in and arms no keys`, async ($, on) => {
    world(on)
    await $.command.run({ command: 'note', args: 'one\ntwo' } as never)
    const ui = await mount($, surface, { isFocused: false })
    expect(await ui.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeDefined()
    expect((await buttons(ui)).some(b => b.props.hotkey !== undefined)).toBe(false)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()
  })

  for (const bodyRows of [8, 20]) {
    test(`${surface}: a long note never pushes the pane past ${bodyRows} rows`, async ($, on) => {
      world(on)
      for (let i = 0; i < 29; i++) await $.command.run({ command: 'note', args: `note ${i}` } as never)
      const long = ['Long one', ...Array.from({ length: 40 }, (_, i) => `line ${i}`)].join('\n')
      await $.command.run({ command: 'note', args: long } as never)
      const ui = await mount($, surface, { scroll: { offset: 0, bodyRows } })
      const root = (await ui.drawn()) as unknown as Drawn
      const preview = findDeep(root, n => n.type === 'Box' && n.props.overflow === 'hidden')
      // A short pane gives up the preview first; a tall one shows it clipped to its budget.
      if (bodyRows >= 20) expect(preview).toBeDefined()
      if (preview) expect(preview.props.height as number).toBeGreaterThan(0)
      expect(rowsOf(root)).toBeLessThanOrEqual(bodyRows)
      // The selected note keeps a neighbour drawn below it, so ↓ moves rather than scrolls.
      expect(((await noteKeys(ui)).length)).toBeGreaterThanOrEqual(2)
      await ui.unmount()
    })
  }

  test(`${surface}: collapsed rows show plain text, pinned notes sit under a rule`, async ($, on) => {
    world(on)
    await $.command.run({ command: 'note', args: '**bold** text' } as never)
    await $.command.run({ command: 'note', args: 'newest' } as never)
    const ui = await mount($, surface)
    const labels = (await buttons(ui)).filter(b => (b.key ?? '').startsWith('note-')).map(b => b.props.label)
    expect(labels).toContain('bold text')
    expect(await ui.find({ type: 'Text', text: /pinned/ })).toBeUndefined()
    await ui.press({ key: 'pin' })
    expect(await ui.find({ type: 'Text', text: /pinned/ })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: k shows every key and what it does`, async ($, on) => {
    world(on)
    await $.command.run({ command: 'note', args: 'x' } as never)
    const ui = await mount($, surface)
    await ui.press({ key: 'keys' })
    expect(await ui.find({ type: 'Text', text: /Back to the prompt/ })).toBeDefined()
    await ui.press({ key: 'keys' })
    expect(await ui.find({ type: 'Text', text: /Back to the prompt/ })).toBeUndefined()
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  test(`${surface}: the ring's stops never move when the selection or focus changes`, async ($, on) => {
    world(on)
    for (const t of ['third', 'second', 'first']) await $.command.run({ command: 'note', args: t } as never)
    const order = async (ui: Parameters<typeof buttons>[0]) => (await buttons(ui)).map(b => b.key ?? '')
    // The engine keeps the ring's place, not its key: nothing focusable may sit
    // above or between the notes, so key buttons all come after the last note.
    const unfocused = await mount($, surface, { isFocused: false })
    const before = await order(unfocused)
    await unfocused.unmount()
    const ui = await mount($, surface)
    const keys = await order(ui)
    const lastNote = keys.map(k => k.startsWith('note-')).lastIndexOf(true)
    expect(keys.slice(0, lastNote + 1).every(k => k.startsWith('note-'))).toBe(true)
    expect(keys.slice(lastNote + 1).some(k => k.startsWith('note-'))).toBe(false)
    // Gaining focus adds key rows only after the notes.
    expect(keys.slice(0, before.length)).toEqual(before)
    // Moving the selection keeps every stop where it was.
    await ringTo($, (await noteKeys(ui))[2]!)
    expect(await selects(ui, idOf((await noteKeys(ui))[2]!))).toBe(idOf((await noteKeys(ui))[2]!))
    expect(await order(ui)).toEqual(keys)
    await ui.unmount()
  })

  test(`${surface}: past the last note the ring stays put`, async ($, on) => {
    const w = world(on)
    for (const t of ['second', 'first']) await $.command.run({ command: 'note', args: t } as never)
    const ui = await mount($, surface)
    const keys = await noteKeys(ui)
    await ringTo($, keys[1]!)
    expect(await selects(ui, idOf(keys[1]!))).toBe(idOf(keys[1]!))
    await ringTo($, 'edit')
    await ringTo($, 'undo')
    await new Promise<void>(r => setTimeout(r, 10))
    expect(idOf(await ring(ui))).toBe(idOf(keys[1]!))
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  for (const [bodyColumns, bodyRows] of [[40, 7], [48, 7], [48, 17], [60, 20]] as const) {
    test(`${surface}: every key has a button at ${bodyColumns}x${bodyRows}`, async ($, on) => {
      world(on)
      for (const t of ['one', 'two\nmore', 'three', 'four', 'five']) await $.command.run({ command: 'note', args: t } as never)
      const ui = await mount($, surface, { bodyColumns, scroll: { offset: 0, bodyRows } })
      const seen = new Set((await buttons(ui)).map(b => b.props.hotkey).filter(h => h !== undefined))
      expect(rowsOf((await ui.drawn()) as unknown as Drawn)).toBeLessThanOrEqual(bodyRows)
      if (bodyRows < 10) {
        // A short pane keeps q, k and u on screen; k shows the rest, each one key away.
        for (const h of ['q', 'k', 'u']) expect(seen.has(h)).toBe(true)
        await ui.press({ key: 'keys' })
        for (const b of await buttons(ui)) if (b.props.hotkey !== undefined) seen.add(b.props.hotkey)
        expect(rowsOf((await ui.drawn()) as unknown as Drawn)).toBeLessThanOrEqual(bodyRows)
      }
      const missing = KEYS.map(k => k.hotkey).filter(h => !seen.has(h))
      expect(missing).toEqual([])
      await ui.unmount()
    })
  }

  test(`${surface}: a key pressed from the key list closes it`, async ($, on) => {
    const w = world(on)
    await $.command.run({ command: 'note', args: 'doomed' } as never)
    const ui = await mount($, surface, { scroll: { offset: 0, bodyRows: 7 } })
    await ui.press({ key: 'keys' })
    expect(await ui.find({ type: 'Text', text: /Move between notes/ })).toBeDefined()
    await ui.press({ key: 'delete' })
    expect(w.kept()).toEqual([])
    expect(await ui.find({ type: 'Text', text: /No notes yet/ })).toBeDefined()
    await ui.unmount()
  })
}
