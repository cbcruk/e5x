/// <reference types="vite-plus/client" />
import { describe, it, expect, beforeEach } from 'vite-plus/test'
import { collectState, decodeFeed, parseFeed } from '../apps/reader/feed'
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
      key: 'rss https://example.com/?p=2001',
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
      read: ['rss https://example.com/?p=2001'],
      starred: ['rss https://example.com/?p=2002'],
    })
  })

  it('keys entries per feed, with a fallback for entries without an id', () => {
    const item = (guid: string, title: string) =>
      `<item><title>${title}</title>${guid ? `<guid>${guid}</guid>` : ''}<pubDate>Mon, 14 Sep 2026 09:30:00 +0000</pubDate></item>`
    const text = (...items: string[]) =>
      `<rss><channel><title>t</title>${items.join('')}</channel></rss>`
    const a = parseFeed('a', text(item('1', 'A1'), item('', 'A-noid')))
    const b = parseFeed('b', text(item('1', 'B1'), item('', 'B-noid')))
    const keys = [...a.entries.get(), ...b.entries.get()].map((entry) => entry.key)

    expect(new Set(keys).size).toBe(4)
    a.entries.get()[0]!.read = true
    expect(collectState([a, b]).read).toEqual(['a 1'])
  })

  it('follows Atom rules for links, text constructs, and authors', () => {
    const feed = parseFeed(
      'atom',
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>f</title><author><name>Feed Author</name></author>
        <entry><id>e1</id><title>one</title><updated>2026-09-14T00:00:00Z</updated>
          <link rel="enclosure" href="https://x.example/a.mp3"/><link href="https://x.example/post"/>
          <summary type="text">&lt;b&gt; is literal</summary></entry>
        <entry><id>e2</id><title>two</title><updated>2026-09-13T00:00:00Z</updated>
          <author><name>Own Author</name></author>
          <content type="html">&lt;p&gt;Body&lt;/p&gt;&lt;script&gt;window.__pwned = 1&lt;/script&gt;</content></entry>
      </feed>`,
    )
    const [one, two] = feed.entries.get()

    expect(one).toMatchObject({
      link: 'https://x.example/post',
      author: 'Feed Author',
      summary: '<b> is literal',
    })
    expect(two).toMatchObject({ author: 'Own Author', summary: 'Body' })
  })

  it('decodes feeds in the charset they declare', () => {
    const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0)).buffer
    const latin1 = bytes(
      '<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><title>caf\u00e9</title></channel></rss>',
    )

    expect(parseFeed('x', decodeFeed(latin1, null)).title).toBe('café')
    expect(parseFeed('x', decodeFeed(latin1, 'text/xml; charset=ISO-8859-1')).title).toBe('café')
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
    expect(JSON.parse(store.get('e5x-reader:state')!).read).toEqual([
      'rss https://example.com/?p=2001',
    ])

    document.body.innerHTML = '<div id="app"></div>'
    await mount(root(), options)
    await flush()
    expect(titles()).not.toContain('Band Announces Tour & New Album')
    expect(root().querySelector('[data-total]')!.textContent).toBe('4 unread')
  })

  it('keeps a read entry in the Unread list until the filter is picked again', async () => {
    await mount(root(), options)
    await flush()
    click('.entry [data-read]')
    await flush()
    expect(titles()).toHaveLength(5)

    click('[data-filter="unread"]')
    await flush()
    expect(titles()).toHaveLength(4)
  })

  it('refreshes without losing state or leaving the old documents live', async () => {
    let text = rss
    const saves: string[] = []
    const reader = await mount(root(), {
      ...options,
      sources: async () => [sources[0]!],
      fetchText: async () => text,
      storage: {
        getItem: storage.getItem,
        setItem: (key, value) => (saves.push(value), storage.setItem(key, value)),
      },
    })
    await flush()
    click('.entry [data-read]') // "Band Announces Tour" (p=2001)
    await flush()
    const oldToggle = root().querySelector<HTMLElement>('.entry:nth-child(2) [data-star]')!

    // The next fetch no longer has p=2001.
    text = rss.replace(/<item>\s*<title>Band Announces[\s\S]*?<\/item>/, '')
    await reader.refresh()
    await flush()
    const savesAfterRefresh = saves.length

    oldToggle.click()
    await flush()
    expect(saves).toHaveLength(savesAfterRefresh)
    expect(root().querySelector('.entry.starred')).toBeNull()

    click('[data-filter="all"]')
    click('.entry [data-star]')
    await flush()
    const state = JSON.parse(store.get('e5x-reader:state')!)
    expect(state.read).toEqual(['rss https://example.com/?p=2001'])
    expect(state.starred).toEqual(['rss https://example.com/?p=2002'])
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
