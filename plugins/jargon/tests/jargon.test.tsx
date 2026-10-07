import { describe, expect, mock, test } from 'claude-code/testing'

import { emptyCache, parseCache } from '../hooks/cache'
import { cardLeft, cellWidth, chipOffsets } from '../hooks/card'
import {
  hash,
  isJargonCandidate,
  linkTerms,
  parseExtraction,
  replyKey,
  slug,
  termMatcher,
  wordsOf,
} from '../hooks/text'

const REPLY =
  'Make the webhook handler idempotent so a retry from Stripe cannot charge twice. ' +
  'Guard the write with a mutex, and keep the key in `.env`:\n\n' +
  '```ts\nconst idempotent = true // not linked\n```\n'

const HAIKU = JSON.stringify([
  {
    term: 'idempotent',
    kind: 'adjective, APIs',
    definition: 'Doing it twice has the same effect as doing it once.',
    context: 'a retried payment request will not charge the card twice.',
  },
  {
    term: 'mutex',
    kind: 'noun, concurrency',
    definition: 'A lock that lets only one task touch something at a time.',
    context: 'stops two writes from landing at once.',
  },
  { term: 'flux capacitor', kind: 'noun', definition: 'Not in the reply.', context: '' },
])

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

  test('parses fenced JSON and drops terms not in the text', async () => {
    const parsed = parseExtraction('```json\n' + HAIKU + '\n```', REPLY)
    expect(parsed?.found.map(f => f.term)).toEqual(['idempotent', 'mutex'])
    expect(parseExtraction('no json here', REPLY)).toBeNull()
    expect(parseExtraction('[{"term": "mutex", "definition": "A lo', REPLY)).toBeNull()
    expect(parseExtraction('[]', REPLY)).toEqual({ found: [], dropped: [] })
  })
})

describe('only technical terms', () => {
  const NOISY =
    'The tests pass and it validates the input; commit 7f6652c touched `src/lib/nav.js`, ' +
    '`freeNav` and `BARS_MEASURED`. A mutex keeps it idempotent; CORS, GraphQL and C++ too, ' +
    'to avoid a race condition.'

  test('everyday words and project names are dropped from what Haiku finds', async () => {
    const terms = ['tests', 'pass', 'validates', 'commit', '7f6652c', 'src/lib/nav.js', 'freeNav',
      'BARS_MEASURED', 'mutex', 'idempotent', 'CORS', 'GraphQL', 'C++', 'race condition']
    const raw = JSON.stringify(terms.map(term => ({ term, kind: 'k', definition: 'd' })))
    expect(parseExtraction(raw, NOISY)?.found.map(f => f.term)).toEqual([
      'mutex', 'idempotent', 'CORS', 'GraphQL', 'C++', 'race condition',
    ])
  })

  test('everyday words are dropped in any inflection', async () => {
    for (const w of ['validate', 'validates', 'validated', 'validating', 'Tests', 'passed', 'Tab', 'hook']) {
      expect(isJargonCandidate(w)).toBe(false)
    }
    for (const w of ['mutex', 'idempotent', 'viewport', 'shim', 'git', 'json']) {
      expect(isJargonCandidate(w)).toBe(true)
    }
  })

  test('acronyms, odd spellings, API names and phrases stay; hashes and paths go', async () => {
    for (const t of ['DNS', 'TCP/IP', 'node.js', 'macOS', 'WebSocket', 'unit test', 'React hook',
      'diffs', 'useEffect', 'localStorage', 'NODE_ENV', 'package.json']) {
      expect(isJargonCandidate(t)).toBe(true)
    }
    for (const t of ['deadbeef1', '7f6652c', './run.sh', 'src/lib/nav.js', 'docs/a/b']) {
      expect(isJargonCandidate(t)).toBe(false)
    }
  })

  test('a name seen only in code is the person\'s own', async () => {
    const text = 'Call `freeNav` from the effect: useEffect runs after each render.'
    const raw = JSON.stringify(['freeNav', 'useEffect'].map(term => ({ term, kind: 'k', definition: 'd' })))
    expect(parseExtraction(raw, text)?.found.map(f => f.term)).toEqual(['useEffect'])
  })

  test('acronyms match only as written', async () => {
    const find = termMatcher([
      ['red', 'RED'],
      ['head', 'HEAD'],
      ['mutex', 'mutex'],
    ])
    expect(find('a red button at the head of the list, behind a Mutex')).toEqual(['mutex'])
    expect(find('Run RED first, then move HEAD.')).toEqual(['red', 'head'])
    expect(linkTerms('a red flag, then RED', ['RED']).text).toBe(
      'a red flag, then [RED ⓘ](https://jargon.invalid/red)',
    )
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

  test('terms past the cap are reported, not lost', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `term${i}`)
    const raw = JSON.stringify(many.map(term => ({ term, kind: 'k', definition: 'd' })))
    const parsed = parseExtraction(raw, many.join(' '))
    expect(parsed?.found).toHaveLength(8)
    expect(parsed?.dropped).toEqual(['term8', 'term9'])
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
  test('words skip code and keep short and tech spellings', async () => {
    const words = wordsOf('Use gRPC and C++ via node.js, not `secretword` or the cat.')
    expect(words).toContain('grpc')
    expect(words).toContain('c++')
    expect(words).toContain('cat')
    expect(words).toContain('node.js')
    expect(words).not.toContain('secretword')
    expect(wordsOf('Run npm over ssh, sign a JWT.')).toEqual(['run', 'npm', 'over', 'ssh', 'sign', 'jwt'])
  })

  test('the file round-trips and a cut-off file reads as null', async () => {
    const file = {
      ...emptyCache(),
      glossary: { mutex: { term: 'mutex', kind: 'noun', definition: 'A lock.' } },
      seen: ['mutex', 'lock'],
      asked: 2,
      skipped: 5,
    }
    expect(parseCache(JSON.stringify(file))).toEqual(file)
    expect(parseCache('{"glossary": {"mutex": {"te')).toBeNull()
    expect(parseCache('{"glossary": {"x": {"term": 1}}, "seen": [1, "a"]}')?.seen).toEqual(['a'])
  })
})

test('a reply is highlighted, a chip pins its card, Dismiss clears it', async ($, on) => {
  mock.store(on, {
    glossary: Object.fromEntries(
      (parseExtraction(HAIKU, REPLY)?.found ?? []).map(f => [
        f.slug,
        { term: f.term, kind: f.kind, definition: f.definition },
      ]),
    ),
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
  const ui = await $.ui.mount({
    plugin: 'jargon',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm2',
    viewport: { columns: 100, rows: 40 },
    props: { text: 'Done. ' + hash('x'), isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Markdown', key: 'reply' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine's own/ })).toBeDefined()
  await ui.unmount()
})

test('on a narrow screen each card opens leftwards to stay on screen', async ($, on) => {
  mock.store(on, {
    glossary: Object.fromEntries(
      (parseExtraction(HAIKU, REPLY)?.found ?? []).map(f => [
        f.slug,
        { term: f.term, kind: f.kind, definition: f.definition },
      ]),
    ),
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
  // Row 38 wide (40 less the bullet); cards 36 wide. idempotent sits at 7, mutex at 19.
  expect(lefts).toEqual([-5, -17])
  await ui.unmount()
})

test('saved terms that are not jargon are dropped at start and never drawn', async ($, on) => {
  const saved = {
    tests: { term: 'tests', kind: 'noun', definition: 'Code that checks code.' },
    mutex: { term: 'mutex', kind: 'noun', definition: 'A lock for one task at a time.' },
  }
  mock.store(on, { glossary: saved })
  mock.env(on, { HOME: '/tmp/jargon-test' })
  const written: string[] = []
  on('fs.exists', () => ({ value: false }))
  on('fs.write', ($, e) => {
    written.push(e.text)

    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'jargon',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm4',
    viewport: { columns: 100, rows: 40 },
    props: { text: 'The tests pass now that a mutex guards the write.', isFirstOfReply: true },
  })
  const md = await ui.find({ type: 'Markdown', key: 'reply' })
  expect(md?.text).toContain('[mutex ⓘ]')
  expect(md?.text).not.toContain('[tests ⓘ]')
  expect(await ui.find({ type: 'Button', key: 'chip-tests' })).toBeUndefined()
  await ui.unmount()

  const file = JSON.parse(written[written.length - 1] ?? '{}')
  expect(Object.keys(file.glossary ?? {})).toEqual(['mutex'])
})

test('a reply goes to Haiku, only its jargon is drawn, and the save keeps another session\'s', async ($, on) => {
  mock.store(on)
  mock.env(on, { HOME: '/tmp/jargon-test' })
  const clock = mock.clock(on)
  const path = '/tmp/jargon-test/.claude/jargon/cache.json'
  const files = new Map<string, string>()
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const asked: string[] = []
  on('model.complete', ($, e) => {
    asked.push(e.prompt ?? '')
    const terms = ['tests', 'pass', 'mutex']

    return {
      value: {
        isAnswered: true,
        text: JSON.stringify(terms.map(term => ({ term, kind: 'k', definition: `about ${term}` }))),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  // Another session saves CORS after this one started.
  files.set(path, JSON.stringify({
    version: 1,
    glossary: { cors: { term: 'CORS', kind: 'k', definition: 'about CORS' } },
    seen: ['cors'],
    asked: 4,
    skipped: 0,
  }))

  const text = 'The tests pass now that a mutex guards the write, so two saves never land at once.'
  await $.session.append({
    message: { type: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'test' },
    uuid: 'u1',
  })
  await clock.settle()
  expect(asked).toHaveLength(1)

  const ui = await $.ui.mount({
    plugin: 'jargon',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm5',
    viewport: { columns: 100, rows: 40 },
    props: { text, isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Button', key: 'chip-mutex' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'chip-tests' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'chip-pass' })).toBeUndefined()
  await ui.unmount()

  const file = JSON.parse(files.get(path) ?? '{}')
  expect(Object.keys(file.glossary)).toEqual(['cors', 'mutex'])
  expect(file.asked).toBe(5)
})

test('a saved name that appears only in code gets no chip', async ($, on) => {
  mock.store(on, {
    glossary: {
      freenav: { term: 'freeNav', kind: 'k', definition: 'made up' },
      mutex: { term: 'mutex', kind: 'k', definition: 'A lock for one task at a time.' },
    },
  })
  mock.env(on, { HOME: '/tmp/jargon-test' })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'jargon',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm6',
    viewport: { columns: 100, rows: 40 },
    props: { text: 'Call `freeNav` after the mutex is released.', isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Button', key: 'chip-mutex' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'chip-freenav' })).toBeUndefined()
  await ui.unmount()
})
