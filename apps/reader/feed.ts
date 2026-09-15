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

// Atom text constructs carry a `type` attribute and their text in the same element. A leaf reads
// only the text, so they are child collections here and read through `atomText`.
const atomText = [{ type: 'string' }] as const

const atomEntry = {
  title: atomText,
  id: '<string>',
  published: '<string>',
  updated: '<string>',
  summary: atomText,
  content: atomText,
  link: [{ href: 'string', rel: 'string' }],
  author: [{ name: '<string>' }],
  read: 'boolean',
  starred: 'boolean',
} as const

const atomSchema = {
  title: atomText,
  link: [{ href: 'string', rel: 'string' }],
  author: [{ name: '<string>' }],
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

// Text of HTML markup, never inserted as HTML. Script and style contents are not text.
function htmlText(markup: string): string {
  const html = new DOMParser().parseFromString(markup, 'text/html')
  for (const element of html.querySelectorAll('script, style, noscript, template')) element.remove()
  return (html.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// An Atom text construct: `type="html"` holds escaped markup, `xhtml` inline elements, and `text`
// (the default) plain text.
function atomTextOf(element: Element | undefined): string {
  if (!element) return ''
  const type = element.getAttribute('type')
  if (type === 'html') return htmlText(element.textContent ?? '')
  const copy = element.cloneNode(true) as Element
  if (type === 'xhtml') {
    for (const inert of copy.querySelectorAll('script, style')) inert.remove()
  }
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// RFC 4287 4.2.7.2: a link without `rel` is `alternate`. An attribute absent from a `'string'`
// field reads as `''`.
function alternateLink(links: readonly { href: string; rel: string }[]): string {
  return links.find((link) => link.rel === '' || link.rel === 'alternate')?.href ?? ''
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
// Keys are per feed: a guid only has to be unique within its feed, and an entry may have none.
// Without an id, the key is built from what identifies the entry to a reader; whitespace in the
// feed's markup is not part of it.
function keyOf(feed: Feed, id: string, ...fallback: string[]): string {
  const clean = (text: string): string => text.replace(/\s+/g, ' ').trim()
  return `${feed.url} ${clean(id) || fallback.map(clean).join('|')}`
}

function rssEntry(feed: Feed, item: RssItem): Entry {
  return {
    element: item.$el,
    feed,
    get key() {
      return keyOf(
        feed,
        item.guid.trim() || item.link.trim(),
        item.title,
        item.pubDate,
        item.description.slice(0, 500),
      )
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
      return htmlText(item.description)
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

function atomEntryOf(feed: Feed, entry: AtomEntry, feedAuthor: () => string): Entry {
  return {
    element: entry.$el,
    feed,
    get key() {
      return keyOf(
        feed,
        entry.id.trim() || alternateLink(entry.link.get()),
        this.title,
        entry.published || entry.updated,
        this.summary.slice(0, 500),
      )
    },
    get title() {
      return atomTextOf(entry.title[0]?.$el)
    },
    get link() {
      return alternateLink(entry.link.get())
    },
    get author() {
      return entry.author[0]?.name || feedAuthor()
    },
    get date() {
      return Date.parse(entry.published || entry.updated)
    },
    get summary() {
      return atomTextOf(entry.summary[0]?.$el) || atomTextOf(entry.content[0]?.$el)
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
      title: atomTextOf(atom.title[0]?.$el),
      site: alternateLink(atom.link.get()),
      entries: entryList<AtomEntry>(atom.entry, (entry) =>
        atomEntryOf(feed, entry, () => atom.author[0]?.name ?? ''),
      ),
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

/**
 * Decodes feed bytes: a byte order mark wins, then the charset the response names, then the one
 * the XML declaration names, then UTF-8.
 *
 * `Response.text()` always decodes UTF-8, which garbles feeds in other encodings.
 */
export function decodeFeed(bytes: ArrayBuffer, contentType: string | null): string {
  const head = new Uint8Array(bytes.slice(0, 3))
  const bom =
    head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf
      ? 'utf-8'
      : head[0] === 0xff && head[1] === 0xfe
        ? 'utf-16le'
        : head[0] === 0xfe && head[1] === 0xff
          ? 'utf-16be'
          : undefined
  const declared =
    bom ??
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ??
    /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/.exec(
      new TextDecoder('latin1').decode(bytes.slice(0, 200)),
    )?.[1] ??
    'utf-8'
  try {
    return new TextDecoder(declared).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}
