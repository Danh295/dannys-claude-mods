import type { Note } from '../types'

export type ActionKey =
  | 'edit'
  | 'pin'
  | 'delete'
  | 'copy'
  | 'replace'
  | 'undo'
  | 'add'
  | 'grab'
  | 'last'
  | 'prompt'
  | 'keys'

/** `note` keys act on the highlighted note; `pane` keys work from anywhere in the pane. */
export type KeyScope = 'note' | 'pane'

export type KeySpec = {
  key: ActionKey
  hotkey: string
  label: string | ((note: Note) => string)
  scope: KeyScope
  /** What the key list says it does. */
  help: string
}

export const KEYS: readonly KeySpec[] = [
  { key: 'edit', hotkey: 'e', label: 'edit', scope: 'note', help: 'Edit the note' },
  { key: 'pin', hotkey: 'p', label: note => (note.isPinned ? 'unpin' : 'pin'), scope: 'note', help: 'Pin it to the top, or unpin it' },
  { key: 'delete', hotkey: 'd', label: 'delete', scope: 'note', help: 'Delete it (u undoes)' },
  { key: 'copy', hotkey: 'c', label: 'copy', scope: 'note', help: 'Copy it to the clipboard' },
  { key: 'replace', hotkey: 'r', label: 'replace', scope: 'note', help: 'Replace the whole prompt with it' },
  { key: 'prompt', hotkey: 'q', label: 'prompt', scope: 'pane', help: 'Back to the prompt' },
  { key: 'keys', hotkey: 'k', label: 'keys', scope: 'pane', help: 'Show or hide this list' },
  { key: 'undo', hotkey: 'u', label: 'undo', scope: 'pane', help: 'Bring back the last deleted note' },
  { key: 'add', hotkey: 'a', label: 'new', scope: 'pane', help: 'Write a new note' },
  { key: 'grab', hotkey: 'g', label: 'grab', scope: 'pane', help: 'Save the mouse selection as a note' },
  { key: 'last', hotkey: 'l', label: 'last', scope: 'pane', help: 'Save your last prompt as a note' },
]

export function labelOf(spec: KeySpec, note: Note | undefined): string {
  return typeof spec.label === 'string' ? spec.label : note === undefined ? spec.key : spec.label(note)
}
