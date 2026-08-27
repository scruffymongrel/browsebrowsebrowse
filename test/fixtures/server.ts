/**
 * Fixture server for the integration suite.
 *
 * The interesting page is `/stream`. It is built to defeat `networkidle2`
 * honestly rather than by simulation: `networkidle2` fires once there have been
 * no more than *two* open connections for 500ms, so a single SSE stream would
 * not actually block it. This page keeps a growing pile of requests open
 * instead, which is what a real long-polling or chatty streaming app does.
 *
 * `/sse` is the *other* streaming shape, and it fails the opposite way: one
 * EventSource, opened from a script that has not run yet at
 * `domcontentloaded`. The network is briefly idle, `networkidle2` is satisfied
 * immediately, and an eval runs before a single event has arrived — fast,
 * `ok: true`, and wrong. See the skill's streaming section.
 *
 * The status routes exist so `status` and `--fail` are asserted against real
 * HTTP, including a redirect chain, rather than against a stubbed Response.
 */

export interface Fixtures {
  url: (path: string) => string
  stop: () => void
}

const STATIC_PAGE = `<!doctype html>
<title>Fixture</title>
<style>.card { width: 240px; height: 120px; display: grid }</style>
<body>
  <h1>static</h1>
  <div class="card">card</div>
  <script>
    document.body.insertAdjacentHTML('beforeend', '<p id="scripted">scripted</p>')
    console.warn('fixture warning')
  </script>
</body>`

const STREAM_PAGE = `<!doctype html>
<title>Streaming</title>
<body>
  <h1>streaming</h1>
  <script>
    // Never-completing requests, more than networkidle2's threshold of two.
    for (let i = 0; i < 4; i++) fetch('/hang?' + i)
    setInterval(() => fetch('/hang?tick=' + Date.now()), 200)
    setTimeout(() => {
      document.body.insertAdjacentHTML('beforeend', '<div data-done>settled</div>')
    }, 400)
  </script>
</body>`

const SSE_PAGE = `<!doctype html>
<title>SSE</title>
<body>
  <ul id="items"></ul>
  <script>
    const es = new EventSource('/events')
    es.onmessage = e => {
      if (e.data === 'end') {
        es.close()
        document.body.insertAdjacentHTML('beforeend', '<div data-done></div>')
        return
      }
      document.getElementById('items').insertAdjacentHTML('beforeend', '<li>' + e.data + '</li>')
    }
  </script>
</body>`

/** Five events over ~3s, socket held open throughout. */
function sseStream(): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (let i = 1; i <= 5; i++) {
          await Bun.sleep(500)
          controller.enqueue(encoder.encode(`data: item ${i}\n\n`))
        }
        controller.enqueue(encoder.encode('data: end\n\n'))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } },
  )
}

const statusPage = (label: string, status: number): Response =>
  new Response(`<!doctype html><title>${label}</title><body><h1>${label}</h1></body>`, {
    status,
    headers: { 'content-type': 'text/html' },
  })

export function startFixtures(): Fixtures {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url)
      if (pathname === '/404') return statusPage('not found', 404)
      if (pathname === '/500') return statusPage('boom', 500)
      // A 302 into a 200: `status` must report the destination, or every
      // redirected page would look like a failure under --fail.
      if (pathname === '/redirect') {
        return new Response(null, { status: 302, headers: { location: '/' } })
      }
      // A redirect that lands on a 404 — the final status is the one that counts.
      if (pathname === '/redirect-to-404') {
        return new Response(null, { status: 302, headers: { location: '/404' } })
      }
      if (pathname === '/sse') {
        return new Response(SSE_PAGE, { headers: { 'content-type': 'text/html' } })
      }
      if (pathname === '/events') return sseStream()
      if (pathname === '/hang') {
        // Held open until the browser goes away.
        return new Response(new ReadableStream({ start() {} }), {
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      if (pathname === '/stream') {
        return new Response(STREAM_PAGE, { headers: { 'content-type': 'text/html' } })
      }
      if (pathname === '/slow') {
        await Bun.sleep(3000)
        return new Response('late')
      }
      return new Response(STATIC_PAGE, { headers: { 'content-type': 'text/html' } })
    },
  })

  return {
    url: (path: string) => `http://127.0.0.1:${server.port}${path}`,
    stop: () => void server.stop(true),
  }
}
