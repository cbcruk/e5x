import { computed, wrap } from '../../src/index'
import type { ReadableAtom } from '../../src/index'
import { applyState, collectState, parseFeed } from './feed'
import type { Entry, Feed, SavedState } from './feed'

/** Where a feed's XML comes from: the subscribed URL, and the URL the browser fetches it through. */
export interface Source {
  readonly url: string
  readonly fetchUrl: string
}

/** What the reader needs from its environment, so tests can supply fakes. */
export interface ReaderOptions {
  sources(): Promise<Source[]>
  fetchText(source: Source): Promise<string>
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

const STORAGE_KEY = 'e5x-reader:state'

const shell = `
  <header class="bar">
    <h1>Reader</h1>
    <span class="unread-total" data-total></span>
    <nav class="filters" role="tablist">
      <button data-filter="unread">Unread</button>
      <button data-filter="all">All</button>
      <button data-filter="starred">Starred</button>
    </nav>
    <button data-action="read-all">Mark all read</button>
    <button data-action="refresh">Refresh</button>
  </header>
  <div class="layout">
    <aside><ul class="feeds" data-feeds></ul></aside>
    <main><p class="status" data-status></p><ol class="entries" data-entries></ol></main>
  </div>
  <view filter="unread" feed="" hidden></view>
`

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`reader: missing ${selector}`)
  return element
}

// Unsubscribe functions for one render of the feeds; cleared on refresh.
function scope() {
  let stops: (() => void)[] = []
  return {
    add: (stop: () => void) => void stops.push(stop),
    reset: () => {
      for (const stop of stops) stop()
      stops = []
    },
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Feed links are untrusted: only http(s) URLs become clickable.
function safeHref(link: string): string | null {
  try {
    const url = new URL(link)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** Renders the reader into `root` and loads the feeds; resolves once the first load is done. */
export async function mount(
  root: HTMLElement,
  options: ReaderOptions,
): Promise<{ refresh(): Promise<void> }> {
  root.innerHTML = shell
  const storage = options.storage ?? localStorage
  // UI state lives in the DOM too, so views can take it as deps (see the sales demo).
  const view = wrap(required(root, 'view'), { filter: 'string', feed: 'string' } as const)
  const feedList = required(root, '[data-feeds]')
  const entryList = required(root, '[data-entries]')
  const status = required(root, '[data-status]')
  const total = required(root, '[data-total]')
  // Subscriptions of one load of the feeds, and of the rows currently on screen.
  const bound = scope()
  const rows = scope()
  let feeds: Feed[] = []

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
    button.addEventListener('click', () => (view.filter = button.dataset.filter!))
  }
  view.$.filter.subscribe((filter) => {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
      button.setAttribute('aria-selected', String(button.dataset.filter === filter))
    }
  })

  const saved = (): SavedState => {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '') as Partial<SavedState>
      return { read: value.read ?? [], starred: value.starred ?? [] }
    } catch {
      return { read: [], starred: [] }
    }
  }
  // Merge with what is saved, so entries that dropped out of a feed keep their state.
  const save = (): void => {
    const previous = saved()
    const current = collectState(feeds)
    const keys = new Set(feeds.flatMap((feed) => feed.entries.get().map((entry) => entry.key)))
    const keep = (list: string[]) => list.filter((key) => !keys.has(key))
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        read: [...keep(previous.read), ...current.read],
        starred: [...keep(previous.starred), ...current.starred],
      }),
    )
  }

  function renderEntry(entry: Entry): HTMLLIElement {
    const li = document.createElement('li')
    li.className = 'entry'
    li.innerHTML = `
      <button class="star" data-star aria-label="Star"></button>
      <div class="body">
        <a class="title" target="_blank" rel="noopener noreferrer"></a>
        <p class="meta"></p>
        <p class="summary"></p>
      </div>
      <button class="toggle-read" data-read></button>`
    const title = required<HTMLAnchorElement>(li, '.title')
    title.textContent = entry.title
    const href = safeHref(entry.link)
    if (href) title.href = href
    const when = Number.isNaN(entry.date) ? '' : dateFormat.format(entry.date)
    required(li, '.meta').textContent = [entry.feed.title, entry.author, when]
      .filter(Boolean)
      .join(' · ')
    required(li, '.summary').textContent = entry.summary.slice(0, 280)
    title.addEventListener('click', () => (entry.read = true))
    const star = required<HTMLButtonElement>(li, '[data-star]')
    star.addEventListener('click', () => (entry.starred = !entry.starred))
    const toggleRead = required<HTMLButtonElement>(li, '[data-read]')
    toggleRead.addEventListener('click', () => (entry.read = !entry.read))

    // The entry's XML element is an atom: it emits when its `read` or `starred` attribute changes.
    rows.add(
      wrap(entry.element).subscribe(() => {
        li.classList.toggle('read', entry.read)
        li.classList.toggle('starred', entry.starred)
        star.textContent = entry.starred ? '★' : '☆'
        star.setAttribute('aria-pressed', String(entry.starred))
        toggleRead.textContent = entry.read ? 'Mark unread' : 'Mark read'
      }),
    )
    return li
  }

  function render(): void {
    rows.reset()
    bound.reset()
    feedList.replaceChildren()
    entryList.replaceChildren()

    const allItem = document.createElement('li')
    allItem.innerHTML = '<button data-feed="">All feeds <span class="count"></span></button>'
    feedList.append(allItem)
    for (const feed of feeds) {
      const li = document.createElement('li')
      li.innerHTML = '<button><span class="name"></span> <span class="count"></span></button>'
      required<HTMLButtonElement>(li, 'button').dataset.feed = feed.url
      required(li, '.name').textContent = feed.title
      bound.add(feed.unread.subscribe((n) => (required(li, '.count').textContent = String(n))))
      feedList.append(li)
    }
    for (const button of feedList.querySelectorAll<HTMLButtonElement>('[data-feed]')) {
      button.addEventListener('click', () => (view.feed = button.dataset.feed!))
    }

    // FRICTION 3: there is no way to concatenate collections from several documents, so the river
    // of entries is a computed array rather than a live collection.
    const unread: ReadableAtom<number> = computed(
      feeds.map((feed) => feed.unread),
      (...counts) => counts.reduce((sum, n) => sum + n, 0),
    )
    bound.add(
      unread.subscribe((n) => {
        total.textContent = n === 0 ? 'All read' : `${n} unread`
        required(allItem, '.count').textContent = String(n)
      }),
    )

    // FRICTION 4: read/starred flips are not in any dep here (they live in other trees), so the
    // list only refilters when the filter, the feed, or membership changes. That happens to be the
    // behaviour a reader wants: an entry you just read stays in the Unread list until you switch.
    const visible = computed(
      [view.$.filter, view.$.feed, ...feeds.map((feed) => feed.entries)],
      (filter, feedUrl, ...lists) =>
        lists
          .flat()
          .filter((entry) => !feedUrl || entry.feed.url === feedUrl)
          .filter((entry) =>
            filter === 'unread' ? !entry.read : filter === 'starred' ? entry.starred : true,
          )
          .sort((a, b) => (b.date || 0) - (a.date || 0)),
    )
    bound.add(
      visible.subscribe((entries) => {
        rows.reset()
        entryList.replaceChildren(...entries.map(renderEntry))
        status.textContent = entries.length === 0 ? 'Nothing here.' : ''
      }),
    )
    bound.add(
      view.$.feed.subscribe((feedUrl) => {
        for (const button of feedList.querySelectorAll<HTMLButtonElement>('[data-feed]')) {
          button.setAttribute('aria-current', String(button.dataset.feed === feedUrl))
        }
      }),
    )

    // Persist whenever any feed's tree changes; the first call of each subscription is not a change.
    for (const feed of feeds) {
      const first = feed.entries.get()[0]
      const tree = first?.element.ownerDocument.documentElement
      if (!tree) continue
      let initial = true
      bound.add(
        wrap(tree).subscribe(() => {
          if (initial) initial = false
          else save()
        }),
      )
    }
  }

  async function load(): Promise<void> {
    status.textContent = 'Loading…'
    const sources = await options.sources()
    const results = await Promise.allSettled(
      sources.map(async (source) => parseFeed(source.url, await options.fetchText(source))),
    )
    const state = saved()
    feeds = []
    const errors: string[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        applyState(result.value, state)
        feeds.push(result.value)
      } else {
        errors.push(String(result.reason instanceof Error ? result.reason.message : result.reason))
      }
    }
    render()
    if (errors.length > 0) status.textContent = `Could not load: ${errors.join('; ')}`
  }

  required(root, '[data-action="refresh"]').addEventListener('click', () => void load())
  required(root, '[data-action="read-all"]').addEventListener('click', () => {
    const feedUrl = view.feed
    for (const feed of feeds) {
      if (feedUrl && feed.url !== feedUrl) continue
      for (const entry of feed.entries.get()) entry.read = true
    }
  })

  await load()
  return { refresh: load }
}
