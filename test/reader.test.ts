/// <reference types="vite-plus/client" />
import { describe, it, expect, beforeEach } from 'vite-plus/test'
import { collectState, parseFeed } from '../apps/reader/feed'
import { mount } from '../apps/reader/main'
import type { Source } from '../apps/reader/main'
import rss from '../apps/reader/public/samples/rss.xml?raw'
import atom from '../apps/reader/public/samples/atom.xml?raw'

// Chromium only: happy-dom's XML parser drops namespaced elements and CDATA text, which every
// real feed has, so under happy-dom this would test happy-dom.

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('parseFeed', () => {
  it('reads RSS 2.0 with namespaces, CDATA, and atom:link', () => {
    const feed = parseFeed('rss', rss)
    const entries = feed.entries.get()

    expect([feed.kind, feed.title, feed.site]).toEqual([
      'rss',
      'Sample Music Blog',
      'https://example.com/',
    ])
    expect(entries.map((entry) => entry.title)).toEqual([
      'Band Announces Tour & New Album',
      'Premiere: Quiet Song',
      'Album Of The Week',
    ])
    expect(entries[0]).toMatchObject({
      key: 'https://example.com/?p=2001',
      author: 'Alex Writer',
      summary: 'The band will play twelve cities this fall.',
      read: false,
      starred: false,
    })
    expect(entries[0]!.date).toBe(Date.parse('Tue, 15 Sep 2026 02:40:00 +0000'))
  })

  it('reads Atom with alternate links and nested authors', () => {
    const feed = parseFeed('atom', atom)
    const [first, second] = feed.entries.get()

    expect([feed.kind, feed.title, feed.site]).toEqual([
      'atom',
      'Sample Dev Notes',
      'https://notes.example.org/',
    ])
    expect(first).toMatchObject({
      link: 'https://notes.example.org/observing-detached-trees',
      author: 'Robin Dev',
      date: Date.parse('2026-09-15T00:30:00Z'),
    })
    expect(second!.summary).toBe('Measure what the app ships.')
  })

  it('keeps reading state on the XML elements and counts unread live', async () => {
    const feed = parseFeed('rss', rss)
    const counts: number[] = []
    feed.unread.subscribe((n) => counts.push(n))
    const [first, second] = feed.entries.get()

    first!.read = true
    await flush()
    second!.starred = true
    await flush()

    expect(first!.element.getAttribute('read')).toBe('true')
    expect(counts).toEqual([3, 2])
    expect(collectState([feed])).toEqual({
      read: ['https://example.com/?p=2001'],
      starred: ['https://example.com/?p=2002'],
    })
  })

  it('rejects documents that are not feeds', () => {
    expect(() => parseFeed('html', '<html><body/></html>')).toThrow(/neither RSS nor Atom/)
    expect(() => parseFeed('broken', '<rss><channel>')).toThrow(/not well-formed/)
  })
})

describe('the reader UI', () => {
  let store: Map<string, string>
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
  const sources: Source[] = [
    { url: 'rss', fetchUrl: 'rss' },
    { url: 'atom', fetchUrl: 'atom' },
  ]
  const options = {
    sources: async () => sources,
    fetchText: async (source: Source) => (source.url === 'rss' ? rss : atom),
    storage,
  }

  beforeEach(() => {
    store = new Map()
    document.body.innerHTML = '<div id="app"></div>'
  })

  const root = (): HTMLElement => document.getElementById('app')!
  const titles = (): string[] =>
    Array.from(root().querySelectorAll('.entry .title'), (a) => a.textContent ?? '')
  const click = (selector: string): void => root().querySelector<HTMLElement>(selector)!.click()

  it('lists unread entries of every feed, newest first', async () => {
    await mount(root(), options)
    await flush()

    expect(titles()).toEqual([
      'Band Announces Tour & New Album',
      'Observing Detached Trees',
      'Premiere: Quiet Song',
      'Bundle Budgets',
      'Album Of The Week',
    ])
    expect(root().querySelector('[data-total]')!.textContent).toBe('5 unread')
  })

  it('marks entries read, persists the state, and restores it on the next load', async () => {
    await mount(root(), options)
    await flush()
    click('.entry [data-read]')
    await flush()

    expect(root().querySelector('[data-total]')!.textContent).toBe('4 unread')
    expect(root().querySelector('.entry')!.classList.contains('read')).toBe(true)
    expect(JSON.parse(store.get('e5x-reader:state')!).read).toEqual(['https://example.com/?p=2001'])

    document.body.innerHTML = '<div id="app"></div>'
    await mount(root(), options)
    await flush()
    expect(titles()).not.toContain('Band Announces Tour & New Album')
    expect(root().querySelector('[data-total]')!.textContent).toBe('4 unread')
  })

  it('filters by starred and by feed', async () => {
    await mount(root(), options)
    await flush()
    click('.entry:nth-child(2) [data-star]')
    click('[data-filter="starred"]')
    await flush()
    expect(titles()).toEqual(['Observing Detached Trees'])

    click('[data-filter="all"]')
    click('[data-feed="atom"]')
    await flush()
    expect(titles()).toEqual(['Observing Detached Trees', 'Bundle Budgets'])
  })

  it('reports feeds that fail to load and shows the rest', async () => {
    await mount(root(), {
      ...options,
      fetchText: async (source: Source) => {
        if (source.url === 'atom') throw new Error('atom: 502')
        return rss
      },
    })
    await flush()

    expect(titles()).toHaveLength(3)
    expect(root().querySelector('[data-status]')!.textContent).toContain('atom: 502')
  })

  it('does not make non-http links clickable', async () => {
    const hostile = rss.replace(
      'https://example.com/2002/premiere-quiet-song/music/',
      'javascript:alert(1)',
    )
    await mount(root(), {
      ...options,
      fetchText: async () => hostile,
      sources: async () => [sources[0]!],
    })
    await flush()

    const link = Array.from(root().querySelectorAll<HTMLAnchorElement>('.entry .title')).find(
      (a) => a.textContent === 'Premiere: Quiet Song',
    )!
    expect(link.hasAttribute('href')).toBe(false)
  })
})
