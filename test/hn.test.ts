/// <reference types="vite-plus/client" />
import { describe, it, expect, beforeEach } from 'vite-plus/test'
import { mount } from '../apps/hn/main'
import { stories } from '../apps/hn/story'
import type { Story } from '../apps/hn/story'
import fixture from '../apps/hn/public/fixture.html?raw'

// The markup is someone else's: two sibling rows per story, rows told apart by class, numbers
// inside text. The fixture copies that shape, with content of our own.

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let store: Map<string, string>
const storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
}

const page = (): Element => document.querySelector('#hnmain')!
const shown = (): string[] =>
  Array.from(document.querySelectorAll('tr.athing.submission'))
    .filter((row) => row.getAttribute('data-e5x-hidden') !== 'true')
    .map((row) => row.querySelector('span.titleline > a')!.textContent ?? '')
const panel = (selector: string): HTMLElement => document.querySelector(`#e5x-hn ${selector}`)!
const type = (field: string, value: string): void => {
  const input = panel(`[data-field="${field}"]`) as HTMLInputElement
  if (input.type === 'checkbox') input.checked = value === 'true'
  else input.value = value
  input.dispatchEvent(new Event('input'))
}

beforeEach(() => {
  store = new Map()
  document.body.innerHTML = new DOMParser().parseFromString(fixture, 'text/html').body.innerHTML
  // The fixture's links are real URLs: clicking one would navigate the test page away.
  document.addEventListener('click', (event) => event.preventDefault())
})

describe('reading stories from markup we do not own', () => {
  it('reads both rows of each story', () => {
    // Read field by field: a Story holds wrapped elements, which test serializers cannot print.
    const fields = ({ id, rank, title, url, site, author, score, comments, posted }: Story) => ({
      id,
      rank,
      title,
      url,
      site,
      author,
      score,
      comments,
      posted,
    })
    const all = stories(page()).get()

    expect(all).toHaveLength(6)
    expect(fields(all[0]!)).toEqual({
      id: '101',
      rank: 1,
      title: 'A well-liked post',
      url: 'https://good.example/a',
      site: 'good.example',
      author: 'ada',
      score: 713,
      comments: 241,
      posted: Date.parse('2026-09-15T19:25:03'),
    })
    // "discuss" instead of a comment count, and no site for an Ask HN post.
    expect(fields(all[3]!)).toMatchObject({ id: '104', score: 57, comments: 0, site: '' })
    // Thousands separators.
    expect(fields(all[4]!)).toMatchObject({ id: '105', score: 1234, comments: 1024 })
    // A job post has no score and no comments link, only the age link: neither is a count.
    expect(fields(all[5]!)).toMatchObject({ id: '106', score: 0, comments: 0 })
  })

  it('leaves comment rows alone: they are athing, but not submissions', async () => {
    mount(page(), { storage })
    await flush()
    type('min-score', '100')
    await flush()

    // A stored threshold must never hide a discussion on someone else's page.
    const comment = document.querySelector('[id="201"]')!
    expect(comment.classList.contains('athing')).toBe(true)
    expect(comment.getAttribute('data-e5x-hidden')).toBeNull()
    expect(
      stories(page())
        .get()
        .some((story) => story.id === '201'),
    ).toBe(false)
  })

  it('stops cleanly and refuses to mount twice', async () => {
    const app = mount(page(), { storage })
    await flush()
    const second = mount(page(), { storage })
    expect(document.querySelectorAll('#e5x-hn')).toHaveLength(1)
    expect(document.querySelectorAll('e5x-filters')).toHaveLength(1)
    second.stop()

    // Kept so a write to it after stop() can be checked below.
    const leftover = document.querySelector('e5x-filters')!
    app.stop()
    expect(document.querySelector('#e5x-hn')).toBeNull()
    expect(document.querySelector('e5x-filters')).toBeNull()

    // Nothing left listening: even a write to the filter element saves nothing.
    store.delete('e5x-hn:filters')
    leftover.setAttribute('min-score', '999')
    document.querySelector('tr.athing.submission')!.setAttribute('data-e5x-hidden', 'true')
    await flush()
    expect(store.has('e5x-hn:filters')).toBe(false)
  })
})

describe('the filter bar', () => {
  it('hides stories under the score or comment threshold, with their other rows', async () => {
    mount(page(), { storage })
    await flush()
    expect(shown()).toHaveLength(6)

    type('min-score', '100')
    await flush()
    // The job post stays: the page gives it no score, so the threshold does not apply to it.
    expect(shown()).toEqual([
      'A well-liked post',
      'Another noisy domain post',
      'A post with many points',
      'Example Corp is hiring',
    ])
    // The subtext row and the spacer follow the story row.
    const hiddenRow = document.getElementById('102')!
    expect(hiddenRow.nextElementSibling!.getAttribute('data-e5x-hidden')).toBe('true')
    expect(panel('.count').textContent).toBe('4 shown, 2 hidden')

    type('min-score', '0')
    type('min-comments', '9')
    await flush()
    expect(shown()).toEqual([
      'A well-liked post',
      'A post with many points',
      'Example Corp is hiring',
    ])
  })

  it('mutes domains and keeps the filters after a reload', async () => {
    mount(page(), { storage })
    await flush()
    type('muted', 'noisy.example')
    await flush()
    expect(shown()).toEqual([
      'A well-liked post',
      'Ask HN: a post with no site',
      'A post with many points',
      'Example Corp is hiring',
    ])

    document.body.innerHTML = new DOMParser().parseFromString(fixture, 'text/html').body.innerHTML
    mount(page(), { storage })
    await flush()
    expect(shown()).toEqual([
      'A well-liked post',
      'Ask HN: a post with no site',
      'A post with many points',
      'Example Corp is hiring',
    ])
    expect((panel('[data-field="muted"]') as HTMLInputElement).value).toBe('noisy.example')
  })

  it('marks a story seen when its title is clicked, and can hide seen ones', async () => {
    mount(page(), { storage })
    await flush()
    document.querySelector<HTMLElement>('[id="101"] span.titleline > a')!.click()
    await flush()

    expect(document.getElementById('101')!.getAttribute('data-e5x-seen')).toBe('true')
    expect(JSON.parse(store.get('e5x-hn:seen')!)).toEqual(['101'])

    type('hide-seen', 'true')
    await flush()
    expect(shown()).not.toContain('A well-liked post')

    panel('[data-action="seen-all"]').click()
    await flush()
    expect(shown()).toEqual([])
  })

  it('does not hide stories the page gives no score, such as job posts', async () => {
    mount(page(), { storage })
    await flush()
    type('min-score', '100')
    type('min-comments', '50')
    await flush()

    // A threshold says nothing about a post with no score: /jobs is all such posts.
    expect(shown()).toContain('Example Corp is hiring')
  })

  it('leaves the page as it found it when stopped', async () => {
    const app = mount(page(), { storage })
    await flush()
    type('min-score', '100')
    type('highlight', 'post')
    await flush()
    expect(document.querySelectorAll('span.titleline mark').length).toBeGreaterThan(0)

    app.stop()
    await flush()

    expect(document.querySelectorAll('span.titleline mark')).toHaveLength(0)
    expect(document.querySelectorAll('[data-e5x-hidden]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-e5x-seen]')).toHaveLength(0)
  })

  it('highlights words in titles as text, never as markup', async () => {
    mount(page(), { storage })
    await flush()
    type('highlight', 'e5x')
    await flush()

    const marked = document.querySelector('[id="102"] span.titleline > a mark')!
    expect(marked.textContent).toBe('e5x')
    expect(document.querySelector('[id="102"] span.titleline > a')!.textContent).toBe(
      'A quiet post about e5x',
    )

    // A title containing markup stays text.
    const hostile = document.querySelector('[id="101"] span.titleline > a')!
    hostile.textContent = '<img src=x onerror="window.pwned = 1"> e5x'
    type('highlight', 'e5x ')
    await flush()
    expect(hostile.querySelector('img')).toBeNull()
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined()

    type('highlight', '')
    await flush()
    expect(document.querySelector('[id="102"] span.titleline > a mark')).toBeNull()
  })

  it('reacts to rows added after it started', async () => {
    mount(page(), { storage })
    await flush()
    type('min-score', '100')
    await flush()

    const table = document.querySelector('tr.athing')!.parentElement!
    table.insertAdjacentHTML(
      'beforeend',
      `<tr class="athing submission" id="107"><td class="title"><span class="rank">5.</span></td>
        <td class="title"><span class="titleline"><a href="https://late.example/e">A late arrival</a><span class="sitebit comhead"> (<a href="from?site=late.example"><span class="sitestr">late.example</span></a>)</span></span></td></tr>
       <tr><td class="subtext"><span class="score" id="score_107">5 points</span> by <a href="user?id=ez" class="hnuser">ez</a> <span class="age" title="2026-09-16T01:00:00"><a href="item?id=107">1 minute ago</a></span> | <a href="item?id=107">1&nbsp;comment</a></span></td></tr>`,
    )
    await flush()

    expect(shown()).not.toContain('A late arrival')
    expect(panel('.count').textContent).toBe('4 shown, 3 hidden')
  })
})
