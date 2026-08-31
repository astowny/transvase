/**
 * Health handlers, in their own module on purpose.
 *
 * index.ts calls loadSecretsOrExit() at module scope, so importing it from a
 * test kills the test run. Anything that must be testable without the four
 * secrets present has to live outside it.
 */

export async function handleHealthz(): Promise<Response> {
  return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Uptime monitors are routinely configured to probe with HEAD. Without this
 * entry the route table has no HEAD handler, the request falls through to the
 * catch-all and answers 404 -- so the monitor reports the api down while it is
 * serving GET perfectly. A false alarm about a healthy service is worse than
 * no monitor at all, because the next real alert is the one nobody believes.
 */
export async function handleHealthzHead(): Promise<Response> {
  return new Response(null, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
