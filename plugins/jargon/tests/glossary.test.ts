import { describe, expect, test } from 'claude-code/testing'

import { emptyCache } from '../hooks/cache'
import type { CacheFile } from '../hooks/cache'
import { admit, keepJargon, merge } from '../hooks/glossary'
import type { Extracted } from '../hooks/text'

function entry(term: string) {
  return { term, kind: 'k', definition: `about ${term}` }
}

function glossaryOf(...terms: string[]) {
  return Object.fromEntries(terms.map(t => [t.toLowerCase(), entry(t)]))
}

function found(term: string): Extracted {
  return { slug: term.toLowerCase(), ...entry(term), context: `${term} here` }
}

describe('glossary', () => {
  test('saved terms that are not jargon are dropped', async () => {
    const { glossary, dropped } = keepJargon(glossaryOf('tests', 'mutex', '7f6652c', 'CORS'))
    expect(Object.keys(glossary)).toEqual(['mutex', 'cors'])
    expect(dropped).toBe(2)
  })

  test('an answer adds its jargon and notes, and nothing else', async () => {
    const out = admit(glossaryOf('DNS'), {}, [found('pass'), found('mutex')], 'a mutex')
    expect(Object.keys(out.glossary)).toEqual(['dns', 'mutex'])
    expect(Object.values(out.notes)).toEqual([{ mutex: 'mutex here' }])

    const none = admit(glossaryOf('DNS'), {}, [found('pass')], 'pass')
    expect(Object.keys(none.glossary)).toEqual(['dns'])
    expect(none.notes).toEqual({})
  })

  test('a save keeps what another session wrote since', async () => {
    const disk: CacheFile = {
      ...emptyCache(),
      glossary: glossaryOf('DNS', 'CORS', 'tests'),
      seen: ['dns', 'cors'],
      asked: 5,
      skipped: 1,
    }
    const file = merge(disk, {
      glossary: { ...glossaryOf('DNS', 'mutex'), dns: { ...entry('DNS'), definition: 'mine' } },
      seen: ['dns', 'mutex'],
      counts: { asked: 1, skipped: 2 },
    })
    expect(Object.keys(file.glossary)).toEqual(['dns', 'cors', 'mutex'])
    expect(file.glossary.dns?.definition).toBe('mine')
    expect(file.seen).toEqual(['dns', 'cors', 'mutex'])
    expect([file.asked, file.skipped]).toEqual([6, 3])
  })

  test('with no file, a save is this session alone', async () => {
    const file = merge(null, { glossary: glossaryOf('mutex'), seen: ['a', 'a'], counts: { asked: 1, skipped: 0 } })
    expect(file).toEqual({ ...emptyCache(), glossary: glossaryOf('mutex'), seen: ['a'], asked: 1, skipped: 0 })
  })
})
