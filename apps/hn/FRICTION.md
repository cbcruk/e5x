# Friction log

The HTML half of the dogfooding (#25), written while building a userscript over markup we do not
control. The XML half is `apps/reader/FRICTION.md`. Entries say whether they repeat something the
reader already showed.

Legend: **blocker**, **workaround**, **papercut**, **good**.

## Build (2026-09-16)

### 1. No sibling axis — workaround (general, new)

A story is two rows: `<tr class="athing" id="…">` and the `<tr>` right after it, which holds the
score, author, age, and comment count. e5x walks down a tree: fields are children, `$deep` is
descendants. Nothing addresses "the element after this one", so `story.ts` leaves e5x for
`row.$el.nextElementSibling` and reads that row with `querySelector`.

This is the single biggest gap for page markup. Tables, definition lists, and heading-plus-content
sections all put related data in siblings.

### 2. Children match by tag name, and HTML tells elements apart by class — workaround (general, new)

Every row here is a `<tr>`, and what distinguishes them is `class`. Child access is worse than it
first looks: the stories sit in a nested table, so `wrap(page).tr` returns the **one** wrapper row,
not the rows (`$deep('tr')` finds 14). Real markup nests, so the shape-matched path is not just
imprecise here, it does not reach the data at all.

The story list is `$deep('tr.athing.submission', schema)`, and the selector has to be that precise:
comment rows on `/item` are `tr.athing` too. So the selector form of `$deep` (#10) carried this
app, and the selector went back to CSS.

### 3. Values live inside text — workaround (general, new)

`713 points`, `241 comments`, `5 hours ago`. A `'number'` leaf reads `NaN`, so every number goes
through a parser in the adapter. A schema cannot say "a number inside this text", and there is no
place to hang a conversion.

### 4. An element with attributes and text — workaround (general, repeat)

`<a href="…">title</a>` and `<span class="age" title="2026-09-15T19:25:03">5 hours ago</span>`.
Same as the reader's Atom text constructs: `$deep(selector, { href: 'string' })` types the
attribute, and the text comes from `$el.textContent`. In HTML this is not an edge case, it is how
links, `<option>`, `<time>`, and `<meta>` all work.

### 5. `data-*` fields need bracket access — papercut (general, new)

The script marks rows with `data-e5x-seen` / `data-e5x-hidden`. A hyphen is not an identifier, so
the schema key and every read are `row['data-e5x-seen']`. Fine, but it is the common case in HTML,
and the shape-matched reading (`row.dataE5xSeen`) is not available.

### 6. Writing to the page is where e5x earned its place — good

What the script actually does is annotate: set an attribute, let CSS do the rest. `story.hidden =
true` writes the attribute, the live collection keeps up when rows change, and the filter bar is
one `computed` over the filter element's field atoms plus the story list. No re-render code, no
bookkeeping.

### 7. The filtering API went unused — observation

`$where` / `$sort` / columns never appeared. The app does not _select_ a subset, it _marks_ every
row, because the page has to keep its own order and the rows are the UI. On third-party markup the
useful half of e5x was the live collection, element atoms, and writes.

### 7b. The reader's general entries, revisited

- **No concatenation of collections** (reader 3): did not come up. One page, one list. It is real,
  but a page-annotating script has nothing to join.
- **Snapshot lists and deps** (reader 4): did not come up either, and for an instructive reason —
  this app never builds a filtered view. It marks every row, so there is no view to go stale.
- **Coarse element atoms** (reader 5): came back and helped again. `filters.ts` persists with one
  `wrap(element).subscribe`, exactly as the reader saved reading state.

### 8. The page never gets replaced — not observed here

Hacker News navigates with full page loads, so the reader's "refresh replaces the document"
friction did not come up. A site that swaps parts of the DOM would exercise it.

### Not e5x

- `#101` is not a valid CSS selector (ids starting with a digit), so tests use `[id="101"]`.
- happy-dom does not match `a[href^="item?id="]`; the script checks `href` in JS instead, which
  also reads better.

## Use

Entries added while the maintainer uses the script.
