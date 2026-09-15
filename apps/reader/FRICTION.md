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
one `Entry`. That is most of `feed.ts`, and the review showed the adapters need format rules the
schema cannot hold:

- a `<link>` without `rel` is `alternate` (RFC 4287), so links are a function, not `$where`;
- an entry without `<author>` inherits the feed's;
- a summary may be missing, with the text in `<content>`;
- entries need a key unique across feeds, with a fallback when there is no id.

Related: #9 (heterogeneous children) covers different children under one name, not this. A
schema that says "this field, or that path" would remove some of the adapter code.

### 2b. An element with both attributes and text has no typed text — papercut

An Atom text construct is `<title type="html">…</title>`: the `type` attribute decides how to
read the text. A `'<string>'` leaf reads only the text. A child collection
(`title: [{ type: 'string' }]`) types the attribute, and the member does give its text through
`String(title[0])` (the `toString` hook), but that is untyped and not in the README. The adapter
reads `title[0].$el` instead, since `type="xhtml"` needs the element anyway.

### 3. No concatenation of collections — workaround

The reading list spans several feeds, and each feed is its own document. There is no way to join
collections into one live collection, so the list is a `computed` over each feed's entries: a
plain array, without `$where` / `$sort` / columns. Filtering and sorting are ordinary array code.

For feeds of one format there is a way out: move every feed's items under one element and wrap
that. It does not help here, because RSS and Atom entries have different shapes (entry 2).

### 4. The reading list is a snapshot — decision

The combined list is a `computed` over the filter, the selected feed, a `revision` counter, and
each feed's entries. Marking an entry read changes an attribute in a feed document, which is in
none of those deps, so the entry stays in the Unread list until you pick a filter or feed again or
refresh. That is deliberate: an entry should not vanish while you look at it.

The other behaviour is cheap: one more dep per feed, the document element atom
`wrap(documentElement)`, which emits on any change in its tree. (The first version of this entry
claimed it would need one dep per entry. The review showed that was wrong.)

Picking the filter that is already selected does not change its value, so it did not re-filter
at first. The `revision` attribute, bumped on every click, is the dep that makes "pick again" work.

### 5. Coarse element atoms made persistence easy — good

Saving reading state is one subscription per feed document: `wrap(documentElement).subscribe`
fires on any change in the tree, and the handler writes `localStorage`. Per-entry row state is
`wrap(entry.element).subscribe`. No change tracking code.

### 6. Real feed text needs a real parser — papercut (tooling)

happy-dom's `DOMParser` parses feed XML as HTML. On the real Stereogum feed it loses the `channel`
element, `dc:creator`, and CDATA text. On the synthetic sample `channel` survives, but `<link>`
text, `dc:creator`, and CDATA are still lost. So reader tests run only in Chromium, and the fast
test run cannot cover the reader.

### 6b. `Response.text()` is always UTF-8 — papercut (platform)

Feeds declare their charset in the response header or the XML declaration. `fetch().text()`
ignores both, so the reader reads bytes and decodes them itself (`decodeFeed`). Not e5x.

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
