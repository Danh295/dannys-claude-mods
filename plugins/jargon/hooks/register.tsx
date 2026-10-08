import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { JargonEntry, JargonGlossary, JargonLevel, JargonNotes, JargonPin } from '../types'
import { BUNDLED, DEFAULT_LEVEL, LEVELS, bundledFor, isLevel } from './bundled'
import { emptyCache, parseCache } from './cache'
import type { CacheFile } from './cache'
import { card, cardLeft, cardWidth, chipOffsets } from './card'
import { MAX_GLOSSARY, MAX_REPLIES, keepLast, merge, withoutBundled } from './glossary'
import {
  DEFINE_SYSTEM,
  LINK_ROOT,
  hasTerm,
  linkTerms,
  parseDefinition,
  proseOf,
  replyKey,
  slug,
  termMatcher,
} from './text'

const glossary = atom({ plugin: 'jargon', key: 'glossary' } as const, {} as JargonGlossary)
const notes = atom({ plugin: 'jargon', key: 'notes' } as const, {} as JargonNotes)
const pinned = atom({ plugin: 'jargon', key: 'pinned' } as const, null as JargonPin | null)
const isOn = atom({ plugin: 'jargon', key: 'isOn' } as const, true)
const level = atom({ plugin: 'jargon', key: 'level' } as const, DEFAULT_LEVEL as JargonLevel)
const lookedUp = atom({ plugin: 'jargon', key: 'lookedUp' } as const, [] as string[])

const STORE_KEY = 'glossary'
const BACKUP_KEY = 'cache'
const LEVEL_KEY = 'level'
const MAX_RECENT = 20
const MAX_TERMS = 8

type Term = JargonEntry & { slug: string }

// The cache file is the module's own: read at session.start (a reload too),
// written after each lookup, merged with what is on disk so sessions side by
// side keep each other's terms. `$.store` keeps a copy so a file left broken
// never costs the glossary. `saved` is the file's Haiku count as last read;
// `asked` counts this session's calls not yet written.
let saved = 0
let asked = 0
let cachePath = ''
let writing: Promise<void> = Promise.resolve()

// One combined pattern per glossary version, and each reply's terms under it.
let matcher: { version: string; find: (text: string) => string[] } | null = null

// The transcript's width beside a docked pane, as the band last measured it
// (its body plus the engine's five for `[-]`); `viewport.columns` is the whole
// screen's. A render hook may not write state, so the band leaves it here.
let transcriptColumns: number | undefined

// The replies in the order they were first drawn, newest last: where
// `/jargon <term>` finds the reply a term came from. Kept here for the same
// reason; a reload losing it costs only that context.
let recent: string[] = []

// The glossary replies are matched against, as last built, and what it was
// built from: rebuilt only when the level, the glossary or the lookups change.
let visible: {
  level: JargonLevel
  defined: JargonGlossary
  looked: readonly string[]
  terms: JargonGlossary
} | null = null

const CHIP_LEAD = 'Terms'.length
const CHIP_GAP = 2
const termsMemo = new Map<string, Term[]>()

function debug($: EngineInterface, line: string): void {
  $.ui.log(`jargon: ${line}`, { to: 'debug' })
}

/**
 * Writes the glossary, lookups and Haiku count, merged with the file as it is
 * now. Two saves from two sessions landing in the same instant can still lose
 * one's changes.
 */
function save($: EngineInterface): Promise<void> {
  writing = writing
    .then(async () => {
      const sent = asked
      const file = merge(await lastSaved($), {
        glossary: await read($, glossary),
        lookedUp: await read($, lookedUp),
        asked: sent,
      })
      await $.store.set(BACKUP_KEY, file)
      if (cachePath) await $.fs.write(cachePath, JSON.stringify(file, null, 2))
      // Take in what other sessions saved, keeping what this one found meanwhile.
      await update($, glossary, now => keepLast({ ...file.glossary, ...now }, MAX_GLOSSARY))
      await update($, lookedUp, now => [...new Set([...file.lookedUp, ...now])].slice(-MAX_GLOSSARY))
      saved = file.asked
      asked -= sent
    })
    .catch(err => debug($, `could not save the cache: ${String(err)}`))

  return writing
}

/** The cache as last written by any session: the file, else the store's copy (no HOME, or a broken file). */
async function lastSaved($: EngineInterface): Promise<CacheFile | null> {
  if (cachePath && (await $.fs.exists(cachePath))) {
    const fromFile = parseCache(String(await $.fs.read(cachePath)))
    if (fromFile !== null) return fromFile
  }
  const backup = await $.store.get(BACKUP_KEY)

  return backup === undefined ? null : parseCache(JSON.stringify(backup))
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

/**
 * The terms a reply shows, at most MAX_TERMS: the terms defined from it first,
 * then the ones the person looked up, then the rest in order of appearance, so
 * a looked-up term is never crowded out by common words earlier in the reply.
 */
function termsFor(
  text: string,
  known: JargonGlossary,
  looked: readonly string[],
  own: Record<string, string>,
): Term[] {
  const slugs = Object.keys(known)
  const version = `${slugs.length}:${slugs[slugs.length - 1] ?? ''}:${looked.length}`
  if (matcher?.version !== version) {
    matcher = { version, find: termMatcher(slugs.map(s => [s, known[s]?.term ?? ''])) }
    termsMemo.clear()
  }
  const memoKey = `${replyKey(text)}:${Object.keys(own).join(',')}`
  const memo = termsMemo.get(memoKey)
  if (memo !== undefined) return memo

  // Only prose counts: a name used just in code is the person's own.
  const prose = proseOf(text)
  const out: Term[] = []
  const taken = new Set<string>()
  const add = (s: string) => {
    const entry = known[s]
    if (entry === undefined || taken.has(s) || out.length >= MAX_TERMS) return
    if (!hasTerm(prose, entry.term)) return
    taken.add(s)
    out.push({ ...entry, slug: s })
  }
  const found = matcher.find(prose)
  const isLooked = new Set(looked)
  for (const s of Object.keys(own)) add(s)
  for (const s of found) if (isLooked.has(s)) add(s)
  for (const s of found) add(s)

  if (termsMemo.size > 300) termsMemo.clear()
  termsMemo.set(memoKey, out)

  return out
}

/** What highlights at `lvl`: its bundled terms, any bundled one looked up, and every defined one. */
function visibleTerms(lvl: JargonLevel, defined: JargonGlossary, looked: readonly string[]): JargonGlossary {
  if (visible?.level === lvl && visible.defined === defined && visible.looked === looked) {
    return visible.terms
  }
  const terms: JargonGlossary = { ...bundledFor(lvl) }
  for (const s of looked) {
    const entry = BUNDLED[s]
    if (entry !== undefined) terms[s] = entry
  }
  Object.assign(terms, defined)
  visible = { level: lvl, defined, looked, terms }

  return terms
}

function remember(text: string): void {
  if (recent.includes(text)) return
  const last = recent[recent.length - 1]
  // A reply drawn while it streams grows: keep its latest text, not each step.
  if (last !== undefined && text.startsWith(last)) {
    recent = [...recent.slice(0, -1), text]
    return
  }
  recent = [...recent, text].slice(-MAX_RECENT)
}

/** The newest reply that holds `term`, if any. */
function replyWith(term: string): string | undefined {
  for (let i = recent.length - 1; i >= 0; i--) {
    if (hasTerm(recent[i]!, term)) return recent[i]
  }

  return undefined
}

/** Records a lookup: the term then highlights at every level, ranked first. */
async function markLookedUp($: EngineInterface, s: string): Promise<void> {
  await update($, lookedUp, list => (list.includes(s) ? list : [...list, s].slice(-MAX_GLOSSARY)))
  await save($)
}

/** Pins the card, or with highlights off answers with the definition itself. */
async function show($: EngineInterface, s: string, entry: JargonEntry, hash: string, verb: string): Promise<string> {
  if (!(await read($, isOn))) return `**${entry.term}**: ${entry.definition}`
  await update($, pinned, () => ({ slug: s, hash }))

  return `${verb} ${entry.term}.`
}

/**
 * Shows the card for `term`, asking Haiku only when jargon doesn't know it
 * yet. Either way the term is looked up, so it highlights from then on.
 */
async function define($: EngineInterface, term: string): Promise<string> {
  const s = slug(term)
  const reply = replyWith(term)
  const hash = reply === undefined ? '' : replyKey(reply)
  const entry = (await read($, glossary))[s] ?? BUNDLED[s]
  if (entry !== undefined) {
    await markLookedUp($, s)

    return show($, s, entry, hash, 'Pinned')
  }

  const result = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 400,
    timeoutMs: 20000,
    system: DEFINE_SYSTEM,
    prompt: reply === undefined ? `Define: ${term}` : `<reply>\n${reply}\n</reply>\n\nDefine: ${term}`,
  })
  if (!result.isAnswered) {
    debug($, `Haiku gave no answer (${result.reason})`)

    return `Couldn't define ${term}.`
  }
  asked += 1

  const found = parseDefinition(result.text)
  if (found === null) {
    debug($, `Haiku answered no definition of ${term}`)
    await save($)

    return `Couldn't define ${term}.`
  }

  // Kept under the person's own spelling: what they will see in replies.
  const added: JargonEntry = { term, kind: found.kind, definition: found.definition }
  await update($, glossary, all => {
    const next = { ...all }
    delete next[s]
    next[s] = added

    return keepLast(next, MAX_GLOSSARY)
  })
  if (reply !== undefined && found.context !== '') {
    await update($, notes, all => {
      const next = { ...all }
      const own = { ...next[hash], [s]: found.context }
      delete next[hash]
      next[hash] = own

      return keepLast(next, MAX_REPLIES)
    })
  }
  await markLookedUp($, s)

  return show($, s, added, hash, 'Defined')
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
    saved = cache.asked
    asked = 0
    // Caches from 0.1.x hold Haiku's picks of built-in terms too: the built-in
    // entry and its tier take over, so the level applies to them.
    const own = withoutBundled(cache.glossary)
    const dropped = Object.keys(cache.glossary).length - Object.keys(own).length
    await update($, glossary, known => ({ ...own, ...known }))
    await update($, lookedUp, list => [...new Set([...cache.lookedUp, ...list])])
    if (dropped > 0) {
      debug($, `dropped ${dropped} saved terms that are built in`)
      await save($)
    }
    const kept = await $.store.get(LEVEL_KEY)
    if (isLevel(kept)) await update($, level, () => kept)
    await $.command.register({
      name: 'jargon',
      description: 'Jargon highlights: define a term, set your level, turn them on or off, or list the terms Haiku defined',
      argumentHint: '[term|level <beginner|intermediate|advanced>|on|off]',
    })

    return next(e)
  })

  on('command.run', { command: 'jargon' }, async ($, e) => {
    const arg = e.args.trim()
    const word = arg.toLowerCase()
    // `level` alone or with one word is the setting (one word that is no level
    // is a typo, answered for free); `level of indirection` is a term.
    const [first, ...rest] = word.split(/\s+/)
    if (first === 'level' && rest.length <= 1) {
      const name = rest[0]
      if (name === undefined) {
        return { text: `Level: ${await read($, level)}. Choose with /jargon level ${LEVELS.join('|')}.` }
      }
      if (!isLevel(name)) return { text: `No level "${name}". Levels: ${LEVELS.join(', ')}.` }
      await update($, level, () => name)
      await $.store.set(LEVEL_KEY, name)

      return { text: `Level: ${name}. ${Object.keys(bundledFor(name)).length} built-in terms highlight.` }
    }
    if (word === 'on' || word === 'off') {
      await update($, isOn, () => word === 'on')
      if (word === 'off') await update($, pinned, () => null)

      return { text: word === 'on' ? 'Jargon highlights on.' : 'Jargon highlights off.' }
    }
    if (arg !== '') return { text: await define($, arg) }

    const current = await read($, level)
    const builtIn =
      `Level ${current}: ${Object.keys(bundledFor(current)).length} built-in terms highlight by themselves; ` +
      '/jargon <term> defines any other, /jargon level changes the level.'
    const defined = Object.values(await read($, glossary))
    if (defined.length === 0) return { text: builtIn }

    const lines = defined
      .slice(-40)
      .reverse()
      .map(t => `**${t.term}**: ${t.definition}`)
    const calls = saved + asked
    const count = `Haiku asked ${calls} ${calls === 1 ? 'time' : 'times'}. `
    const where = cachePath ? `Cache: ${cachePath}` : 'Cache: kept in the plugin store (no HOME)'

    return { text: [...lines, '', builtIn, `${count}${where}`].join('\n') }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const text = e.props.text
    remember(text)
    if (!(await read($, isOn))) return next(e)

    const key = replyKey(text)
    const own = (await read($, notes))[key] ?? {}
    const looked = await read($, lookedUp)
    const known = visibleTerms(await read($, level), await read($, glossary), looked)
    const terms = termsFor(text, known, looked, own)
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
    if (pin === null || e.props.hasSurvey || !(await read($, isOn))) return next(e)

    const entry = (await read($, glossary))[pin.slug] ?? BUNDLED[pin.slug]
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
