import type { IncomingMessage, ServerResponse } from 'node:http'
import { app, ensureReady } from '../server/src/app.js'

// ---------------------------------------------------------------------
// Vercel serverless entry point.
//
// One function handles every /api/* path, sent here by a rewrite in
// vercel.json. It used to be named [...slug].ts and rely on filesystem
// routing, but Vercel matched that as a single segment: /api/health
// reached the function while /api/admin/login returned a 404, which
// took out the whole dashboard and every product page.
//
// The Express routes are all declared with their /api prefix, so they
// need req.url to be the path the browser actually asked for. See
// restoreOriginalPath below.
//
// ensureReady() connects to Postgres on the first request into a cold
// container and caches the pool on globalThis, so warm invocations
// reuse it instead of opening a connection per request.
// ---------------------------------------------------------------------

/**
 * Puts the browser's own path back on the request.
 *
 * A Vercel rewrite may hand the function the destination path rather
 * than the original, which would leave Express looking for a route
 * called /api. The rewrite therefore carries the real path in a query
 * parameter, which this moves back into req.url and removes.
 *
 * When the path survives the rewrite intact the parameter is absent and
 * this does nothing, so both behaviours are handled.
 */
function restoreOriginalPath(req: IncomingMessage): void {
  const url = new URL(req.url ?? '/', 'http://orbis.invalid')
  const captured = url.searchParams.get('__path')
  if (captured === null) return

  url.searchParams.delete('__path')
  const query = url.searchParams.toString()
  req.url = `/api/${captured}${query ? `?${query}` : ''}`
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  restoreOriginalPath(req)

  try {
    await ensureReady()
  } catch (err) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        error: {
          code: 'db_unavailable',
          message:
            'The API could not reach its database. Check DATABASE_URL, and that the Supabase project is not paused.',
        },
      }),
    )
    if (err instanceof Error) console.error('[api] postgres connect failed:', err.message)
    return
  }

  return app(req as never, res as never)
}
