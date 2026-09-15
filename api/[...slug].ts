import type { IncomingMessage, ServerResponse } from 'node:http'
import { app, ensureReady } from '../server/src/app.js'

// ---------------------------------------------------------------------
// Vercel serverless entry point.
//
// The catch-all filename means this one function handles every /api/*
// path, and Vercel leaves req.url as the original path — so the Express
// routes, which are all declared with their /api prefix, match without
// any rewriting.
//
// ensureReady() connects to Postgres on the first request into a cold
// container and caches the pool on globalThis, so warm invocations
// reuse it instead of opening a connection per request.
// ---------------------------------------------------------------------

export default async function handler(req: IncomingMessage, res: ServerResponse) {
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
