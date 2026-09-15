import { app, ensureReady, adminEnabled } from "./app";
import { databaseLabel, stats } from "./db.js";

// ---------------------------------------------------------------------
// Local / container entry point.
//
// Vercel does not use this file — it imports the app directly from
// app.ts (see api/[...slug].ts). This is for `npm run api`, Railway,
// Render, a VPS: anywhere there is a long-lived process to listen on a
// port.
// ---------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 8787);

async function main() {
  try {
    await ensureReady();
  } catch (err) {
    // The two failures look identical in a stack trace and have
    // completely different fixes, so they are told apart here.
    if (!process.env.DATABASE_URL) {
      console.error(
        "\n[api] DATABASE_URL is not set, so there is no database to connect to.",
      );
      console.error(
        "[api] Add it to .env — see .env.example for how to get one from",
      );
      console.error("[api] Supabase (the free tier is plenty):\n");
      console.error(
        "[api]   DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres\n",
      );
      process.exit(1);
    }
    console.error("\n[api] Could not connect to Postgres.");
    console.error(
      "[api] " + (err instanceof Error ? err.message : String(err)),
    );
    console.error(
      "[api] Check the username and password in DATABASE_URL, and that the project",
    );
    console.error("[api] is not paused in the Supabase dashboard.\n");
    process.exit(1);
  }

  const counts = await stats();

  const server = app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
    console.log(
      `[api] postgres ${databaseLabel()}`,
    );
    console.log(
      `[api] ${counts.products} products, ${counts.variants} variants, ${counts.orders} orders`,
    );
    console.log(
      adminEnabled()
        ? "[api] admin dashboard enabled at /api/admin"
        : "[api] admin dashboard DISABLED — set ADMIN_PASSWORD to switch it on",
    );
  });

  // A busy port is the most common way to fail to start this, and Node's
  // default is an unhandled 'error' event and twenty lines of stack.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n[api] Port ${PORT} is already in use.`);
      console.error(
        "[api] Another copy of the API is probably already running.",
      );
      console.error(
        "[api] Either use the one that is running, stop it, or start this one",
      );
      console.error(
        `[api] on a different port:  PORT=${PORT + 1} npm run api\n`,
      );
      process.exit(1);
    }
    if (err.code === "EACCES") {
      console.error(
        `\n[api] Not allowed to listen on port ${PORT}. Pick a port above 1024.\n`,
      );
      process.exit(1);
    }
    throw err;
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

main();
