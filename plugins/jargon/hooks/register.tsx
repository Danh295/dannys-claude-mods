import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { JargonEntry, JargonGlossary, JargonNotes, JargonPin } from '../types'
import { MAX_SEEN, emptyCache, novelWords, parseCache } from './cache'
import type { CacheFile } from './cache'
import { card, cardLeft, cardWidth, chipOffsets } from './card'
import {
  EXTRACT_SYSTEM,
  LINK_ROOT,
  MAX_TERMS,
  hasTerm,
  linkTerms,
  parseExtraction,
  replyKey,
  termMatcher,
  wordsOf,
} from './text'

const glossary = atom({ plugin: 'jargon', key: 'glossary' } as const, {} as JargonGlossary)
const notes = atom({ plugin: 'jargon', key: 'notes' } as const, {} as JargonNotes)
const pinned = atom({ plugin: 'jargon', key: 'pinned' } as const, null as JargonPin | null)
const isOn = atom({ plugin: 'jargon', key: 'isOn' } as const, true)

const STORE_KEY = 'glossary'
const BACKUP_KEY = 'cache'
const MAX_GLOSSARY = 500
const MAX_REPLIES = 60
const MIN_REPLY_CHARS = 80
// One reply in this many that would be skipped is checked anyway, so a
// multi-word term made of familiar words ("race condition") is still found.
const RECHECK_EVERY = 10

type Term = JargonEntry & { slug: string }

function keepLast<T>(record: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= max) return record

  return Object.fromEntries(keys.slice(-max).map(k => [k, record[k] as T]))
}

// The cache file is the module's own: read at session.start (a reload too),
// written after each answer Haiku gives and each skip. `$.store` keeps a copy
// so a file left broken never costs the glossary.
let cache: CacheFile = emptyCache()
let seen = new Set<string>()
let pending = new Set<string>()
let skipStreak = 0
let cachePath = ''
let writing: Promise<void> = Promise.resolve()

// One combined pattern per glossary version, and each reply's terms under it.
let matcher: { version: string; find: (text: string) => string[] } | null = null

// The transcript's width beside a docked pane, as the band last measured it
// (its body plus the engine's five for `[-]`); `viewport.columns` is the whole
// screen's. A render hook may not write state, so the band leaves it here.
let transcriptColumns: number | undefined

const CHIP_LEAD = 'Terms'.length
const CHIP_GAP = 2
const termsMemo = new Map<string, Term[]>()

function debug($: EngineInterface, line: string): void {
  $.ui.log(`jargon: ${line}`, { to: 'debug' })
}

async function save($: EngineInterface): Promise<void> {
  cache = {
    ...cache,
    glossary: await read($, glossary),
    seen: [...seen].slice(-MAX_SEEN),
  }
  const snapshot = cache
  const text = JSON.stringify(snapshot, null, 2)
  writing = writing
    .then(async () => {
      await $.store.set(BACKUP_KEY, snapshot)
      if (cachePath) await $.fs.write(cachePath, text)
    })
    .catch(err => debug($, `could not save the cache: ${String(err)}`))

  return writing
}

async function loadCache($: EngineInterface): Promise<CacheFile> {
  const backup = await $.store.get(BACKUP_KEY)
  const fromStore = backup === undefined ? null : parseCache(JSON.stringify(backup))
  if (cachePath && (await $.fs.exists(cachePath))) {
    const raw = String(await $.fs.read(cachePath))
    const fromFile = parseCache(raw)
    if (fromFile !== null) return fromFile

    // Unreadable: keep it for the person, carry on from the copy.
    const aside = `${cachePath}.broken-${Date.now()}`
    await $.fs.write(aside, raw)
    $.ui.log(`jargon: ${cachePath} was unreadable; moved it to ${aside}`)
  }
  if (fromStore !== null) return fromStore

  // Glossaries saved before the cache file existed.
  const old = await $.store.get(STORE_KEY)
  if (typeof old === 'object' && old !== null && !Array.isArray(old)) {
    return parseCache(JSON.stringify({ glossary: old })) ?? emptyCache()
  }

  return emptyCache()
}

/** The terms a reply shows: its own extraction first, then any known term in it. */
function termsFor(text: string, known: JargonGlossary, own: Record<string, string>): Term[] {
  const slugs = Object.keys(known)
  const version = `${slugs.length}:${slugs[slugs.length - 1] ?? ''}`
  if (matcher?.version !== version) {
    matcher = { version, find: termMatcher(slugs.map(s => [s, known[s]?.term ?? ''])) }
    termsMemo.clear()
  }
  const memoKey = `${replyKey(text)}:${Object.keys(own).join(',')}`
  const memo = termsMemo.get(memoKey)
  if (memo !== undefined) return memo

  const out: Term[] = []
  const taken = new Set<string>()
  const add = (s: string) => {
    const entry = known[s]
    if (entry === undefined || taken.has(s) || out.length >= MAX_TERMS) return
    if (!hasTerm(text, entry.term)) return
    taken.add(s)
    out.push({ ...entry, slug: s })
  }
  for (const s of Object.keys(own)) add(s)
  for (const s of matcher.find(text)) add(s)

  if (termsMemo.size > 300) termsMemo.clear()
  termsMemo.set(memoKey, out)

  return out
}

async function extract($: EngineInterface, text: string, words: string[]): Promise<void> {
  const known = Object.values(await read($, glossary))
    .filter(t => hasTerm(text, t.term))
    .map(t => t.term)
  const skip = known.length > 0 ? `\n\nAlready defined, leave out: ${known.join(', ')}` : ''
  const result = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 1500,
    timeoutMs: 20000,
    system: EXTRACT_SYSTEM,
    prompt: `<reply>\n${text}\n</reply>${skip}`,
  })
  if (!result.isAnswered) {
    debug($, `Haiku gave no answer (${result.reason})`)
    return
  }

  const parsed = parseExtraction(result.text, text)
  if (parsed === null) {
    debug($, 'Haiku answered something other than a JSON list; will ask again')
    return
  }

  // Haiku has read these words: never ask about them again, except the words
  // of terms past the cap, which a later reply asks about.
  const left = new Set(parsed.dropped.flatMap(wordsOf))
  for (const w of words) if (!left.has(w)) seen.add(w)
  cache = { ...cache, asked: cache.asked + 1 }

  const { found } = parsed
  if (found.length > 0) {
    await update($, glossary, all => {
      const next = { ...all }
      for (const f of found) {
        delete next[f.slug]
        next[f.slug] = { term: f.term, kind: f.kind, definition: f.definition }
      }

      return keepLast(next, MAX_GLOSSARY)
    })
    await update($, notes, all => {
      const own: Record<string, string> = {}
      for (const f of found) own[f.slug] = f.context
      const key = replyKey(text)
      const next = { ...all }
      delete next[key]
      next[key] = own

      return keepLast(next, MAX_REPLIES)
    })
  }
  await save($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const home = await $.env.get('HOME')
      cachePath = home ? `${home}/.claude/jargon/cache.json` : ''
      cache = await loadCache($)
    } catch (err) {
      cache = emptyCache()
      $.ui.log(`jargon: could not read the cache, starting empty: ${String(err)}`)
    }
    seen = new Set(cache.seen)
    pending = new Set()
    await update($, glossary, known => ({ ...cache.glossary, ...known }))
    await $.command.register({
      name: 'jargon',
      description: 'Jargon highlights: on, off, or list the terms defined so far',
      argumentHint: '[on|off]',
    })

    return next(e)
  })

  on('command.run', { command: 'jargon' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, isOn, () => arg === 'on')
      if (arg === 'off') await update($, pinned, () => null)

      return { text: arg === 'on' ? 'Jargon highlights on.' : 'Jargon highlights off.' }
    }

    const known = Object.values(await read($, glossary))
    if (known.length === 0) {
      return { text: 'No terms yet. They appear after Claude replies with some jargon.' }
    }
    const lines = known
      .slice(-40)
      .reverse()
      .map(t => `**${t.term}**: ${t.definition}`)
    const total = cache.asked + cache.skipped
    const saved = total > 0 ? `Haiku skipped on ${cache.skipped} of ${total} replies. ` : ''
    const where = cachePath ? `Cache: ${cachePath}` : 'Cache: kept in the plugin store (no HOME)'

    return { text: [...lines, '', `${saved}${where}`].join('\n') }
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const isReply =
      e.door === 'response' && e.message.type === 'assistant' && e.agentId === undefined
    if (!isReply || !(await read($, isOn))) return stored

    for (const block of e.message.content) {
      const text = block.type === 'text' && typeof block.text === 'string' ? block.text : ''
      if (text.trim().length < MIN_REPLY_CHARS) continue

      const words = wordsOf(text)
      const fresh = novelWords(words, seen).filter(w => !pending.has(w))
      if (fresh.length === 0 && skipStreak < RECHECK_EVERY - 1) {
        // Every word was read before: known terms highlight from the cache.
        skipStreak += 1
        cache = { ...cache, skipped: cache.skipped + 1 }
        void save($)
        continue
      }
      skipStreak = 0
      for (const w of fresh) pending.add(w)
      $.clock.after(0, () => {
        extract($, text, words)
          .catch(err => debug($, `extraction failed: ${String(err)}`))
          .finally(() => {
            for (const w of fresh) pending.delete(w)
          })
      })
    }

    return stored
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary || !(await read($, isOn))) return next(e)

    const text = e.props.text
    const key = replyKey(text)
    const own = (await read($, notes))[key] ?? {}
    const terms = termsFor(text, await read($, glossary), own)
    if (terms.length === 0) return next(e)

    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const linked = linkTerms(
      text,
      terms.map(t => t.term),
    )
    const pin = (s: string) => update($, pinned, () => ({ slug: s, hash: key }))
    const isTerminal = e.surface === 'terminal'
    const columns = e.viewport?.columns
    // The chip row's width: the transcript's, less the bullet's gutter.
    const rowWidth = Math.min(columns ?? 80, transcriptColumns ?? Infinity) - (isTerminal ? 2 : 0)
    const width = Math.min(cardWidth(columns), rowWidth)
    // A chip near the right edge opens its card leftwards, so it is never
    // squeezed against the edge.
    const offsets = chipOffsets(
      terms.map(t => t.term),
      rowWidth,
      CHIP_LEAD,
      CHIP_GAP,
    )

    const body = (
      <Box flexDirection="column">
        <Markdown
          key="reply"
          text={linked.text}
          pressableLinks={linked.links}
          onLinkPress={link => {
            if (link.href.startsWith(LINK_ROOT)) void pin(link.href.slice(LINK_ROOT.length))
          }}
        />
        <Box flexDirection="row" flexWrap="wrap" columnGap={CHIP_GAP}>
          <Text dimColor>Terms</Text>
          {terms.map((t, i) => (
            <Box key={`t-${t.slug}`}>
              <Button
                key={`chip-${t.slug}`}
                plain
                label={t.term}
                hover={{ color: 'claude', underline: true }}
                onPress={() => void pin(t.slug)}
              />
              <Box
                position="absolute"
                bottom={1}
                left={cardLeft(offsets[i] ?? 0, width, rowWidth)}
                display="none"
                backgroundColor="userMessageBackground"
                hover={{ display: 'flex' }}
              >
                {card({ Box, Text }, t, own[t.slug], width)}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )

    if (!isTerminal) return body

    return (
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text>{e.props.isFirstOfReply ? '⏺' : ' '}</Text>
        </Box>
        {body}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal') transcriptColumns = e.props.bodyColumns + 5
    const pin = await read($, pinned)
    if (pin === null || e.props.hasSurvey) return next(e)

    const entry = (await read($, glossary))[pin.slug]
    if (entry === undefined) return next(e)

    const note = (await read($, notes))[pin.hash]?.[pin.slug]
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" columnGap={2}>
        {card({ Box, Text }, entry, note, cardWidth(e.props.bodyColumns - 12))}
        <Button
          key="dismiss"
          role="dismiss"
          plain
          hotkey="x"
          label="Dismiss"
          dimColor
          onPress={() => void update($, pinned, () => null)}
        />
      </Box>
    )
  })
}
