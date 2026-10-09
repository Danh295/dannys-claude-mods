import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BUNDLED, LEVELS, TIERS, bundledFor, isLevel } from '../hooks/bundled'
import { emptyCache, parseCache } from '../hooks/cache'
import { cardLeft, cellWidth, chipOffsets } from '../hooks/card'
import {
  MAX_EXCERPT_CHARS,
  cleanTerm,
  excerpt,
  hasTerm,
  hash,
  isAcronym,
  linkTerms,
  parseDefinition,
  replyKey,
  slug,
  termMatcher,
} from '../hooks/text'

const REPLY =
  'Make the webhook handler idempotent so a retry from Stripe cannot charge twice. ' +
  'Guard the write with a mutex, and keep the key in `.env`:\n\n' +
  '```ts\nconst idempotent = true // not linked\n```\n'

const HAIKU = JSON.stringify([
  {
    kind: 'adjective, APIs',
    definition: 'Doing it twice has the same effect as doing it once.',
    context: 'a retried payment request will not charge the card twice.',
  },
])

/** The glossary Haiku defined for REPLY, as a cache from before built-in terms would hold it. */
const DEFINED = {
  idempotent: {
    term: 'idempotent',
    kind: 'adjective, APIs',
    definition: 'Doing it twice has the same effect as doing it once.',
  },
  mutex: {
    term: 'mutex',
    kind: 'noun, concurrency',
    definition: 'A lock that lets only one task touch something at a time.',
  },
}

describe('text helpers', () => {
  test('links only the first prose occurrence, never code', async () => {
    const { text, links } = linkTerms('a mutex, another mutex, `mutex`', ['mutex'])
    expect(text).toBe('a [mutex ⓘ](https://jargon.invalid/mutex), another mutex, `mutex`')
    expect(links).toEqual(['https://jargon.invalid/mutex'])

    const fenced = linkTerms(REPLY, ['idempotent'])
    expect(fenced.text).toContain('const idempotent = true')
    expect(fenced.text).toContain('[idempotent ⓘ](https://jargon.invalid/idempotent) so')
  })

  test('skips existing links and handles regex characters', async () => {
    const out = linkTerms('See [mutex docs](https://x.dev/mutex). Use C++ here.', [
      'mutex',
      'C++',
    ])
    expect(out.text).toBe(
      'See [mutex docs](https://x.dev/mutex). Use [C++ ⓘ](https://jargon.invalid/cplusplus) here.',
    )
    expect(slug('.env')).toBe('env')
  })

  test('longer terms win over the words inside them', async () => {
    const out = linkTerms('a race condition in the race', ['race', 'race condition'])
    expect(out.text).toBe(
      'a [race condition ⓘ](https://jargon.invalid/race-condition) in the [race ⓘ](https://jargon.invalid/race)',
    )
  })

  test('reads one definition from fenced JSON, whatever term it names', async () => {
    expect(parseDefinition('```json\n' + HAIKU + '\n```')).toEqual({
      kind: 'adjective, APIs',
      definition: 'Doing it twice has the same effect as doing it once.',
      context: 'a retried payment request will not charge the card twice.',
    })
    expect(parseDefinition('[{"term": "Kubernetes", "definition": "Runs containers."}]')?.definition).toBe(
      'Runs containers.',
    )
    expect(parseDefinition('no json here')).toBeNull()
    expect(parseDefinition('[{"definition": "A lo')).toBeNull()
    expect(parseDefinition('[]')).toBeNull()
  })

  test('a typed term loses its wrapping quotes, backticks and emphasis', async () => {
    expect(cleanTerm('`useEffect`')).toBe('useEffect')
    expect(cleanTerm('"race   condition"')).toBe('race condition')
    expect(cleanTerm("**'mutex'**")).toBe('mutex')
    expect(cleanTerm('C++')).toBe('C++')
    expect(cleanTerm('``')).toBe('``')
  })

  test('an excerpt is the reply whole when short, else the part around the term', async () => {
    expect(excerpt('Use a mutex. <context>hidden</context>', 'mutex')).toBe('Use a mutex.')
    const long = 'a '.repeat(2000) + 'the zork here ' + 'b '.repeat(2000)
    const cut = excerpt(long, 'zork')
    expect(cut).toContain('the zork here')
    expect(cut.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 2)
    expect(excerpt('zork ' + 'c '.repeat(2000), 'zork').startsWith('zork')).toBe(true)
  })

  test('acronyms match only in capitals; other terms in any case', async () => {
    expect(isAcronym('REST')).toBe(true)
    expect(isAcronym('CI/CD')).toBe(true)
    expect(isAcronym('UTF-8')).toBe(true)
    expect(isAcronym('OAuth')).toBe(false)
    expect(linkTerms('the rest of it', ['REST']).links).toEqual([])
    expect(linkTerms('a REST API', ['REST']).links).toEqual(['https://jargon.invalid/rest'])
    expect(hasTerm('A Mutex here', 'mutex')).toBe(true)

    const find = termMatcher([
      ['rest', 'REST'],
      ['api', 'API'],
      ['sql', 'SQL'],
      ['sql-injection', 'SQL injection'],
      ['mutex', 'mutex'],
    ])
    expect(find('the rest of it')).toEqual([])

    const saved = termMatcher([
      ['red', 'RED'],
      ['head', 'HEAD'],
      ['mutex', 'mutex'],
    ])
    expect(saved('a red button at the head of the list, behind a Mutex')).toEqual(['mutex'])
    expect(saved('Run RED first, then move HEAD.')).toEqual(['red', 'head'])
    expect(linkTerms('a red flag, then RED', ['RED']).text).toBe(
      'a red flag, then [RED ⓘ](https://jargon.invalid/red)',
    )
    expect(find('A Mutex guards the REST API from SQL injection.')).toEqual([
      'mutex',
      'rest',
      'api',
      'sql-injection',
    ])
  })
})

describe('card placement', () => {
  test('chips wrap like the row does', async () => {
    // "Terms" (5), gap 2: alpha at 7, beta at 14; gamma (5) would end at 26 > 24, so wraps.
    expect(chipOffsets(['alpha', 'beta', 'gamma', 'de'], 24, 5, 2)).toEqual([7, 14, 0, 7])
    expect(cellWidth('漢字')).toBe(4)
  })

  test('a card that fits opens rightwards', async () => {
    expect(cardLeft(10, 40, 100)).toBe(0)
    expect(cardLeft(60, 40, 100)).toBe(0)
  })

  test('a card near the right edge opens leftwards, its right edge on the row\'s', async () => {
    // Chip at 80 on a 100-wide row: a 40-wide card starts at 60.
    expect(cardLeft(80, 40, 100)).toBe(-20)
    expect(80 + cardLeft(80, 40, 100) + 40).toBe(100)
  })

  test('a card wider than the room left of its chip stops at the row\'s left edge', async () => {
    expect(cardLeft(10, 64, 50)).toBe(-10)
  })
})

describe('review fixes', () => {
  test('indented and double-backtick code is never linked', async () => {
    const text = 'Use a mutex.\n\n    lock = mutex()\n\nOr ``a `mutex` b``.'
    const out = linkTerms(text, ['mutex'])
    expect(out.links).toHaveLength(1)
    expect(out.text).toContain('    lock = mutex()')
    expect(out.text).toContain('``a `mutex` b``')
  })

  test('a reply keys the same with or without its context block', async () => {
    expect(replyKey('Hi <context>x</context>there')).toBe(replyKey('Hi there'))
  })

  test('one pattern finds every known term', async () => {
    const find = termMatcher([
      ['race', 'race'],
      ['race-condition', 'race condition'],
      ['mutex', 'mutex'],
    ])
    expect(find('A race condition; use a Mutex.')).toEqual(['race-condition', 'mutex'])
  })
})

describe('cache', () => {
  test('the file round-trips and a cut-off file reads as null', async () => {
    const file = {
      ...emptyCache(),
      glossary: { flux: { term: 'flux', kind: 'noun', definition: 'A flow.' } },
      lookedUp: ['flux'],
      asked: 2,
    }
    expect(parseCache(JSON.stringify(file))).toEqual(file)
    expect(parseCache('{"glossary": {"mutex": {"te')).toBeNull()
    expect(parseCache('{"glossary": {"x": {"term": 1}}, "seen": ["a"], "skipped": 5}')).toEqual(emptyCache())
  })
})

describe('bundled glossary', () => {
  test('every entry sits under its slug and defines it in plain, short words', async () => {
    const entries = Object.entries(BUNDLED)
    expect(entries.length).toBeGreaterThan(100)
    for (const [s, entry] of entries) {
      expect(s).toBe(slug(entry.term))
      expect(entry.kind).not.toBe('')
      expect(entry.definition.length).toBeLessThanOrEqual(200)
      expect(entry.definition.split(/\s+/).length).toBeLessThanOrEqual(18)
      expect(hasTerm(entry.definition, entry.term)).toBe(false)
    }
  })

  test('each level up hides the tier below it', async () => {
    for (const s of Object.keys(BUNDLED)) expect(TIERS[s]).toBeDefined()
    const [beginner, intermediate, advanced] = LEVELS.map(level => Object.keys(bundledFor(level)))
    expect(beginner!.length).toBe(Object.keys(BUNDLED).length)
    for (const s of intermediate!) expect(beginner).toContain(s)
    for (const s of advanced!) expect(intermediate).toContain(s)
    expect(intermediate).not.toContain('api')
    expect(intermediate).toContain('webhook')
    expect(advanced).toContain('idempotent')
    expect(advanced).not.toContain('webhook')
    expect(isLevel('advanced')).toBe(true)
    expect(isLevel('expert')).toBe(false)
  })

  test('skips words any beginner knows', async () => {
    for (const word of ['file', 'code', 'function', 'error', 'path', 'branch']) {
      expect(BUNDLED[slug(word)]).toBeUndefined()
    }
  })
})

test('a reply is highlighted, a chip pins its card, Dismiss clears it', async ($, on) => {
  mock.store(on, {
    glossary: DEFINED,
  })
  mock.env(on, { HOME: '/tmp/jargon-test' })
  on('fs.exists', () => ({ value: false }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine's own</Text>
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'jargon',
      surface,
      component: 'AssistantMessage',
      requestId: 'm1',
      viewport: { columns: 100, rows: 40 },
      props: { text: REPLY, isFirstOfReply: true },
    })
    const md = await ui.find({ type: 'Markdown', key: 'reply' })
    expect(md?.text).toContain('[idempotent ⓘ](https://jargon.invalid/idempotent)')
    expect(md?.text).toContain('[mutex ⓘ](https://jargon.invalid/mutex)')
    expect(await ui.find({ type: 'Button', key: 'chip-idempotent' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /same effect as doing it once/ })).toBeDefined()

    await ui.press({ key: 'chip-mutex' })
    const band = await $.ui.mount({
      plugin: 'jargon',
      surface,
      component: 'AbovePrompt',
      requestId: 'band',
      viewport: { columns: 100, rows: 40 },
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 12,
        bodyColumns: 95,
        scroll: { offset: 0, bodyRows: 11 },
        view: {},
      },
    })
    expect(await band.find({ type: 'Text', text: /only one task/ })).toBeDefined()

    await band.press({ key: 'dismiss' })
    expect(await band.find({ type: 'Text', text: /only one task/ })).toBeUndefined()

    await ui.press({ key: 'reply', link: { href: 'https://jargon.invalid/idempotent' } })
    expect(await band.find({ type: 'Text', text: /same effect/ })).toBeDefined()
    await band.press({ key: 'dismiss' })

    await band.unmount()
    await ui.unmount()
  }
})

test('replies with no known terms draw as the engine draws them', async ($, on) => {
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine's own</Text>
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'jargon',
      surface,
      component: 'AssistantMessage',
      requestId: 'm2',
      viewport: { columns: 100, rows: 40 },
      props: { text: 'Done. ' + hash('x'), isFirstOfReply: true },
    })
    expect(await ui.find({ type: 'Markdown', key: 'reply' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /engine's own/ })).toBeDefined()
    await ui.unmount()
  }
})

test('on a narrow screen each card opens leftwards to stay on screen', async ($, on) => {
  mock.store(on, {
    glossary: DEFINED,
  })
  mock.env(on, { HOME: '/tmp/jargon-test' })
  on('fs.exists', () => ({ value: false }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'jargon',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm3',
    viewport: { columns: 40, rows: 40 },
    props: { text: REPLY, isFirstOfReply: true },
  })
  const lefts: unknown[] = []
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const el = node as { props?: Record<string, unknown>; children?: unknown }
    if (el.props?.position === 'absolute') lefts.push(el.props.left)
    const kids = el.children ?? el.props?.children
    if (Array.isArray(kids)) kids.forEach(walk)
    else walk(kids)
  }
  walk(await ui.drawn())
  // Row 38 wide (40 less the bullet); cards 36 wide. Chips in reply order:
  // webhook sits at 7, idempotent at 16, mutex at 28.
  expect(lefts).toEqual([-5, -14, -26])
  await ui.unmount()
})

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 95,
  scroll: { offset: 0, bodyRows: 11 },
  view: {},
} as const

type Asked = { system?: string; prompt: string }

/** A fresh session: an empty store and cache, Haiku answering `answer`. */
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

async function lookupWorld(
  $: Engine,
  on: On,
  answer: () => unknown,
  store: Record<string, unknown> = {},
  before: () => Promise<unknown> = async () => undefined,
) {
  const asked: Asked[] = []
  const writes: { path: string; text: string }[] = []
  mock.store(on, store)
  mock.env(on, { HOME: '/tmp/jargon-test' })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', ($, e) => {
    writes.push(e as { path: string; text: string })
    return { value: undefined } as never
  })
  on('model.complete', ($, e) => {
    asked.push({ system: e.system, prompt: e.prompt })
    return { value: answer() } as never
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine's own</Text>
  })
  await before()
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  return { asked, writes }
}

const LOOKUP_REPLY =
  'Guard the counter with a mutex, or hand out slots with a semaphore so at most three workers run.'

test('bundled terms highlight and pin with no Haiku call', async ($, on) => {
  const w = await lookupWorld($, on, () => ({ isAnswered: false, reason: 'api-error', status: 500 }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'jargon',
      surface,
      component: 'AssistantMessage',
      requestId: `b-${surface}`,
      viewport: { columns: 100, rows: 40 },
      props: { text: LOOKUP_REPLY, isFirstOfReply: true },
    })
    const md = await ui.find({ type: 'Markdown', key: 'reply' })
    expect(md?.text).toContain('[mutex ⓘ](https://jargon.invalid/mutex)')
    expect(md?.text).not.toContain('semaphore ⓘ')

    const out = await $.command.run({ command: 'jargon', args: 'Mutex' } as never)
    expect(out.text).toBe('Pinned mutex.')
    const band = await $.ui.mount({
      plugin: 'jargon',
      surface,
      component: 'AbovePrompt',
      requestId: `band-${surface}`,
      viewport: { columns: 100, rows: 40 },
      props: BAND_PROPS,
    })
    expect(await band.find({ type: 'Text', text: /only one task/ })).toBeDefined()
    await band.press({ key: 'dismiss' })

    await band.unmount()
    await ui.unmount()
  }
  expect(w.asked).toEqual([])
})

test('/jargon <term> asks Haiku once, with the reply, and remembers the answer', async ($, on) => {
  const answer = JSON.stringify([
    {
      term: 'semaphore',
      kind: 'noun, concurrency',
      definition: 'A counter that lets only a set number of tasks in at once.',
      context: 'caps the workers running together at three.',
    },
  ])
  const w = await lookupWorld($, on, () => ({
    isAnswered: true,
    text: answer,
    usage: { inputTokens: 1, outputTokens: 1 },
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'jargon',
      surface,
      component: 'AssistantMessage',
      requestId: `d-${surface}`,
      viewport: { columns: 100, rows: 40 },
      props: { text: LOOKUP_REPLY, isFirstOfReply: true },
    })
    const out = await $.command.run({ command: 'jargon', args: 'semaphore' } as never)
    expect(out.text).toBe(surface === 'terminal' ? 'Defined semaphore.' : 'Pinned semaphore.')

    const md = await ui.find({ type: 'Markdown', key: 'reply' })
    expect(md?.text).toContain('[semaphore ⓘ](https://jargon.invalid/semaphore)')
    const band = await $.ui.mount({
      plugin: 'jargon',
      surface,
      component: 'AbovePrompt',
      requestId: `band-${surface}`,
      viewport: { columns: 100, rows: 40 },
      props: BAND_PROPS,
    })
    expect(await band.find({ type: 'Text', text: /set number of tasks/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /workers running together/ })).toBeDefined()
    await band.press({ key: 'dismiss' })

    await band.unmount()
    await ui.unmount()
  }

  // Asked once: the second surface found it in the glossary.
  expect(w.asked.length).toBe(1)
  expect(w.asked[0]?.prompt).toContain(LOOKUP_REPLY)
  expect(w.asked[0]?.prompt).toContain('Define: semaphore')

  const file = w.writes.filter(x => x.path === '/tmp/jargon-test/.claude/jargon/cache.json').at(-1)
  expect(file?.text).toContain('"semaphore"')
  expect(file?.text).not.toContain('"mutex"')
  expect(JSON.parse(file?.text ?? '{}').asked).toBe(1)
})

test('/jargon <term> says so when Haiku gives no definition', async ($, on) => {
  const w = await lookupWorld($, on, () => ({ isAnswered: false, reason: 'api-error', status: 500 }))
  const out = await $.command.run({ command: 'jargon', args: 'semaphore' } as never)
  expect(out.text).toBe("Couldn't define semaphore.")
  expect(w.asked.length).toBe(1)

  for (const surface of SURFACES) {
    const band = await mountBand($, surface)
    expect(await band.find({ type: 'Text', text: /engine's own/ })).toBeDefined()
    await band.unmount()
  }
})

test('a looked-up term still shows when common bundled terms come first', async ($, on) => {
  await lookupWorld($, on, NO_ANSWER, {
    glossary: { semaphore: { term: 'semaphore', kind: 'noun', definition: 'A counter of free slots.' } },
  })
  // Beginner shows the common words that would crowd the reply.
  await $.command.run({ command: 'jargon', args: 'level beginner' } as never)
  await $.command.run({ command: 'jargon', args: 'semaphore' } as never)

  for (const surface of SURFACES) {
    const ui = await mountReply($, CROWD, 'crowd', surface)
    expect(await chipsOf(ui, ['semaphore', 'http'])).toEqual([
      ['semaphore', true],
      ['http', false],
    ])
    await ui.unmount()
  }
})

test('a lookup re-ranks a reply already drawn', async ($, on) => {
  await lookupWorld($, on, NO_ANSWER)
  await $.command.run({ command: 'jargon', args: 'level beginner' } as never)

  for (const surface of SURFACES) {
    const ui = await mountReply($, CROWD, `rerank-${surface}`, surface)
    if (surface === 'terminal') {
      expect(await chipsOf(ui, ['http'])).toEqual([['http', false]])
      await $.command.run({ command: 'jargon', args: 'HTTP' } as never)
    }
    expect(await chipsOf(ui, ['http'])).toEqual([['http', true]])
    await ui.unmount()
  }
})

test('the level picks which bundled terms show; looked-up terms always do', async ($, on) => {
  const w = await lookupWorld($, on, NO_ANSWER, {
    glossary: {
      semaphore: { term: 'semaphore', kind: 'noun', definition: 'A counter of free slots.' },
      flux: { term: 'flux', kind: 'noun', definition: 'Picked by 0.1.x, never looked up.' },
    },
  })
  await $.command.run({ command: 'jargon', args: 'semaphore' } as never)
  expect(w.asked).toEqual([])

  const level = await $.command.run({ command: 'jargon', args: 'level' } as never)
  expect(level.text).toContain('Level: intermediate.')
  const wrong = await $.command.run({ command: 'jargon', args: 'level expert' } as never)
  expect(wrong.text).toBe('No level "expert". Levels: beginner, intermediate, advanced.')

  const shown = {
    beginner: ['api', 'webhook', 'idempotent', 'semaphore'],
    intermediate: ['webhook', 'idempotent', 'semaphore'],
    advanced: ['idempotent', 'semaphore'],
  } as const
  const text = 'Call the API from the webhook, keep it idempotent, and guard the flux with a semaphore.'
  const slugs = ['api', 'webhook', 'idempotent', 'semaphore', 'flux']

  for (const surface of SURFACES) {
    const ui = await mountReply($, text, `level-${surface}`, surface)
    for (const name of LEVELS) {
      const out = await $.command.run({ command: 'jargon', args: `level ${name}` } as never)
      expect(out.text).toContain(`Level: ${name}.`)
      expect(await chipsOf(ui, slugs)).toEqual(
        slugs.map(s => [s, (shown[name] as readonly string[]).includes(s)] as const),
      )
    }
    await ui.unmount()
  }
})

test('the chosen level is kept across sessions', async ($, on) => {
  const store: Record<string, unknown> = { level: 'advanced' }
  on('store.get', ($, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store[key] = value
    return { value: undefined } as never
  })
  mock.env(on, { HOME: '/tmp/jargon-test' })
  on('fs.exists', () => ({ value: false }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const out = await $.command.run({ command: 'jargon', args: 'level' } as never)
  expect(out.text).toContain('Level: advanced.')

  await $.command.run({ command: 'jargon', args: 'level beginner' } as never)
  expect(store.level).toBe('beginner')
})

const CACHE_PATH = '/tmp/jargon-test/.claude/jargon/cache.json'
const NO_ANSWER = () => ({ isAnswered: false, reason: 'api-error', status: 500 })
const answering = (definition: string) => () => ({
  isAnswered: true,
  text: JSON.stringify([{ term: 'Something else', kind: 'noun', definition, context: '' }]),
  usage: { inputTokens: 1, outputTokens: 1 },
})
const CROWD =
  'Commit the diff to the repo, open a PR, and let CI run the npm lint step; ' +
  'the API returns JSON over HTTP, and a semaphore caps the workers.'

function chipsOf(ui: { find: (q: never) => Promise<unknown> }, slugs: readonly string[]) {
  return Promise.all(
    slugs.map(async s => [s, (await ui.find({ type: 'Button', key: `chip-${s}` } as never)) !== undefined] as const),
  )
}

async function mountReply($: Engine, text: string, requestId: string, surface: Surface = 'terminal') {
  return $.ui.mount({
    plugin: 'jargon',
    surface,
    component: 'AssistantMessage',
    requestId,
    viewport: { columns: 100, rows: 40 },
    props: { text, isFirstOfReply: true },
  })
}

async function mountBand($: Engine, surface: Surface) {
  return $.ui.mount({
    plugin: 'jargon',
    surface,
    component: 'AbovePrompt',
    requestId: `band-${surface}`,
    viewport: { columns: 100, rows: 40 },
    props: BAND_PROPS,
  })
}

function lastFile(w: { writes: { path: string; text: string }[] }) {
  return JSON.parse(w.writes.filter(x => x.path === CACHE_PATH).at(-1)?.text ?? '{}')
}

test('a 0.1.x cache: built-in picks leave the file; other picks wait for a lookup', async ($, on) => {
  const old = {
    version: 1,
    glossary: {
      api: { term: 'API', kind: 'noun', definition: 'An old definition.' },
      flux: { term: 'flux', kind: 'noun', definition: 'A steady flow of change.' },
    },
    seen: ['api', 'flux'],
    asked: 3,
    skipped: 9,
  }
  const w = await lookupWorld($, on, NO_ANSWER, { cache: old })
  for (const surface of SURFACES) {
    const ui = await mountReply($, 'Call the API and watch the flux.', 'old', surface)
    expect(await chipsOf(ui, ['api', 'flux'])).toEqual([
      ['api', false],
      ['flux', false],
    ])
    await ui.unmount()
  }

  // Its saved definition answers the lookup for free, and from then on it shows.
  expect((await $.command.run({ command: 'jargon', args: 'flux' } as never)).text).toBe('Pinned flux.')
  for (const surface of SURFACES) {
    const ui = await mountReply($, 'Watch the flux again.', 'again', surface)
    expect(await chipsOf(ui, ['flux'])).toEqual([['flux', true]])
    await ui.unmount()
  }
  const file = lastFile(w)
  expect(Object.keys(file.glossary)).toEqual(['flux'])
  expect(file.lookedUp).toEqual(['flux'])
  expect(file.asked).toBe(3)
  expect(w.asked).toEqual([])
})

test('a reload over a 0.1.x module cleans its built-in picks from the atoms too', async ($, on) => {
  const old = { api: { term: 'API', kind: 'noun', definition: 'An old definition.' } }
  // The atoms a 0.1.x module left behind: its first glossary read answers with them.
  let leftOver = true
  on('state.get', ($, e, next) => {
    const at = e as { plugin: string; key: string }
    if (leftOver && at.plugin === 'jargon' && at.key === 'glossary') {
      leftOver = false
      return { value: { value: old, version: 0 } } as never
    }
    return next(e)
  })
  await lookupWorld($, on, NO_ANSWER)
  expect(leftOver).toBe(false)
  const list = await $.command.run({ command: 'jargon', args: '' } as never)
  expect(list.text).not.toContain('old definition')
  await $.command.run({ command: 'jargon', args: 'level advanced' } as never)
  for (const surface of SURFACES) {
    const ui = await mountReply($, 'Call the API.', `reload-${surface}`, surface)
    expect(await chipsOf(ui, ['api'])).toEqual([['api', false]])
    await ui.unmount()
  }

  await $.command.run({ command: 'jargon', args: 'API' } as never)
  for (const surface of SURFACES) {
    const band = await mountBand($, surface)
    expect(await band.find({ type: 'Text', text: /one program to ask another/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /old definition/ })).toBeUndefined()
    await band.unmount()
  }
})

test('a built-in term looked up highlights at any level', async ($, on) => {
  const w = await lookupWorld($, on, NO_ANSWER)
  await $.command.run({ command: 'jargon', args: 'level advanced' } as never)
  for (const surface of SURFACES) {
    const before = await mountReply($, 'Call the API.', `before-${surface}`, surface)
    expect(await chipsOf(before, ['api'])).toEqual([['api', false]])
    await before.unmount()
  }

  const out = await $.command.run({ command: 'jargon', args: 'API' } as never)
  expect(out.text).toBe('Pinned API.')
  for (const surface of SURFACES) {
    const after = await mountReply($, 'Call the API again.', `after-${surface}`, surface)
    expect(await chipsOf(after, ['api'])).toEqual([['api', true]])
    await after.unmount()
  }

  const file = lastFile(w)
  expect(file.lookedUp).toEqual(['api'])
  expect(file.glossary).toEqual({})
  expect(w.asked).toEqual([])
})

test('Haiku naming the term differently still defines what was asked', async ($, on) => {
  const w = await lookupWorld($, on, answering('Runs containers across many machines.'))
  const out = await $.command.run({ command: 'jargon', args: 'k8s' } as never)
  expect(out.text).toBe('Defined k8s.')
  expect(w.asked.map(a => a.prompt)).toEqual(['Define: k8s'])

  for (const surface of SURFACES) {
    const band = await mountBand($, surface)
    expect(await band.find({ type: 'Text', text: /across many machines/ })).toBeDefined()
    await band.unmount()

    const ui = await mountReply($, 'Deploy it to k8s tonight.', 'k8s', surface)
    expect(await chipsOf(ui, ['k8s'])).toEqual([['k8s', true]])
    await ui.unmount()
  }
})

test('a term is taken without its quotes or backticks, and not past 60 characters', async ($, on) => {
  const w = await lookupWorld($, on, answering('Runs code after the component draws.'))
  const out = await $.command.run({ command: 'jargon', args: '`useEffect`' } as never)
  expect(out.text).toBe('Defined useEffect.')
  expect(w.asked.map(a => a.prompt)).toEqual(['Define: useEffect'])
  for (const surface of SURFACES) {
    const ui = await mountReply($, 'Call useEffect after the first render.', 'hook', surface)
    expect(await chipsOf(ui, ['useeffect'])).toEqual([['useeffect', true]])
    await ui.unmount()
  }

  const long = await $.command.run({ command: 'jargon', args: 'x'.repeat(61) } as never)
  expect(long.text).toBe("That's longer than a term: 60 characters at most.")
  expect(w.asked.length).toBe(1)
})

test('/jargon level <one word> is the setting; a longer phrase is a term', async ($, on) => {
  const w = await lookupWorld($, on, answering('An extra step between a name and what it points to.'))
  await $.command.run({ command: 'jargon', args: 'level advanced' } as never)
  await $.command.run({ command: 'jargon', args: 'level advnced' } as never)
  expect(w.asked).toEqual([])

  const out = await $.command.run({ command: 'jargon', args: 'level of indirection' } as never)
  expect(out.text).toBe('Defined level of indirection.')
  expect(w.asked.length).toBe(1)
})

test('a lookup takes context from the newest reply, not the last one redrawn', async ($, on) => {
  const w = await lookupWorld($, on, answering('A placeholder name.'))
  const older = 'The foo handler runs first.'
  const newer = 'Then the foo cache warms up.'
  for (const [text, id] of [[older, 'a'], [newer, 'b'], [older, 'a']] as const) {
    const ui = await mountReply($, text, id)
    await ui.unmount()
  }
  await $.command.run({ command: 'jargon', args: 'foo' } as never)
  expect(w.asked[0]?.prompt).toContain(newer)
  expect(w.asked[0]?.prompt).not.toContain(older)
})

test('a reply that left the recent list stays out when redrawn', async ($, on) => {
  const w = await lookupWorld($, on, answering('A placeholder name.'))
  const ids = ['r0', ...Array.from({ length: 20 }, (_, i) => `r${i + 1}`), 'r0']
  for (const id of ids) {
    const ui = await mountReply($, id === 'r0' ? 'The old foo path.' : `Filler reply ${id}.`, id)
    await ui.unmount()
  }
  await $.command.run({ command: 'jargon', args: 'foo' } as never)
  expect(w.asked.map(a => a.prompt)).toEqual(['Define: foo'])
})

test('a long reply goes to Haiku as an excerpt around the term', async ($, on) => {
  const w = await lookupWorld($, on, answering('A placeholder name.'))
  const long = 'Lorem ipsum dolor sit amet. '.repeat(200) + 'Here the zork takes over. ' + 'More text. '.repeat(200)
  const ui = await mountReply($, long, 'long')
  await ui.unmount()
  await $.command.run({ command: 'jargon', args: 'zork' } as never)
  const prompt = w.asked[0]?.prompt ?? ''
  expect(prompt).toContain('Here the zork takes over.')
  expect(prompt.length).toBeLessThan(1400)
})

test('with highlights off a lookup answers in text and pins nothing', async ($, on) => {
  await lookupWorld($, on, NO_ANSWER)
  await $.command.run({ command: 'jargon', args: 'off' } as never)
  const out = await $.command.run({ command: 'jargon', args: 'mutex' } as never)
  expect(out.text).toBe('**mutex**: A lock that lets only one task touch something at a time.')

  for (const surface of SURFACES) {
    const band = await mountBand($, surface)
    expect(await band.find({ type: 'Text', text: /engine's own/ })).toBeDefined()
    await band.unmount()
  }
})

test('a term used only in code gets no chip', async ($, on) => {
  await lookupWorld($, on, NO_ANSWER, {
    cache: {
      version: 1,
      glossary: { freenav: { term: 'freeNav', kind: 'k', definition: 'made up' } },
      lookedUp: ['freenav'],
      asked: 0,
    },
  })
  for (const surface of SURFACES) {
    const ui = await mountReply($, 'Call `freeNav` after the `mutex` is released; a mutex guards it.', 'code', surface)
    expect(await chipsOf(ui, ['mutex', 'freenav'])).toEqual([
      ['mutex', true],
      ['freenav', false],
    ])
    await ui.unmount()

    const inCode = await mountReply($, 'Only `mutex` and `freeNav` here.', 'code-only', surface)
    expect(await chipsOf(inCode, ['mutex', 'freenav'])).toEqual([
      ['mutex', false],
      ['freenav', false],
    ])
    await inCode.unmount()

    const inProse = await mountReply($, 'Then freeNav runs.', 'prose', surface)
    expect(await chipsOf(inProse, ['freenav'])).toEqual([['freenav', true]])
    await inProse.unmount()
  }
})

test("a save keeps another session's lookups, and takes them in", async ($, on) => {
  mock.store(on)
  mock.env(on, { HOME: '/tmp/jargon-test' })
  const files = new Map<string, string>()
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('model.complete', () => ({ value: answering('A counter of free slots.')() }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  // Another session saves its own lookups after this one started.
  files.set(
    CACHE_PATH,
    JSON.stringify({
      version: 1,
      glossary: { k8s: { term: 'k8s', kind: 'k', definition: 'Runs containers.' } },
      lookedUp: ['k8s', 'api', 'gone'],
      asked: 4,
    }),
  )

  expect((await $.command.run({ command: 'jargon', args: 'semaphore' } as never)).text).toBe('Defined semaphore.')
  const file = JSON.parse(files.get(CACHE_PATH) ?? '{}')
  expect(Object.keys(file.glossary)).toEqual(['k8s', 'semaphore'])
  expect(file.lookedUp).toEqual(['k8s', 'api', 'semaphore'])
  expect(file.asked).toBe(5)

  // Taken in here too: the other session's lookups highlight in this one.
  await $.command.run({ command: 'jargon', args: 'level advanced' } as never)
  for (const surface of SURFACES) {
    const ui = await mountReply($, 'Ship it to k8s through the API.', 'merged', surface)
    expect(await chipsOf(ui, ['k8s', 'api'])).toEqual([
      ['k8s', true],
      ['api', true],
    ])
    await ui.unmount()
  }
})
