import type { JargonGlossary } from '../types'
import { BUNDLED } from './bundled'
import { emptyCache } from './cache'
import type { CacheFile } from './cache'

// What the glossary may hold, and how it merges. Plain values in and out:
// register.tsx does the reading and writing.

export const MAX_GLOSSARY = 500
export const MAX_REPLIES = 60

export function keepLast<T>(record: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= max) return record

  return Object.fromEntries(keys.slice(-max).map(k => [k, record[k] as T]))
}

/** The glossary without built-in terms: those ship with the mod and are never saved. */
export function withoutBundled(glossary: JargonGlossary): JargonGlossary {
  return Object.fromEntries(Object.entries(glossary).filter(([s]) => !(s in BUNDLED)))
}

/** The lookups that still name a term: a Haiku definition the cap dropped takes its lookup with it. */
export function liveLookups(slugs: Iterable<string>, glossary: JargonGlossary): string[] {
  return [...new Set(slugs)].filter(s => s in glossary || s in BUNDLED)
}

/**
 * The file to write: what is on disk now (another session may have saved
 * since this one read it) with this session's definitions, lookups and calls
 * added. This session's entry wins on the same slug.
 */
export function merge(
  disk: CacheFile | null,
  mine: { glossary: JargonGlossary; lookedUp: readonly string[]; asked: number },
): CacheFile {
  const base = disk ?? emptyCache()
  const glossary = keepLast(withoutBundled({ ...base.glossary, ...mine.glossary }), MAX_GLOSSARY)

  return {
    ...emptyCache(),
    glossary,
    lookedUp: liveLookups([...base.lookedUp, ...mine.lookedUp], glossary),
    asked: base.asked + mine.asked,
  }
}
