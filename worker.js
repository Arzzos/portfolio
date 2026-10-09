/**
 * Cloudflare Worker entry for arzzos.com.
 * Routes /api/* to server logic, everything else falls through to
 * Workers Static Assets (Astro `dist/`).
 *
 * POST /api/contact — full Turnstile→Resend flow lands in
 * feature/contact-api once secrets exist. Until then: validate + 503
 * so the form degrades to WhatsApp/mailto.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      void env;
      return Response.json({ ok: false, error: 'contact-unavailable' }, { status: 503 });
    }

    return env.ASSETS.fetch(request);
  },
};
