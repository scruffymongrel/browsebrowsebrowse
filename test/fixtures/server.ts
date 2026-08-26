/**
 * Fixture server for the integration suite.
 *
 * The interesting page is `/stream`. It is built to defeat `networkidle2`
 * honestly rather than by simulation: `networkidle2` fires once there have been
 * no more than *two* open connections for 500ms, so a single SSE stream would
 * not actually block it. This page keeps a growing pile of requests open
 * instead, which is what a real long-polling or chatty streaming app does.
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

export function startFixtures(): Fixtures {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url)
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
