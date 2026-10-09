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

/**
 * Sends the contact message via Resend.
 * Returns 'sent' | 'failed' | 'unconfigured'. Failures are logged
 * server-side without secrets; the caller maps to client status.
 */
async function sendViaResend(name, email, message, env) {
  const to = String(env.CONTACT_TO ?? '').trim();
  const from = String(env.CONTACT_FROM ?? '').trim();
  if (typeof env.RESEND_API_KEY !== 'string' || env.RESEND_API_KEY.length === 0 || !to || !from) {
    console.error('[contact] missing RESEND_API_KEY/CONTACT_TO/CONTACT_FROM');
    return 'unconfigured';
  }
  const cleanName = name.replace(/[\r\n]+/g, ' ').slice(0, 100);
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: `Portfolio <${from}>`,
        to: [to],
        reply_to: email,
        subject: `Portfolio: mensaje de ${cleanName}`,
        text: `Nombre: ${cleanName}\nEmail: ${email}\n\n${message}`,
      }),
    });
  } catch {
    console.error('[contact] resend network error');
    return 'failed';
  }
  if (!res.ok) {
    console.error(`[contact] resend rejected: ${res.status}`);
    return 'failed';
  }
  return 'sent';
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
      // Gate passed. Deliver via Resend.
      const delivery = await sendViaResend(name, email, message, env);
      if (delivery === 'sent') {
        return Response.json({ ok: true });
      }
      if (delivery === 'unconfigured') {
        return Response.json({ ok: false, error: 'contact-unavailable' }, { status: 503 });
      }
      return Response.json({ ok: false, error: 'delivery-failed' }, { status: 502 });
    }

    return env.ASSETS.fetch(request);
  },
};
