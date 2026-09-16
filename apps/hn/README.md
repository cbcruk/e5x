# e5x for Hacker News

A userscript that filters, mutes, highlights, and marks Hacker News stories, built with e5x. It is
the second dogfooding target (#25), after the feed reader: this time the markup belongs to someone
else and we only read it.

## Use it

```sh
pnpm hn:build      # apps/hn/dist/e5x-hn.user.js
```

Install that file in Tampermonkey or Violentmonkey. It runs on `news.ycombinator.com`, adds a bar
above the page, and keeps its settings and the stories you have seen in `localStorage`.

- **min score / min comments**: hide anything below. Posts the page gives no score, such as job
  posts, are never hidden by a threshold — otherwise a saved filter would blank `/jobs`.
- **mute**: hide stories from these domains (comma or space separated).
- **highlight**: wrap these words in the titles.
- **hide seen**: hide stories you already opened, plus anything from _mark page seen_.

## Develop

```sh
pnpm hn            # harness page with a synthetic front page
```

`public/fixture.html` has the shape of a real front page — two sibling rows per story, rows told
apart by class, numbers inside text — with content of our own. Tests: `test/hn.test.ts`.

## Files

- `story.ts`: reads stories from the markup; the live collection and per-story fields.
- `filters.ts`: filter state in a DOM element, mirrored to `localStorage`.
- `main.ts`: `mount(page, options)`, the bar and everything it drives.
- `userscript.ts`: the built entry, with the userscript banner.
- `FRICTION.md`: what e5x made easy or awkward here.
