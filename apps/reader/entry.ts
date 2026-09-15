import { mount } from './main'
import type { Source } from './main'

async function text(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return response.text()
}

void mount(document.getElementById('app')!, {
  sources: async () => JSON.parse(await text(await fetch('/api/sources'))) as Source[],
  fetchText: async (source) => text(await fetch(source.fetchUrl)),
})
