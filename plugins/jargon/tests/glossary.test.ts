import { describe, expect, test } from 'claude-code/testing'

import { emptyCache } from '../hooks/cache'
import type { CacheFile } from '../hooks/cache'
import { MAX_GLOSSARY, liveLookups, merge, withoutBundled } from '../hooks/glossary'

function entry(term: string) {
  return { term, kind: 'k', definition: `about ${term}` }
}

function glossaryOf(...terms: string[]) {
  return Object.fromEntries(terms.map(t => [t.toLowerCase(), entry(t)]))
}

describe('glossary', () => {
  test('built-in terms are never saved', async () => {
    expect(Object.keys(withoutBundled(glossaryOf('mutex', 'semaphore', 'API')))).toEqual(['semaphore'])
  })

  test('a save keeps what another session wrote since', async () => {
    const disk: CacheFile = {
      ...emptyCache(),
      glossary: glossaryOf('semaphore', 'k8s', 'mutex'),
      lookedUp: ['semaphore', 'api', 'gone'],
      asked: 5,
    }
    const file = merge(disk, {
      glossary: { ...glossaryOf('semaphore', 'flux'), semaphore: { ...entry('semaphore'), definition: 'mine' } },
      lookedUp: ['flux', 'api'],
      asked: 1,
    })
    expect(Object.keys(file.glossary)).toEqual(['semaphore', 'k8s', 'flux'])
    expect(file.glossary.semaphore?.definition).toBe('mine')
    expect(file.lookedUp).toEqual(['semaphore', 'api', 'flux'])
    expect(file.asked).toBe(6)
  })

  test('a lookup goes with the definition it named', async () => {
    expect(liveLookups(['flux', 'api', 'gone', 'flux'], glossaryOf('flux'))).toEqual(['flux', 'api'])
    const many = Array.from({ length: MAX_GLOSSARY + 1 }, (_, i) => `zterm${i}`)
    const file = merge(null, { glossary: glossaryOf(...many), lookedUp: ['zterm0', 'zterm1'], asked: 0 })
    expect(file.lookedUp).toEqual(['zterm1'])
  })

  test('with no file, a save is this session alone', async () => {
    const file = merge(null, { glossary: glossaryOf('flux'), lookedUp: ['flux', 'flux'], asked: 1 })
    expect(file).toEqual({ ...emptyCache(), glossary: glossaryOf('flux'), lookedUp: ['flux'], asked: 1 })
  })

  test('the glossary keeps its newest entries under the cap', async () => {
    const many = Array.from({ length: MAX_GLOSSARY + 2 }, (_, i) => `zterm${i}`)
    const file = merge(null, { glossary: glossaryOf(...many), lookedUp: [], asked: 0 })
    expect(Object.keys(file.glossary)).toHaveLength(MAX_GLOSSARY)
    expect(Object.keys(file.glossary)[0]).toBe('zterm2')
  })
})
