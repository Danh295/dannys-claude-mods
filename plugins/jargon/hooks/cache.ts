import type { JargonGlossary } from '../types'

export const CACHE_VERSION = 1

/**
 * What `~/.claude/jargon/cache.json` holds: every definition Haiku wrote, the
 * slugs the person looked up, and how many times Haiku was asked.
 */
export type CacheFile = {
  version: typeof CACHE_VERSION
  glossary: JargonGlossary
  lookedUp: string[]
  asked: number
}

export function emptyCache(): CacheFile {
  return { version: CACHE_VERSION, glossary: {}, lookedUp: [], asked: 0 }
}

/**
 * Reads the file's text, keeping every well-formed entry; null when the text
 * is no JSON object at all (a write cut short), so the caller can keep it.
 * Fields older versions wrote (`seen`, `skipped`) are dropped.
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
  const lookedUp = Array.isArray(o.lookedUp)
    ? o.lookedUp.filter((s): s is string => typeof s === 'string')
    : []
  const asked = typeof o.asked === 'number' && Number.isFinite(o.asked) ? o.asked : 0

  return { version: CACHE_VERSION, glossary, lookedUp, asked }
}
