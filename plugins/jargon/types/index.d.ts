export type JargonEntry = {
  term: string
  kind: string
  definition: string
}

/** Slug to entry, oldest first. */
export type JargonGlossary = Record<string, JargonEntry>

/** Hash of a reply's text to its terms' notes, slug to note. */
export type JargonNotes = Record<string, Record<string, string>>

export type JargonPin = { slug: string; hash: string }

/** How much the reader already knows: decides which bundled terms highlight. */
export type JargonLevel = 'beginner' | 'intermediate' | 'advanced'

declare module 'claude-code' {
  interface PluginState {
    jargon: {
      glossary: JargonGlossary
      notes: JargonNotes
      pinned: JargonPin | null
      isOn: boolean
      level: JargonLevel
      /** Slugs the person asked about with `/jargon <term>`: shown at every level, ranked first. */
      lookedUp: string[]
    }
  }
}
