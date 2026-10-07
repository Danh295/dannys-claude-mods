import type { Elements, RenderChildren, RenderSurface } from 'claude-code'

import type { Note } from '../types'
import { KEYS, labelOf } from './keys'
import type { ActionKey, KeySpec } from './keys'
import { ageLabel, labelFor, layoutRows, previewText, rowKey } from './notes'

type TerminalKit = Elements['terminal']

export type Kit = Pick<TerminalKit, 'Box' | 'Text' | 'Button' | 'Markdown'> & { Input?: TerminalKit['Input'] }

export type PaneModel = {
  list: Note[]
  focused: string | null
  editing: Note | undefined
  gen: number
  listGen: number
  ring: string | null
  cols: number
  bodyRows: number
  isFocused: boolean
  showKeys: boolean
  now: number
  surface: RenderSurface
}

export type PaneHandlers = {
  press: (key: ActionKey) => void
  submit: (value: string) => void
  paste: (note: Note) => void
  /** The keys the ring can reach in drawing order, and the list window's first row, reported on every draw. */
  order: (keys: string[], start: number) => void
}

/** Rows the focused note's Markdown may take below its row. */
const PREVIEW_ROWS = 4
/** The gutter left of every row: the selection bar and a space. */
const GUTTER = 2
// Below this many body rows the key rows shrink to one, q, k and u first, and
// k shows every key; from it, every key has its button on screen.
const SHORT_PANE = 10

/** Cells kept free at a key row's end: the engine's drawing of a row runs a little wider than its labels. */
const KEY_ROW_SLACK = 4

/** Cells a plain hotkey Button takes: `e: edit`. */
function keyWidth(spec: KeySpec, note: Note | undefined): number {
  return spec.hotkey.length + 2 + labelOf(spec, note).length
}

function rule(Text: Kit['Text'], label: string, cols: number, key: string) {
  const head = label === '' ? '' : `── ${label} `

  return (
    <Text key={key} dimColor wrap="truncate">
      {head + '─'.repeat(Math.max(0, cols - head.length))}
    </Text>
  )
}

export function drawPane(kit: Kit, model: PaneModel, on: PaneHandlers) {
  const { Box, Text, Button, Markdown, Input } = kit
  const { list, focused, editing, gen, ring, cols, isFocused } = model
  // With no notes the ring starts on the draft field, so treat that as typing too.
  const isTyping = ring === null ? list.length === 0 : ring.startsWith('draft-')
  const armed = isFocused && !isTyping && model.surface !== 'mobile'
  const hot = (key: string) => (armed ? key : undefined)
  const focusedNote = list.find(note => note.id === focused) ?? list[0]

  // The engine's ring keeps a place in the drawing, not a key, so everything it
  // can reach sits where a change of selection or focus never moves it: the
  // field, then the notes, then the key rows. Nothing focusable above the notes.
  const reachable: string[] = []
  const button = (spec: KeySpec) => (
    <Button
      key={spec.key}
      label={labelOf(spec, focusedNote)}
      plain
      dimColor
      hotkey={hot(spec.hotkey)}
      onPress={() => on.press(spec.key)}
    />
  )

  // Where the keys are, said first: the one thing v0.1 never showed.
  const status = isFocused ? (
    <Box key="status" flexDirection="row" justifyContent="space-between">
      <Text>
        <Text color="claude">●</Text> keys here
      </Text>
      <Text dimColor wrap="truncate">↑↓ move  ⏎ paste</Text>
    </Box>
  ) : (
    <Text key="status" dimColor wrap="truncate">
      ○ ctrl+x tab or /notes to use
    </Text>
  )

  // Mobile draws no Input: its pane lists and pastes, and /note adds.
  const draft =
    Input === undefined || !hasDraft(model) ? null : (
      <Input
        key={`draft-${gen}`}
        placeholder={editing ? 'Edit the note (empty cancels)' : 'New note… Enter saves'}
        value={editing?.text ?? ''}
        submitLabel={editing ? 'update' : 'save'}
        autoFocus={list.length === 0 ? true : undefined}
        onSubmit={(value: string) => on.submit(value)}
      />
    )
  if (draft !== null) reachable.push(`draft-${gen}`)

  const { keyRows, room } = frame(model)
  const keyRowsDrawn = keyRows.map((row, i) => (
    <Box key={`keys-${i}`} flexDirection="row" gap={2}>
      {row.map(button)}
    </Box>
  ))
  const keyRowKeys = keyRows.flat().map(spec => spec.key)

  if (model.showKeys || list.length === 0) {
    on.order([...reachable, ...keyRowKeys], 0)
    const lines = [
      ['↑ ↓', 'Move between notes'],
      ['Enter', 'Paste the note at the cursor'],
      ['1–9', 'Paste note 1 to 9'],
      ...KEYS.map(spec => [spec.hotkey, spec.help]),
    ]

    return (
      <Box flexDirection="column">
        {status}
        {draft}
        {list.length === 0 && !model.showKeys ? (
          <Text dimColor wrap="wrap">
            No notes yet. Type one above and press Enter, or run /note &lt;text&gt;.
          </Text>
        ) : (
          lines.slice(0, Math.max(0, room - 1)).map(([key, help]) => (
            <Text key={`help-${key}`} wrap="truncate">
              <Text color="claude">{(key ?? '').padEnd(6)}</Text>
              {help}
            </Text>
          ))
        )}
        {keyRowsDrawn}
      </Box>
    )
  }

  const layout = layoutRows(list, focusedNote?.id ?? null, room, previewBudget(model, focusedNote?.id ?? null))
  const window = windowTag(model, layout.start)
  const rows: RenderChildren[] = []
  if (layout.above > 0) rows.push(<Text key="above" dimColor>{'  '}↑ {layout.above} more</Text>)
  for (let i = layout.start; i < layout.end; i++) {
    const note = list[i]!
    const prev = i > layout.start ? list[i - 1] : undefined
    if (layout.rules && note.isPinned && prev?.isPinned !== true) rows.push(rule(Text, 'pinned', cols, 'rule-pinned'))
    if (layout.rules && !note.isPinned && prev?.isPinned === true) rows.push(rule(Text, '', cols, 'rule-rest'))

    const isSelected = note.id === focusedNote?.id
    const age = ageLabel(model.now, note.createdAt)
    const digit = i < 9 ? 3 : 0
    const key = rowKey(note.id, window)
    reachable.push(key)
    rows.push(
      <Box key={`row-${note.id}`} flexDirection="row">
        <Box width={GUTTER} flexShrink={0}>
          {isSelected ? <Text color={isFocused ? 'claude' : 'inactive'}>{isFocused ? '▌' : '▏'}</Text> : <Text> </Text>}
        </Box>
        <Box flexGrow={1}>
          <Button
            key={key}
            label={labelFor(note, cols - GUTTER - digit - age.length - 2)}
            plain
            hotkey={i < 9 ? hot(String(i + 1)) : undefined}
            autoFocus={isSelected ? true : undefined}
            onPress={() => on.paste(note)}
          />
        </Box>
        <Text color="subtle"> {age}</Text>
      </Box>,
    )

    // The lifted card: the rest of the note, clipped to its budget. Not
    // focusable, so it moves nothing the ring keeps a place on.
    const body = isSelected && isFocused ? previewText(note.text) : ''
    if (body !== '' && layout.preview > 0) {
      rows.push(
        <Box
          key="preview"
          height={layout.preview}
          overflow="hidden"
          marginLeft={GUTTER}
          borderStyle="quote"
          borderColor="claude"
          paddingLeft={1}
        >
          <Markdown text={body} />
        </Box>,
      )
    }
  }
  if (layout.below > 0) rows.push(<Text key="below" dimColor>{'  '}↓ {layout.below} more</Text>)
  on.order([...reachable, ...keyRowKeys], layout.start)

  return (
    <Box flexDirection="column">
      {status}
      {draft}
      {rows}
      {keyRowsDrawn}
    </Box>
  )
}

/** Whether the draft field is drawn: everywhere but mobile. */
function hasDraft(model: PaneModel): boolean {
  return model.surface !== 'mobile'
}

/** Packs `specs`, in order, into as few rows of `columns` as they need. */
function packKeys(specs: KeySpec[], note: Note | undefined, columns: number): KeySpec[][] {
  const rows: KeySpec[][] = []
  let used = 0
  for (const spec of specs) {
    const width = keyWidth(spec, note)
    const row = rows[rows.length - 1]
    if (row !== undefined && used + 2 + width <= columns) {
      row.push(spec)
      used += 2 + width
    } else {
      rows.push([spec])
      used = width
    }
  }

  return rows
}

/** The pane keys with q and k, the way out and the key list, first. */
function paneKeysFirst(): KeySpec[] {
  const pane = KEYS.filter(spec => spec.scope === 'pane')
  const lead = pane.filter(spec => spec.key === 'prompt' || spec.key === 'keys' || spec.key === 'undo')

  return [...lead, ...pane.filter(spec => !lead.includes(spec))]
}

/**
 * The pane's fixed parts: its key rows (last in the drawing, every key on one
 * of them; in a short pane one row of q, k and u, the rest a k away) and the
 * rows left for the list.
 */
function frame(model: PaneModel): { keyRows: KeySpec[][]; room: number } {
  const { list } = model
  const focusedNote = list.find(note => note.id === model.focused) ?? list[0]
  const width = model.cols - KEY_ROW_SLACK
  const noteKeys = list.length === 0 ? [] : KEYS.filter(spec => spec.scope === 'note')
  const paneKeys = paneKeysFirst()
  const keyRows: KeySpec[][] = !model.isFocused
    ? []
    : model.showKeys || model.bodyRows >= SHORT_PANE
      ? [...packKeys(noteKeys, focusedNote, width), ...packKeys(paneKeys, focusedNote, width)]
      : [fitList([...paneKeys.slice(0, 3), ...noteKeys, ...paneKeys.slice(3)], focusedNote, width)]
  // layoutRows counts one key row itself; the rest are fixed.
  const fixedRows = 1 + (hasDraft(model) ? 1 : 0) + Math.max(0, keyRows.length - 1)

  return { keyRows, room: Math.max(1, model.bodyRows - fixedRows) }
}

/**
 * The list's generation and window in every row key: a re-sort or a scroll
 * redraws every row under a new key, so the ring (which the engine keeps by
 * place, not key) is re-seated by key, and a focus call waits for the drawing.
 */
function windowTag(model: PaneModel, start: number): string {
  return `${model.listGen}.${start}`
}

/** Preview rows to budget for the selected note: none when it has nothing below its first line. */
function previewBudget(model: PaneModel, id: string | null): number {
  const note = model.list.find(one => one.id === id)

  return model.isFocused && note !== undefined && previewText(note.text) !== '' ? PREVIEW_ROWS : 0
}

/** The key note `id`'s row will have when `model` is drawn with it selected. */
export function selectedRowKey(model: PaneModel, id: string): string {
  const layout = layoutRows(model.list, id, frame({ ...model, focused: id }).room, previewBudget(model, id))

  return rowKey(id, windowTag(model, layout.start))
}

/** The specs, in order, that fit one row of `columns`. */
function fitList(specs: KeySpec[], note: Note | undefined, columns: number): KeySpec[] {
  const out: KeySpec[] = []
  let used = 0
  for (const spec of specs) {
    const width = keyWidth(spec, note) + (out.length > 0 ? 2 : 0)
    if (used + width > columns) break
    out.push(spec)
    used += width
  }

  return out
}
