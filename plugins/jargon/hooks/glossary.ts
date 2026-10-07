import type { JargonGlossary, JargonNotes } from '../types'
import { MAX_SEEN, emptyCache } from './cache'
import type { CacheFile } from './cache'
import { isJargonCandidate, replyKey } from './text'
import type { Extracted } from './text'

// What the glossary may hold, and how it merges. Plain values in and out:
// register.tsx does the reading and writing.

export const MAX_GLOSSARY = 500
export const MAX_REPLIES = 60

/** Calls and skips counted by this session since its last save. */
export type Counts = { asked: number; skipped: number }

function keepLast<T>(record: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= max) return record

  return Object.fromEntries(keys.slice(-max).map(k => [k, record[k] as T]))
}

/** The glossary without entries that can't be jargon (saved before the filter existed). */
export function keepJargon(known: JargonGlossary): { glossary: JargonGlossary; dropped: number } {
  const glossary = Object.fromEntries(
    Object.entries(known).filter(([, t]) => isJargonCandidate(t.term)),
  )

  return { glossary, dropped: Object.keys(known).length - Object.keys(glossary).length }
}

/**
 * One answer from Haiku added: its terms that can be jargon go last in the
 * glossary (newest kept under the cap), and their notes go under `text`.
 */
export function admit(
  glossary: JargonGlossary,
  notes: JargonNotes,
  found: readonly Extracted[],
  text: string,
): { glossary: JargonGlossary; notes: JargonNotes } {
  const kept = found.filter(f => isJargonCandidate(f.term))
  if (kept.length === 0) return { glossary, notes }

  const nextGlossary = { ...glossary }
  const own: Record<string, string> = {}
  for (const f of kept) {
    delete nextGlossary[f.slug]
    nextGlossary[f.slug] = { term: f.term, kind: f.kind, definition: f.definition }
    own[f.slug] = f.context
  }
  const key = replyKey(text)
  const nextNotes = { ...notes }
  delete nextNotes[key]
  nextNotes[key] = own

  return {
    glossary: keepLast(nextGlossary, MAX_GLOSSARY),
    notes: keepLast(nextNotes, MAX_REPLIES),
  }
}

/**
 * The file to write: what is on disk now (another session may have saved
 * since this one read it) with this session's terms, words and counts added.
 * This session's entry wins on the same slug; only jargon is kept.
 */
export function merge(
  disk: CacheFile | null,
  mine: { glossary: JargonGlossary; seen: Iterable<string>; counts: Counts },
): CacheFile {
  const base = disk ?? emptyCache()
  const both = keepJargon({ ...base.glossary, ...mine.glossary }).glossary

  return {
    ...emptyCache(),
    glossary: keepLast(both, MAX_GLOSSARY),
    seen: [...new Set([...base.seen, ...mine.seen])].slice(-MAX_SEEN),
    asked: base.asked + mine.counts.asked,
    skipped: base.skipped + mine.counts.skipped,
  }
}
