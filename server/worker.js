// Folio sign-in server (Cloudflare Worker). The app itself is served as static assets; only
// /api/* runs here (wrangler.jsonc → run_worker_first).
//
// Why: a pure web app only gets 1-hour Google tokens, so it had to show Google's sign-in window
// again and again. Here the user signs in once (Google OAuth "web server" flow); the Worker keeps
// the refresh token — AES-GCM encrypted — in an HttpOnly cookie that scripts cannot read, and
// hands the app fresh 1-hour access tokens on request. No database, nothing stored on the server.
//
// Routes:
//   GET  /api/login     → redirect to Google (once; consent screen)
//   GET  /api/callback  → code → tokens, sets the cookie, back to the app (/?login=ok|error)
//   POST /api/token     → { access_token, expires_in } or 401 { error: 'signed_out' | 'expired' }
//   POST /api/logout    → revokes the grant at Google, clears the cookie
//
// Config: vars GOOGLE_CLIENT_ID (wrangler.jsonc); secrets GOOGLE_CLIENT_SECRET and TOKEN_KEY
// (32 random bytes, base64) via `npx wrangler secret put` / `.dev.vars` locally. Never in code.
// Google docs: https://developers.google.com/identity/protocols/oauth2/web-server

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const RT_COOKIE = 'folio_rt';
const STATE_COOKIE = 'folio_state';
const YEAR = 400 * 24 * 3600; // browsers cap cookie lifetime at 400 days; renewed on every refresh

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'GET /api/login': return login(url, env);
        case 'GET /api/callback': return await callback(request, url, env);
        case 'POST /api/token': return await token(request, env);
        case 'POST /api/logout': return await logout(request, env);
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
      // html_handling "none" (wrangler.jsonc) serves files only by their exact name, so the start
      // page "/" (also "/?login=ok") is answered with index.html here.
      if (url.pathname === '/') return env.ASSETS.fetch(new Request(new URL('/index.html', url), { headers: request.headers }));
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: 'server', message: String(err?.message || err) }, 500);
    }
  },
};

// ---------- routes ----------

function login(url, env) {
  const state = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: url.origin + '/api/callback',
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // → refresh token
    prompt: 'consent',      // Google returns a refresh token only with a fresh consent
    state,
  });
  const hint = url.searchParams.get('hint');
  if (hint) q.set('login_hint', hint);
  return new Response(null, {
    status: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q,
      'Set-Cookie': cookie(STATE_COOKIE, state, { maxAge: 600, sameSite: 'Lax' }), // Lax: must come back with Google's redirect
      'Cache-Control': 'no-store',
    },
  });
}

async function callback(request, url, env) {
  const back = (status, reason) => {
    const h = new Headers({ Location: '/?login=' + status + (reason ? '&reason=' + encodeURIComponent(reason) : ''), 'Cache-Control': 'no-store' });
    h.append('Set-Cookie', cookie(STATE_COOKIE, '', { maxAge: 0, sameSite: 'Lax' }));
    return { h, res: () => new Response(null, { status: 302, headers: h }) };
  };
  const state = url.searchParams.get('state');
  if (!state || state !== readCookie(request, STATE_COOKIE)) return back('error', 'state').res();
  const err = url.searchParams.get('error');
  if (err) return back('error', err).res(); // e.g. access_denied
  const code = url.searchParams.get('code');
  if (!code) return back('error', 'no_code').res();

  const r = await google('https://oauth2.googleapis.com/token', {
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: url.origin + '/api/callback',
    grant_type: 'authorization_code',
  });
  if (!r.ok) return back('error', r.body.error || 'exchange').res();
  if (!r.body.refresh_token) return back('error', 'no_refresh_token').res();
  const b = back('ok');
  b.h.append('Set-Cookie', cookie(RT_COOKIE, await seal(r.body.refresh_token, env), { maxAge: YEAR }));
  return b.res();
}

async function token(request, env) {
  if (!fromApp(request)) return json({ error: 'forbidden' }, 403);
  const rt = await unseal(readCookie(request, RT_COOKIE), env);
  if (!rt) return json({ error: 'signed_out' }, 401, clearRt());
  const r = await google('https://oauth2.googleapis.com/token', {
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: rt,
    grant_type: 'refresh_token',
  });
  // invalid_grant: revoked at Google, unused for 6 months, … → sign in again
  if (!r.ok && r.body.error === 'invalid_grant') return json({ error: 'expired' }, 401, clearRt());
  if (!r.ok) return json({ error: 'google', status: r.status }, 502);
  // The docs don't promise rotation; if Google ever sends a new refresh token, keep it.
  const headers = new Headers();
  headers.append('Set-Cookie', cookie(RT_COOKIE, await seal(r.body.refresh_token || rt, env), { maxAge: YEAR }));
  return json({ access_token: r.body.access_token, expires_in: r.body.expires_in }, 200, headers);
}

async function logout(request, env) {
  if (!fromApp(request)) return json({ error: 'forbidden' }, 403);
  const rt = await unseal(readCookie(request, RT_COOKIE), env);
  // Revoking the refresh token ends Folio's access to Drive at Google (also the 1-hour tokens).
  if (rt) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }).catch(() => {});
  return json({ ok: true }, 200, clearRt());
}

// ---------- helpers ----------

// Only the app's own scripts: same origin (browsers send Origin on POST) plus a custom header,
// which a plain form or a foreign page cannot send without CORS (and there is no CORS here).
function fromApp(request) {
  const origin = request.headers.get('Origin');
  return request.headers.get('X-Folio') === '1' && (!origin || origin === new URL(request.url).origin);
}

async function google(endpoint, params) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  let body = {};
  try { body = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, body };
}

function json(data, status = 200, headers = new Headers()) {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

function clearRt() {
  const h = new Headers();
  h.append('Set-Cookie', cookie(RT_COOKIE, '', { maxAge: 0 }));
  return h;
}

// Path=/api: the cookie never goes along with app files. Secure works on http://localhost too.
function cookie(name, value, { maxAge, sameSite = 'Strict' }) {
  return `${name}=${value}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}

function readCookie(request, name) {
  const all = request.headers.get('Cookie') || '';
  for (const part of all.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// AES-GCM with TOKEN_KEY: the cookie holds iv (12 bytes) + ciphertext, base64url.
async function key(env) {
  const raw = Uint8Array.from(atob(env.TOKEN_KEY), c => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(text, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64u(out);
}
async function unseal(value, env) {
  if (!value) return '';
  try {
    const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await key(env), bytes.slice(12));
    return new TextDecoder().decode(pt);
  } catch { return ''; } // tampered, or sealed with an old key → treat as signed out
}
function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
