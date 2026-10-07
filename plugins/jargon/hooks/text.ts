import type { JargonEntry } from '../types'
import { COMMON_WORDS } from './common'

export const LINK_ROOT = 'https://jargon.invalid/'
export const MAX_TERMS = 8
/** Drawn after each linked term, inside the link, so the mark presses with the word. */
export const MARK = 'ⓘ'

export type Extracted = JargonEntry & { slug: string; context: string }

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

/** All capitals (and digits): matched as written, so "RED" never matches "red". */
export function isAcronym(term: string): boolean {
  return /^[A-Z0-9]{2,}$/.test(term) && /[A-Z]/.test(term)
}

/** Matches the term as a whole word, any case unless it is an acronym. */
export function termPattern(term: string): RegExp {
  return new RegExp(`(?<![\\w-])${escape(term)}(?![\\w-])`, isAcronym(term) ? '' : 'i')
}

export function hasTerm(text: string, term: string): boolean {
  return term.trim() !== '' && termPattern(term).test(text)
}

/**
 * One pattern for a whole glossary: answers the slugs of the terms a text
 * holds, in the order they appear. Built once per glossary, not per draw.
 */
export function termMatcher(
  entries: ReadonlyArray<readonly [slug: string, term: string]>,
): (text: string) => string[] {
  const bySpelling = new Map<string, { slug: string; term: string }>()
  for (const [s, term] of entries) {
    if (term.trim() !== '') bySpelling.set(term.toLowerCase(), { slug: s, term })
  }
  if (bySpelling.size === 0) return () => []

  const alternatives = [...bySpelling.keys()].sort((a, b) => b.length - a.length).map(escape)
  const pattern = new RegExp(`(?<![\\w-])(?:${alternatives.join('|')})(?![\\w-])`, 'gi')

  return text => {
    const out = new Set<string>()
    for (const m of text.matchAll(pattern)) {
      const entry = bySpelling.get(m[0].toLowerCase())
      if (entry === undefined || (isAcronym(entry.term) && m[0] !== entry.term)) continue
      out.add(entry.slug)
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

/** The text with code and links taken out: what a reader reads as prose. */
export function proseOf(text: string): string {
  return segments(text)
    .filter(p => p.isProse)
    .map(p => p.text)
    .join(' ')
}

/**
 * The distinct words of a reply's prose, lower case, two characters or more
 * (`npm`, `ssh` count), with `C++`, `gRPC`, `node.js` kept whole.
 */
export function wordsOf(text: string): string[] {
  const found = proseOf(text).match(/[A-Za-z][A-Za-z0-9+#._-]*[A-Za-z0-9+#]/g) ?? []

  return [...new Set(found.map(w => w.toLowerCase()))]
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

let common: Set<string> | null = null

/** The word and the forms it may be inflected from: "validates" -> "validate". */
function baseForms(word: string): string[] {
  const out = [word]
  const strip = (suffix: string, add = '') => {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      out.push(word.slice(0, -suffix.length) + add)
    }
  }
  strip('ies', 'y')
  strip('es')
  strip('s')
  strip('ed')
  strip('ed', 'e')
  strip('d')
  strip('ing')
  strip('ing', 'e')
  const doubled = /(.)\1(?:ed|ing)$/.exec(word)
  if (doubled !== null) out.push(word.slice(0, doubled.index + 1))

  return out
}

/** An everyday English word, or an inflection of one (see scripts/common-words.py). */
function isCommonWord(word: string): boolean {
  common ??= new Set(COMMON_WORDS.split(' '))
  const set = common

  return baseForms(word.toLowerCase()).some(w => set.has(w))
}

const CODE_FILE = /\.(?:jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|json|ya?ml|toml|css|scss|html|sh|lock|md)$/i

/**
 * Whether a term can be jargon at all. Never: one everyday word on its own
 * ("tests", "pass", "validates": it may still head a phrase like "unit
 * test"), a commit hash, or a path. Acronyms and odd spellings (CORS,
 * GraphQL, C++, node.js) always can. Other names from the person's code are
 * left out by `parseExtraction`, which wants a term in the reply's prose.
 */
export function isJargonCandidate(term: string): boolean {
  const t = term.trim()
  if (t === '') return false
  if (/^[0-9a-f]{7,40}$/i.test(t) && /\d/.test(t)) return false
  if (t.includes('/') && (/^[.~]/.test(t) || CODE_FILE.test(t) || /\/.*\//.test(t))) return false
  if (/^[A-Za-z][a-z]+$/.test(t) && isCommonWord(t)) return false

  return true
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const s = value.replace(/\s+/g, ' ').trim()

  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/**
 * Reads the model's JSON answer: keeps entries that can be jargon and appear
 * in the prose of `text` (a name seen only in code is the person's own), one
 * per slug, at most MAX_TERMS; `dropped` names the terms past that cap.
 * An answer that is no JSON array (cut off, wrapped in prose) is null.
 */
export function parseExtraction(
  raw: string,
  text: string,
): { found: Extracted[]; dropped: string[] } | null {
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

  const prose = proseOf(text)
  const seen = new Set<string>()
  const out: Extracted[] = []
  const dropped: string[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const term = clip(o.term, 60)
    const definition = clip(o.definition, 200)
    if (!term || !definition || !hasTerm(prose, term) || !isJargonCandidate(term)) continue
    const s = slug(term)
    if (seen.has(s)) continue
    seen.add(s)
    if (out.length === MAX_TERMS) {
      dropped.push(term)
      continue
    }
    out.push({
      slug: s,
      term,
      kind: clip(o.kind, 40),
      definition,
      context: clip(o.context, 160),
    })
  }

  return { found: out, dropped }
}

export const EXTRACT_SYSTEM = `You find technical jargon in a coding assistant's reply so a reader can look it up. The reader knows general computing (files, apps, folders, browsers, the internet) but not the software-development trade.

Answer with a JSON array only, no prose, at most ${MAX_TERMS} items:
[{"term": "...", "kind": "...", "definition": "...", "context": "..."}]

- term: copied exactly as it appears in the reply. Only terms whose meaning that reader could not guess from everyday English: specialist concepts, acronyms, and names of tools, protocols, libraries and languages.
- Skip everyday words even when they are about code: test, pass, fail, validate, check, run, fix, build, change, save, update, error, file, folder, setting, version. Skip names from the person's own project: its files, folders, variables, functions, components, commit hashes and branch names.
- kind: two or three words naming what it is and its field, like "adjective, APIs" or "tool, version control".
- definition: plain English, at most 18 words, without using the term itself. Never guess what an acronym stands for.
- context: at most 16 words on what it means or does in this reply.

Most replies have little or no jargon: [] is a normal answer, and ${MAX_TERMS} is a limit, not a target.`
