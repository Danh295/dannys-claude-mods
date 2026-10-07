export type Note = { id: string; text: string; isPinned: boolean; createdAt: number }

declare module 'claude-code' {
  interface PluginState {
    jot: {
      notes: Note[]
      focusedId: string | null
      editingId: string | null
      lastPrompt: string | null
      draftGen: number
      ringOn: string | null
      /** Bumped on every write to the list, so row keys change and a focus call waits for the new drawing. */
      listGen: number
      lastDeleted: Note | null
      showKeys: boolean
    }
  }
}
