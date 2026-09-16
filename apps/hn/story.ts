import { wrap } from '../../src/index'
import type { Collection, ReadableAtom, Wrapped } from '../../src/index'

// The markup is not ours: a story is two sibling rows, `<tr class="athing" id="…">` and the
// `<tr>` after it, told apart by class, with the numbers inside text ("713 points").

/** The attributes of a story row, plus the one this script adds. */
export const rowSchema = {
  id: 'string',
  class: 'string',
  'data-e5x-seen': 'boolean',
  'data-e5x-hidden': 'boolean',
} as const

/** A wrapped story row. */
export type Row = Wrapped<typeof rowSchema>

/** One story, read from the two rows it spans. */
export interface Story {
  readonly row: Row
  /** The `<tr>` after the title row, which holds score, author, age, and comments. */
  readonly subtext: Element | null
  readonly id: string
  readonly rank: number
  readonly title: string
  readonly url: string
  readonly site: string
  readonly author: string
  /** The score, from text like `713 points`; `0` for job posts, which have none. */
  readonly score: number
  /** Whether the page gives this story a score at all. Job posts do not. */
  readonly scored: boolean
  /** The comment count, from text like `241 comments`; `0` for `discuss`. */
  readonly comments: number
  /** The post time, from the `title` attribute of `span.age`. */
  readonly posted: number
  seen: boolean
  hidden: boolean
}

// FRICTION: values live inside text, so every number needs parsing. A `'number'` leaf would
// read `NaN` from "713 points".
function count(text: string): number {
  const digits = /\d[\d,]*/.exec(text)
  return digits ? Number(digits[0].replaceAll(',', '')) : 0
}

const text = (root: Element | null, selector: string): string =>
  root?.querySelector(selector)?.textContent?.trim() ?? ''

// The comments link is the last link to the item, but `span.age` holds one too, and a job post
// has only that one — so links inside the age are never the comments link. Checked in JS rather
// than with `a[href^="item?id="]`, which happy-dom does not match.
const commentText = (subtext: Element | null): string =>
  Array.from(subtext?.querySelectorAll('a') ?? [])
    .filter(
      (link) =>
        (link.getAttribute('href')?.startsWith('item?id=') ?? false) && !link.closest('span.age'),
    )
    .at(-1)?.textContent ?? ''

function story(row: Row): Story {
  // FRICTION: the rest of the story is the next sibling. e5x goes down a tree, never sideways,
  // so this leaves e5x for `$el`.
  const subtext = row.$el.nextElementSibling
  const link = row.$deep('span.titleline > a', { href: 'string' } as const)[0]
  const age = subtext ? wrap(subtext).$deep('span.age', { title: 'string' } as const)[0] : undefined
  return {
    row,
    subtext,
    id: row.id,
    rank: count(text(row.$el, 'span.rank')),
    // FRICTION: `<a href>text</a>` holds an attribute and text. The typed member gives the
    // attribute; its text comes from the element.
    title: link?.$el.textContent?.trim() ?? '',
    url: link?.href ?? '',
    site: text(row.$el, 'span.sitestr'),
    author: text(subtext, 'a.hnuser'),
    score: count(text(subtext, 'span.score')),
    scored: subtext?.querySelector('span.score') !== null && subtext !== null,
    comments: count(commentText(subtext)),
    posted: Date.parse(age?.title ?? ''),
    get seen() {
      return row['data-e5x-seen']
    },
    set seen(value) {
      row['data-e5x-seen'] = value
    },
    get hidden() {
      return row['data-e5x-hidden']
    },
    set hidden(value) {
      row['data-e5x-hidden'] = value
      // Both rows have to follow, and the spacer after them.
      subtext?.setAttribute('data-e5x-hidden', String(value))
      const spacer = subtext?.nextElementSibling
      if (spacer?.classList.contains('spacer')) {
        spacer.setAttribute('data-e5x-hidden', String(value))
      }
    },
  }
}

/**
 * The story rows of a page, as a live collection.
 *
 * `tr.athing.submission`, not `tr.athing`: comment rows on `/item` and `/threads` are also
 * `tr.athing`, and they have no score or comments link, so a stored threshold would hide a whole
 * discussion on someone else's page.
 */
export function storyRows(page: Element): Collection<typeof rowSchema> {
  // FRICTION: children match by tag name, and every row here is a `<tr>`. The selector form of
  // `$deep` is the only way to say "the rows that are stories".
  return wrap(page).$deep('tr.athing.submission', rowSchema)
}

/** Reads the stories of a page, live: the atom emits when rows are added, removed, or reordered. */
export function stories(page: Element): ReadableAtom<Story[]> {
  const rows = storyRows(page)
  // One Story per row element, so identity survives re-reads.
  const built = new WeakMap<Element, Story>()
  const read = (): Story[] =>
    rows.get().map((row) => {
      let current = built.get(row.$el)
      if (!current) {
        current = story(row)
        built.set(row.$el, current)
      }
      return current
    })
  return { get: read, subscribe: (listener) => rows.subscribe(() => listener(read())) }
}
