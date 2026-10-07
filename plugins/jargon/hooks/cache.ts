import type { JargonGlossary } from '../types'

export const CACHE_VERSION = 1
export const MAX_SEEN = 50000

/**
 * What `~/.claude/jargon/cache.json` holds: every definition Haiku wrote,
 * every word it has already read, and how many replies it was spared.
 */
export type CacheFile = {
  version: typeof CACHE_VERSION
  glossary: JargonGlossary
  seen: string[]
  asked: number
  skipped: number
}

export function emptyCache(): CacheFile {
  return { version: CACHE_VERSION, glossary: {}, seen: [], asked: 0, skipped: 0 }
}

/**
 * Reads the file's text, keeping every well-formed entry; null when the text
 * is no JSON object at all (a write cut short), so the caller can keep it.
 */
export function parseCache(raw: string): CacheFile | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null

  const o = data as Record<string, unknown>
  const glossary: JargonGlossary = {}
  if (typeof o.glossary === 'object' && o.glossary !== null) {
    for (const [slug, v] of Object.entries(o.glossary as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue
      const e = v as Record<string, unknown>
      if (typeof e.term !== 'string' || typeof e.definition !== 'string') continue
      glossary[slug] = {
        term: e.term,
        kind: typeof e.kind === 'string' ? e.kind : '',
        definition: e.definition,
      }
    }
  }
  const seen = Array.isArray(o.seen) ? o.seen.filter((w): w is string => typeof w === 'string') : []
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

  return {
    version: CACHE_VERSION,
    glossary,
    seen: seen.slice(-MAX_SEEN),
    asked: count(o.asked),
    skipped: count(o.skipped),
  }
}

/** The reply's words Haiku has never read: none means the call is skipped. */
export function novelWords(words: readonly string[], seen: ReadonlySet<string>): string[] {
  return words.filter(w => !seen.has(w))
}
