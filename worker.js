/**
 * Cloudflare Worker entry for arzzos.com.
 * Routes /api/* to server logic, everything else falls through to
 * Workers Static Assets (Astro `dist/`).
 *
 * POST /api/contact — gated on Cloudflare Turnstile siteverify
 * (action "contact", hostname allowlist from env). The delivery stub
 * behind the gate stays untouched until Resend is wired.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TURNSTILE_ACTION = 'contact';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

/** Naive per-isolate rate limiter. Good enough for a contact form. */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

/**
 * Canonical Turnstile siteverify: browser → this Worker → siteverify.
 * Never call siteverify from the browser. Tokens are single-use.
 */
async function verifyTurnstile(token, remoteIp, env) {
  const expectedHostnames = new Set(
    String(env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  );
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 2048 ||
    typeof env.TURNSTILE_SECRET !== 'string' ||
    env.TURNSTILE_SECRET.length === 0 ||
    expectedHostnames.size === 0
  ) {
    return false;
  }
  let result;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: remoteIp ?? '',
      }),
    });
    if (!r.ok) return false;
    result = await r.json();
  } catch {
    return false;
  }
  return (
    result?.success === true && result.action === TURNSTILE_ACTION && expectedHostnames.has(result.hostname)
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') {
        return Response.json({ ok: false, error: 'method-not-allowed' }, { status: 405 });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: 'invalid-json' }, { status: 400 });
      }
      const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
      const email = typeof body?.email === 'string' ? body.email.trim().slice(0, 254) : '';
      const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 5000) : '';
      if (!name || !EMAIL_RE.test(email) || !message) {
        return Response.json({ ok: false, error: 'invalid-fields' }, { status: 400 });
      }
      const ip = request.headers.get('cf-connecting-ip') ?? '';
      if (rateLimited(ip || 'unknown')) {
        return Response.json({ ok: false, error: 'rate-limited' }, { status: 429 });
      }
      const token = typeof body?.turnstileToken === 'string' ? body.turnstileToken : '';
      if (!(await verifyTurnstile(token, ip, env))) {
        return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
      // Gate passed. Delivery (Resend) is still a stub — replaced in the next step.
      return Response.json({ ok: false, error: 'contact-unavailable' }, { status: 503 });
    }

    return env.ASSETS.fetch(request);
  },
};
