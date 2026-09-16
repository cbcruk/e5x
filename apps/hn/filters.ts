import { wrap } from '../../src/index'
import type { Wrapped } from '../../src/index'

// Filter state lives in the DOM, in an element this script adds, so views can take its fields as
// deps. It is mirrored to localStorage.
export const filterSchema = {
  'min-score': 'number',
  'min-comments': 'number',
  muted: 'string',
  highlight: 'string',
  'hide-seen': 'boolean',
} as const

/** The wrapped filter element. */
export type Filters = Wrapped<typeof filterSchema>

const STORAGE_KEY = 'e5x-hn:filters'
const SEEN_KEY = 'e5x-hn:seen'
// Enough for weeks of front pages, and bounded so the entry never grows forever.
const SEEN_LIMIT = 2000

const defaults: Record<string, string> = {
  'min-score': '0',
  'min-comments': '0',
  muted: '',
  highlight: '',
  'hide-seen': 'false',
}

/** Splits a comma or space separated list into lowercase words. */
export function list(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
}

/** Creates the filter element from saved state and appends it to `root`. */
export function createFilters(
  root: Element,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): Filters {
  const element = root.ownerDocument.createElement('e5x-filters')
  let saved: Record<string, unknown> = {}
  try {
    saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
  } catch {
    saved = {}
  }
  for (const [name, fallback] of Object.entries(defaults)) {
    const value = saved[name]
    element.setAttribute(name, value === undefined ? fallback : String(value))
  }
  element.setAttribute('hidden', '')
  root.append(element)
  const filters = wrap(element, filterSchema)
  // Save on any change to the element, whatever caused it.
  wrap(element).subscribe(() => {
    const state: Record<string, string> = {}
    for (const name of Object.keys(defaults)) state[name] = element.getAttribute(name) ?? ''
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  })
  return filters
}

/** Reads the ids of stories already seen. */
export function loadSeen(storage: Pick<Storage, 'getItem' | 'setItem'>): Set<string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(SEEN_KEY) ?? '[]')
    return new Set(Array.isArray(value) ? value.map(String) : [])
  } catch {
    return new Set()
  }
}

/** Saves the ids of stories already seen, keeping the most recent ones. */
export function saveSeen(storage: Pick<Storage, 'getItem' | 'setItem'>, seen: Set<string>): void {
  storage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_LIMIT)))
}
