import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { JargonEntry, JargonGlossary, JargonNotes, JargonPin } from '../types'
import { emptyCache, parseCache } from './cache'
import type { CacheFile } from './cache'
import { card, cardLeft, cardWidth, chipOffsets } from './card'
import { admit, keepJargon, merge } from './glossary'
import type { Counts } from './glossary'
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
const MIN_REPLY_CHARS = 80
// One reply in this many that would be skipped is checked anyway, so a
// multi-word term made of familiar words ("race condition") is still found.
const RECHECK_EVERY = 10

type Term = JargonEntry & { slug: string }

// The cache file is the module's own: read at session.start (a reload too),
// written after each answer Haiku gives and each skip, merged with what is on
// disk so sessions side by side keep each other's terms. `$.store` keeps a
// copy so a file left broken never costs the glossary.
let seen = new Set<string>()
let counts: Counts = { asked: 0, skipped: 0 }
let saved: Counts = { asked: 0, skipped: 0 }
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

/**
 * Writes the glossary, read words and counts, merged with the file as it is
 * now. Two saves from two sessions landing in the same instant can still
 * lose one's changes.
 */
function save($: EngineInterface): Promise<void> {
  writing = writing
    .then(async () => {
      const raw = cachePath && (await $.fs.exists(cachePath)) ? String(await $.fs.read(cachePath)) : ''
      const sent = counts
      const file = merge(raw ? parseCache(raw) : null, {
        glossary: await read($, glossary),
        seen,
        counts: sent,
      })
      await $.store.set(BACKUP_KEY, file)
      if (cachePath) await $.fs.write(cachePath, JSON.stringify(file, null, 2))
      // Take in what other sessions saved, keeping what this one found meanwhile.
      const none = { asked: 0, skipped: 0 }
      await update($, glossary, now => merge(file, { glossary: now, seen: [], counts: none }).glossary)
      seen = new Set([...file.seen, ...seen])
      saved = { asked: file.asked, skipped: file.skipped }
      counts = { asked: counts.asked - sent.asked, skipped: counts.skipped - sent.skipped }
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
  counts = { ...counts, asked: counts.asked + 1 }
  const own = await read($, notes)
  const next = admit(await read($, glossary), own, parsed.found, text)
  await update($, glossary, () => next.glossary)
  if (next.notes !== own) await update($, notes, () => next.notes)
  await save($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    let cache = emptyCache()
    try {
      const home = await $.env.get('HOME')
      cachePath = home ? `${home}/.claude/jargon/cache.json` : ''
      cache = await loadCache($)
    } catch (err) {
      $.ui.log(`jargon: could not read the cache, starting empty: ${String(err)}`)
    }
    seen = new Set(cache.seen)
    saved = { asked: cache.asked, skipped: cache.skipped }
    counts = { asked: 0, skipped: 0 }
    pending = new Set()
    let dropped = 0
    await update($, glossary, known => {
      const kept = keepJargon({ ...cache.glossary, ...known })
      dropped = kept.dropped

      return kept.glossary
    })
    if (dropped > 0) {
      debug($, `dropped ${dropped} saved terms that are not jargon`)
      await save($)
    }
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
    const skipped = saved.skipped + counts.skipped
    const total = saved.asked + counts.asked + skipped
    const spared = total > 0 ? `Haiku skipped on ${skipped} of ${total} replies. ` : ''
    const where = cachePath ? `Cache: ${cachePath}` : 'Cache: kept in the plugin store (no HOME)'

    return { text: [...lines, '', `${spared}${where}`].join('\n') }
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
      const fresh = words.filter(w => !seen.has(w) && !pending.has(w))
      if (fresh.length === 0 && skipStreak < RECHECK_EVERY - 1) {
        // Every word was read before: known terms highlight from the cache.
        skipStreak += 1
        counts = { ...counts, skipped: counts.skipped + 1 }
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
