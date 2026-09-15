import { computed, wrap } from '../../src/index'
import type { ReadableAtom, Wrapped } from '../../src/index'

// The feed XML document is the model. e5x wraps it directly; the reader adds two attributes to
// each entry, `read` and `starred`, so reading state lives in the same tree as the data.

const rssItem = {
  title: '<string>',
  link: '<string>',
  guid: '<string>',
  pubDate: '<string>',
  // `dc:creator`: fields match by local name, whatever the prefix.
  creator: '<string>',
  description: '<string>',
  read: 'boolean',
  starred: 'boolean',
} as const

const rssSchema = {
  channel: [{ title: '<string>', item: [rssItem] }],
} as const

const atomEntry = {
  title: '<string>',
  id: '<string>',
  published: '<string>',
  updated: '<string>',
  summary: '<string>',
  link: [{ href: 'string', rel: 'string' }],
  author: [{ name: '<string>' }],
  read: 'boolean',
  starred: 'boolean',
} as const

const atomSchema = {
  title: '<string>',
  link: [{ href: 'string', rel: 'string' }],
  entry: [atomEntry],
} as const

type RssItem = Wrapped<typeof rssItem>
type AtomEntry = Wrapped<typeof atomEntry>

/** One entry of either format, read through getters so the XML stays the only copy. */
export interface Entry {
  readonly element: Element
  readonly feed: Feed
  readonly key: string
  readonly title: string
  readonly link: string
  readonly author: string
  readonly date: number
  readonly summary: string
  read: boolean
  starred: boolean
}

/** A parsed feed: its title, site link, and entries as a live list. */
export interface Feed {
  readonly url: string
  readonly kind: 'rss' | 'atom'
  readonly title: string
  readonly site: string
  /** The entries, live: emits when entries are added, removed, or reordered. */
  readonly entries: ReadableAtom<Entry[]>
  /** The number of unread entries, live. */
  readonly unread: ReadableAtom<number>
}

// Text of HTML markup, never inserted as HTML.
function plainText(markup: string): string {
  const html = new DOMParser().parseFromString(markup, 'text/html')
  return (html.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// FRICTION 1: `channel.link` reads the empty `<atom:link>` that comes first, because fields match
// by local name and ignore namespaces. The site link needs the raw element.
function rssSiteLink(channel: Element): string {
  const link = Array.from(channel.children).find(
    (child) => child.localName === 'link' && child.namespaceURI === null,
  )
  return link?.textContent?.trim() ?? ''
}

// FRICTION 2: entries of two formats have different shapes, so each gets an adapter. A schema
// cannot say "title here, or title there".
function rssEntry(feed: Feed, item: RssItem): Entry {
  return {
    element: item.$el,
    feed,
    get key() {
      return item.guid || item.link
    },
    get title() {
      return item.title
    },
    get link() {
      return item.link
    },
    get author() {
      return item.creator
    },
    get date() {
      return Date.parse(item.pubDate)
    },
    get summary() {
      return plainText(item.description)
    },
    get read() {
      return item.read
    },
    set read(value) {
      item.read = value
    },
    get starred() {
      return item.starred
    },
    set starred(value) {
      item.starred = value
    },
  }
}

function atomEntryOf(feed: Feed, entry: AtomEntry): Entry {
  return {
    element: entry.$el,
    feed,
    get key() {
      return entry.id
    },
    get title() {
      return entry.title
    },
    get link() {
      return (entry.link.$where({ rel: 'alternate' })[0] ?? entry.link[0])?.href ?? ''
    },
    get author() {
      return entry.author[0]?.name ?? ''
    },
    get date() {
      return Date.parse(entry.published || entry.updated)
    },
    get summary() {
      return plainText(entry.summary)
    },
    get read() {
      return entry.read
    },
    set read(value) {
      entry.read = value
    },
    get starred() {
      return entry.starred
    },
    set starred(value) {
      entry.starred = value
    },
  }
}

// Wrapped elements are stable per element, so entries can be too: the same element always maps
// to the same Entry, which keeps row identity across re-renders.
function entryList<T extends { $el: Element }>(
  source: ReadableAtom<T[]>,
  adapt: (member: T) => Entry,
): ReadableAtom<Entry[]> {
  const entries = new WeakMap<Element, Entry>()
  const of = (member: T): Entry => {
    let entry = entries.get(member.$el)
    if (!entry) {
      entry = adapt(member)
      entries.set(member.$el, entry)
    }
    return entry
  }
  return computed([source], (members) => members.map(of))
}

/**
 * Parses feed XML into a {@linkcode Feed}.
 *
 * @throws {Error} When the text is not RSS 2.0 or Atom.
 */
export function parseFeed(url: string, text: string): Feed {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const root = doc.documentElement
  if (doc.querySelector('parsererror') || !root) {
    throw new Error(`${url}: not well-formed XML`)
  }

  if (root.localName === 'rss') {
    const rss = wrap(root, rssSchema)
    const channel = rss.channel[0]
    if (!channel) throw new Error(`${url}: RSS without a channel`)
    const feed: Feed = {
      url,
      kind: 'rss',
      title: channel.title,
      site: rssSiteLink(channel.$el),
      entries: entryList<RssItem>(channel.item, (item) => rssEntry(feed, item)),
      unread: channel.item.$where({ read: false }).$length,
    }
    return feed
  }

  if (root.localName === 'feed') {
    const atom = wrap(root, atomSchema)
    const feed: Feed = {
      url,
      kind: 'atom',
      title: atom.title,
      site: (atom.link.$where({ rel: 'alternate' })[0] ?? atom.link[0])?.href ?? '',
      entries: entryList<AtomEntry>(atom.entry, (entry) => atomEntryOf(feed, entry)),
      unread: atom.entry.$where({ read: false }).$length,
    }
    return feed
  }

  throw new Error(`${url}: <${root.localName}> is neither RSS nor Atom`)
}

/** Reading state remembered across sessions, keyed by entry key. */
export interface SavedState {
  read: string[]
  starred: string[]
}

/** Copies saved reading state onto a feed's entries, as `read` / `starred` attributes. */
export function applyState(feed: Feed, saved: SavedState): void {
  const read = new Set(saved.read)
  const starred = new Set(saved.starred)
  for (const entry of feed.entries.get()) {
    entry.read = read.has(entry.key)
    entry.starred = starred.has(entry.key)
  }
}

/** Collects the reading state of every entry in `feeds`, for saving. */
export function collectState(feeds: readonly Feed[]): SavedState {
  const entries = feeds.flatMap((feed) => feed.entries.get())
  return {
    read: entries.filter((entry) => entry.read).map((entry) => entry.key),
    starred: entries.filter((entry) => entry.starred).map((entry) => entry.key),
  }
}
