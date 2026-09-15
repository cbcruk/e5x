# Friction log

Kept while building and using the reader (#5). Each entry says what happened, the workaround,
and how much it hurt. Summarised into #5 at the end, as input to #12.

Legend: **blocker** (had to leave e5x), **workaround** (e5x plus extra code), **papercut**
(minor), **good** (e5x fitted better than the alternative).

## Build (2026-09-15)

### 1. `atom:link` shadows `link` — workaround

A WordPress RSS channel has `<atom:link href="…" rel="self"/>` before `<link>https://…</link>`.
Fields match children by local name and ignore namespaces, so `channel.link` reads the empty
`atom:link` and returns `''`. The typed schema cannot say which one.

Workaround: `rssSiteLink` walks `channel.$el.children` for a `link` with no namespace.

Possible fix: let a schema key or `$deep` name a namespace, or prefer the no-namespace element
when the document's default namespace is empty.

### 2. Two formats, one entry shape — workaround

RSS items and Atom entries hold the same information in different places: `link` text vs
`<link href rel>`, `pubDate` vs `published`/`updated`, `dc:creator` vs `<author><name>`. Each
format gets a schema, and an adapter object with getters (`rssEntry`, `atomEntryOf`) maps both to
one `Entry`. About 80 lines, which is most of `feed.ts`.

Related: #9 (heterogeneous children) covers different children under one name, not this. A
schema that says "this field, or that path" would remove the adapters.

### 3. No concatenation of collections — workaround

The reading list spans several feeds, and each feed is its own document. There is no way to join
collections into one live collection, so the list is a `computed` over each feed's entries: a
plain array, without `$where` / `$sort` / columns. Filtering and sorting are ordinary array code.

### 4. Reading state is not a dep of the combined list — papercut (turned out fine)

The combined list is a `computed` over the filter, the selected feed, and each feed's entries.
Marking an entry read changes an attribute in a feed document, which is in none of those deps, so
the Unread list does not drop the entry until the filter or membership changes. That is what a
reader wants: an entry does not vanish while you look at it. Getting the other behaviour would
need one dep per entry.

### 5. Coarse element atoms made persistence easy — good

Saving reading state is one subscription per feed document: `wrap(documentElement).subscribe`
fires on any change in the tree, and the handler writes `localStorage`. Per-entry row state is
`wrap(entry.element).subscribe`. No change tracking code.

### 6. Real feed text needs a real parser — papercut (tooling)

happy-dom's `DOMParser` loses the `channel` element, `dc:creator`, and CDATA text of the real
Stereogum feed, so reader tests run only in Chromium. Not an e5x problem, but it means the fast
test run cannot cover the reader.

### 7. Refresh replaces whole documents — papercut

Refreshing parses a new document per feed, so every view and subscription is rebuilt and reading
state is re-applied from storage. Fine at 40 entries. e5x has no way to merge a new document into
the one already wrapped.

### 8. Worked as documented on a real feed — good

- `'<string>'` leaves read CDATA text (`dc:creator`, `description`) by local name.
- `item.$where({ read: false }).$length` gives a live unread count per feed, with `read` a
  `'boolean'` attribute the reader adds; attributes absent from the feed read as `false`.
- Writing `entry.read = true` sets the attribute, and every count and row updates.

### Not used so far

`$push`, `$sort`, column aggregates, `$deep` (typed or loose), `computed`'s same-tick batching as a
feature, `e5x/jsx`, the development deps warnings (none fired).

## Use

Entries added while the maintainer uses the reader on real subscriptions.
