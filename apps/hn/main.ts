import { computed } from '../../src/index'
import type { ReadableAtom } from '../../src/index'
import { createFilters, list, loadSeen, saveSeen } from './filters'
import { stories } from './story'
import type { Story } from './story'

const style = `
  tr[data-e5x-hidden='true'] { display: none; }
  tr[data-e5x-seen='true'] span.titleline > a { color: #828282; }
  #e5x-hn { font: 12px Verdana, sans-serif; background: #fff4e8; border: 1px solid #ff6600;
    padding: 6px 8px; margin: 6px 0; display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; }
  #e5x-hn label { display: flex; gap: 4px; align-items: center; }
  #e5x-hn input[type='number'] { width: 4.5em; }
  #e5x-hn .count { color: #828282; margin-left: auto; }
  #e5x-hn mark { background: #ffe58a; }
`

const bar = `
  <label>min score <input type="number" min="0" step="10" data-field="min-score" /></label>
  <label>min comments <input type="number" min="0" step="10" data-field="min-comments" /></label>
  <label>mute <input type="text" size="18" placeholder="domain, domain" data-field="muted" /></label>
  <label>highlight <input type="text" size="18" placeholder="word, word" data-field="highlight" /></label>
  <label><input type="checkbox" data-field="hide-seen" /> hide seen</label>
  <button type="button" data-action="seen-all">mark page seen</button>
  <button type="button" data-action="reset">reset</button>
  <span class="count"></span>
`

/** What the script needs from its environment, so tests can supply fakes. */
export interface Options {
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

function highlightTitles(story: Story, words: string[]): void {
  const link = story.row.$el.querySelector('span.titleline > a')
  if (!link) return
  const title = link.textContent ?? ''
  if (words.length === 0) {
    if (link.querySelector('mark')) link.textContent = title
    return
  }
  // Rebuilt as text nodes and <mark>: never with innerHTML, since titles are other people's text.
  const pattern = new RegExp(
    `(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi',
  )
  const parts = title.split(pattern)
  if (parts.length === 1) {
    if (link.querySelector('mark')) link.textContent = title
    return
  }
  link.replaceChildren(
    ...parts.map((part, index) => {
      if (index % 2 === 0) return link.ownerDocument.createTextNode(part)
      const mark = link.ownerDocument.createElement('mark')
      mark.textContent = part
      return mark
    }),
  )
}

/** Adds the filter bar to a Hacker News page and keeps the rows in step with it. */
export function mount(page: Element, options: Options = {}): { stop(): void } {
  const document = page.ownerDocument
  const storage = options.storage ?? localStorage
  const sheet = document.createElement('style')
  sheet.textContent = style
  document.head.append(sheet)

  const panel = document.createElement('div')
  panel.id = 'e5x-hn'
  panel.innerHTML = bar
  page.parentElement?.insertBefore(panel, page)

  const filters = createFilters(page.ownerDocument.body, storage)
  const seen = loadSeen(storage)
  const list$ = stories(page)
  const stops: (() => void)[] = []

  for (const input of panel.querySelectorAll<HTMLInputElement>('[data-field]')) {
    const field = input.dataset.field!
    const value = filters.$attr[field] ?? ''
    if (input.type === 'checkbox') input.checked = value === 'true'
    else input.value = value
    input.addEventListener('input', () => {
      filters.$attr[field] = input.type === 'checkbox' ? String(input.checked) : input.value
    })
  }

  const apply = (): void => {
    const current = list$.get()
    const muted = list(filters.muted)
    const words = list(filters.highlight)
    for (const story of current) {
      story.seen = seen.has(story.id)
      const hide =
        story.score < filters['min-score'] ||
        story.comments < filters['min-comments'] ||
        (filters['hide-seen'] && story.seen) ||
        muted.some((domain) => story.site.toLowerCase().endsWith(domain))
      story.hidden = hide
      highlightTitles(story, words)
    }
    const hidden = current.filter((story) => story.hidden).length
    panel.querySelector('.count')!.textContent =
      `${current.length - hidden} shown, ${hidden} hidden`
  }

  // One atom for everything the filtering reads, so any change re-applies it.
  const inputs: ReadableAtom<unknown> = computed(
    [
      list$,
      filters.$['min-score'],
      filters.$['min-comments'],
      filters.$.muted,
      filters.$.highlight,
      filters.$['hide-seen'],
    ],
    (...values) => values,
  )
  stops.push(inputs.subscribe(apply))

  const markSeen = (story: Story): void => {
    seen.add(story.id)
    saveSeen(storage, seen)
    apply()
  }
  const onClick = (event: Event): void => {
    const link = (event.target as Element).closest?.('span.titleline > a')
    const row = link?.closest('tr.athing')
    const story = row ? list$.get().find((candidate) => candidate.row.$el === row) : undefined
    if (story) markSeen(story)
  }
  page.addEventListener('click', onClick)
  stops.push(() => page.removeEventListener('click', onClick))

  panel.querySelector('[data-action="seen-all"]')!.addEventListener('click', () => {
    for (const story of list$.get()) seen.add(story.id)
    saveSeen(storage, seen)
    apply()
  })
  panel.querySelector('[data-action="reset"]')!.addEventListener('click', () => {
    for (const input of panel.querySelectorAll<HTMLInputElement>('[data-field]')) {
      if (input.type === 'checkbox') input.checked = false
      else input.value = input.type === 'number' ? '0' : ''
      input.dispatchEvent(new Event('input'))
    }
  })

  return {
    stop() {
      for (const stop of stops) stop()
      panel.remove()
      sheet.remove()
    },
  }
}
