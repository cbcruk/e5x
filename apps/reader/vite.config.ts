import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite-plus'

// The reader runs on the dev server (`pnpm reader`). Feeds rarely allow CORS, so the server
// fetches them: `/api/sources` lists what to load, `/api/feed?url=` proxies one subscribed feed.
// Subscriptions come from the gitignored feeds.local.json (a JSON array of feed URLs); without
// it the reader loads the synthetic samples in public/samples.

const here = import.meta.dirname
const localFeeds = path.join(here, 'feeds.local.json')
const samples = ['/samples/rss.xml', '/samples/atom.xml']

function subscriptions(): string[] {
  if (!existsSync(localFeeds)) return []
  const value: unknown = JSON.parse(readFileSync(localFeeds, 'utf8'))
  if (!Array.isArray(value) || !value.every((url) => typeof url === 'string')) {
    throw new Error('feeds.local.json must be a JSON array of feed URLs')
  }
  return value
}

function feedProxy(): Plugin {
  return {
    name: 'reader-feed-proxy',
    configureServer(server) {
      server.middlewares.use('/api/sources', (_req, res) => {
        const urls = subscriptions()
        const sources =
          urls.length > 0
            ? urls.map((url) => ({ url, fetchUrl: `/api/feed?url=${encodeURIComponent(url)}` }))
            : samples.map((url) => ({ url, fetchUrl: url }))
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(sources))
      })
      server.middlewares.use('/api/feed', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost').searchParams.get('url') ?? ''
        // Only subscribed feeds: the proxy must not fetch arbitrary URLs for whoever can reach it.
        if (!subscriptions().includes(url)) {
          res.statusCode = 403
          res.end('not a subscribed feed')
          return
        }
        try {
          const upstream = await fetch(url, {
            headers: { 'user-agent': 'e5x-reader (+https://github.com/cbcruk/e5x)' },
            signal: AbortSignal.timeout(15_000),
          })
          res.statusCode = upstream.status
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/xml')
          res.end(await upstream.text())
        } catch (error) {
          res.statusCode = 502
          res.end(`fetch failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    },
  }
}

export default defineConfig({
  root: here,
  plugins: [feedProxy()],
})
