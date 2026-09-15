# e5x reader

A small RSS 2.0 / Atom reader built on e5x, used to dogfood the library (#5). The feed XML
document is the model: e5x wraps it directly, and reading state is stored on the entries as
`read` / `starred` attributes, then mirrored to `localStorage`.

## Run

```sh
pnpm reader          # http://localhost:5173
```

Subscriptions live in `apps/reader/feeds.local.json`, which git ignores:

```json
["https://example.com/feed"]
```

Without that file the reader loads the synthetic samples in `public/samples/`. Feeds rarely allow
CORS, so the dev server fetches them (`/api/feed?url=`), and only for URLs in the file.

## Files

- `feed.ts`: parses RSS / Atom and adapts entries of both formats to one `Entry` shape.
- `main.ts`: the UI, `mount(root, options)`; everything on screen is an e5x subscription.
- `entry.ts`: the browser entry point that wires `mount` to the dev server's endpoints.
- `FRICTION.md`: what was awkward, missing, or unused while building and using it.

Tests: `test/reader.test.ts`, Chromium only (`pnpm test:browser`).
