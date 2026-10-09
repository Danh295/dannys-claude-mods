export const LINK_ROOT = 'https://jargon.invalid/'
/** Drawn after each linked term, inside the link, so the mark presses with the word. */
export const MARK = 'ⓘ'

/** The longest term `/jargon <term>` takes, as the old extraction clipped terms. */
export const MAX_TERM_CHARS = 60
/** How much of a reply goes to Haiku as context, around the term. */
export const MAX_EXCERPT_CHARS = 1200

/** What Haiku answers for one term: the entry's text and how the reply uses it. */
export type Definition = { kind: string; definition: string; context: string }

export function slug(term: string): string {
  const s = term
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  return s || `t${hash(term)}`
}

/** FNV-1a over the trimmed text, as hex: the key a reply's notes sit under. */
export function hash(text: string): string {
  let h = 0x811c9dc5
  const t = text.trim()
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }

  return (h >>> 0).toString(16)
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when every letter is a capital and there are at least two (REST, PR,
 * CI/CD, UTF-8): such a term matches only in capitals, so "the rest of" never
 * reads as REST.
 */
export function isAcronym(term: string): boolean {
  const letters = term.replace(/[^A-Za-z]/g, '')

  return letters.length >= 2 && letters === letters.toUpperCase()
}

/** Matches the term as a whole word: in any case, or in capitals for an acronym. */
export function termPattern(term: string): RegExp {
  return new RegExp(`(?<![\\w-])${escape(term)}(?![\\w-])`, isAcronym(term) ? '' : 'i')
}

export function hasTerm(text: string, term: string): boolean {
  return term.trim() !== '' && termPattern(term).test(text)
}

/**
 * Two patterns for a whole glossary, one for acronyms (capitals only) and one
 * for the rest (any case): answers the slugs of the terms a text holds, in
 * the order they appear, a longer term winning over one inside it. Built once
 * per glossary, not per draw.
 */
export function termMatcher(
  entries: ReadonlyArray<readonly [slug: string, term: string]>,
): (text: string) => string[] {
  const anyCase = new Map<string, string>()
  const capitals = new Map<string, string>()
  for (const [s, term] of entries) {
    if (term.trim() === '') continue
    if (isAcronym(term)) capitals.set(term, s)
    else anyCase.set(term.toLowerCase(), s)
  }
  const patternOf = (spellings: Map<string, string>, flags: string) => {
    if (spellings.size === 0) return null
    const alternatives = [...spellings.keys()].sort((a, b) => b.length - a.length).map(escape)

    return new RegExp(`(?<![\\w-])(?:${alternatives.join('|')})(?![\\w-])`, flags)
  }
  const patterns = [
    { pattern: patternOf(anyCase, 'gi'), slugOf: (m: string) => anyCase.get(m.toLowerCase()) },
    { pattern: patternOf(capitals, 'g'), slugOf: (m: string) => capitals.get(m) },
  ]

  return text => {
    const hits: { at: number; end: number; slug: string }[] = []
    for (const { pattern, slugOf } of patterns) {
      if (pattern === null) continue
      for (const m of text.matchAll(pattern)) {
        const s = slugOf(m[0])
        const at = m.index ?? 0
        if (s !== undefined) hits.push({ at, end: at + m[0].length, slug: s })
      }
    }
    hits.sort((a, b) => a.at - b.at || b.end - a.end)

    const out = new Set<string>()
    let reached = 0
    for (const hit of hits) {
      if (hit.at < reached) continue
      reached = hit.end
      out.add(hit.slug)
    }

    return [...out]
  }
}

// Code (fenced, indented, inline with one or two backticks), links and bare
// URLs: never rewritten.
const PROTECTED = new RegExp(
  [
    '```[\\s\\S]*?(?:```|$)',
    '~~~[\\s\\S]*?(?:~~~|$)',
    '(?:^|\\n)(?:(?: {4}|\\t)[^\\n]*(?:\\n|$))+',
    '``[^\\n]*?``',
    '`[^`\\n]*`',
    '!?\\[[^\\]]*\\]\\([^)]*\\)',
    '<https?:[^>\\s]*>',
    'https?:\\/\\/\\S+',
  ].join('|'),
  'g',
)

type Segment = { text: string; isProse: boolean }

function segments(text: string): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const m of text.matchAll(PROTECTED)) {
    const start = m.index ?? 0
    if (start > at) out.push({ text: text.slice(at, start), isProse: true })
    out.push({ text: m[0], isProse: false })
    at = start + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), isProse: true })

  return out
}

/**
 * What the person typed after `/jargon`, as a term: wrapping quotes,
 * backticks and emphasis taken off, spaces collapsed.
 */
export function cleanTerm(raw: string): string {
  let t = raw.trim().replace(/\s+/g, ' ')
  for (;;) {
    const m = /^(["'`*_]+)(.*?)\1$/.exec(t)
    if (m === null || m[2]!.trim() === '') return t
    t = m[2]!.trim()
  }
}

/**
 * The part of a reply Haiku needs to see a term in use: the reply whole when
 * short, else MAX_EXCERPT_CHARS around the term's first mention.
 */
export function excerpt(reply: string, term: string): string {
  const text = reply.replace(/<context>[\s\S]*?<\/context>/g, '').trim()
  if (text.length <= MAX_EXCERPT_CHARS) return text
  const at = termPattern(term).exec(text)?.index ?? 0
  const start = Math.max(0, Math.min(at - MAX_EXCERPT_CHARS / 2, text.length - MAX_EXCERPT_CHARS))
  const cut = text.slice(start, start + MAX_EXCERPT_CHARS)

  return `${start > 0 ? '…' : ''}${cut}${start + MAX_EXCERPT_CHARS < text.length ? '…' : ''}`
}

/** The text with code and links taken out: what a reader reads as prose. */
export function proseOf(text: string): string {
  return segments(text)
    .filter(p => p.isProse)
    .map(p => p.text)
    .join(' ')
}

/**
 * The key a reply's notes sit under: the same for the text as stored and as
 * the terminal draws it, which leaves out `<context>` blocks.
 */
export function replyKey(text: string): string {
  return hash(text.replace(/<context>[\s\S]*?<\/context>/g, ''))
}

/**
 * Turns the first prose occurrence of each term into a markdown link to
 * `LINK_ROOT + slug`. Longer terms go first so "race condition" wins over
 * "race". Answers the text and the hrefs it wrote.
 */
export function linkTerms(
  text: string,
  terms: readonly string[],
): { text: string; links: string[] } {
  let parts = segments(text)
  const links: string[] = []
  const ordered = [...terms].sort((a, b) => b.length - a.length)

  for (const term of ordered) {
    const pattern = termPattern(term)
    const i = parts.findIndex(p => p.isProse && pattern.test(p.text))
    const part = parts[i]
    if (part === undefined) continue

    const m = pattern.exec(part.text)
    if (m === null) continue
    const start = m.index
    const href = LINK_ROOT + slug(term)
    const label = m[0].replace(/([\[\]\\])/g, '\\$1')
    parts = [
      ...parts.slice(0, i),
      { text: part.text.slice(0, start), isProse: true },
      { text: `[${label} ${MARK}](${href})`, isProse: false },
      { text: part.text.slice(start + m[0].length), isProse: true },
      ...parts.slice(i + 1),
    ]
    links.push(href)
  }

  return { text: parts.map(p => p.text).join(''), links }
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const s = value.replace(/\s+/g, ' ').trim()

  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/**
 * Reads the model's JSON answer: the first item that carries a definition.
 * An answer that is no JSON array (cut off, wrapped in prose) or an empty one
 * is null. The term itself is the caller's: what the person asked about.
 */
export function parseDefinition(raw: string): Definition | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return null

  let data: unknown
  try {
    data = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(data)) return null

  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const definition = clip(o.definition, 200)
    if (!definition) continue

    return { kind: clip(o.kind, 40), definition, context: clip(o.context, 160) }
  }

  return null
}

export const DEFINE_SYSTEM = `You explain one technical term in plain English for a reader who is new to programming.

Answer with a JSON array holding one item, no prose:
[{"kind": "...", "definition": "...", "context": "..."}]

- kind: two or three words naming what it is and its field, like "adjective, APIs" or "tool, version control".
- definition: plain English, at most 18 words, without using the term itself.
- context: when a reply is given, at most 16 words on what the term means or does in it; otherwise "".

If it is not something you can define, answer [].`
