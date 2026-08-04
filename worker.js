/**
 * MDM Depot Assistant — Gemini proxy worker
 */

const ALLOWED_ORIGIN = 'https://nexlitedigitalsolutionslimited.digital'; // ← your app's real origin
const GEMINI_MODEL_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const DAILY_CAP_PER_IP = 60;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }
    const origin = request.headers.get('Origin') || '';
    if (origin && origin !== ALLOWED_ORIGIN) {
      return json({ error: 'Origin not allowed' }, 403);
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server misconfigured: GEMINI_API_KEY secret not set' }, 500);
    }

    let bodyObj;
    try {
      bodyObj = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    if (!bodyObj || typeof bodyObj !== 'object' || !bodyObj.input) {
      return json({ error: 'Missing required field: input' }, 400);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const overCap = await isOverDailyCap(ip);
    if (overCap) {
      return json({ error: 'Daily limit reached, try again tomorrow' }, 429);
    }

    let upstream;
    try {
      upstream = await fetch(GEMINI_MODEL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify(bodyObj)
      });
    } catch (e) {
      return json({ error: 'Upstream request failed: ' + (e && e.message) }, 502);
    }

    const text = await upstream.text();
    await bumpDailyCount(ip);
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

async function _capKey(ip) {
  const day = new Date().toISOString().slice(0, 10);
  return new Request('https://mdm-copilot-proxy.internal/cap/' + ip + '/' + day);
}
async function isOverDailyCap(ip) {
  try {
    const cache = caches.default;
    const req = await _capKey(ip);
    const cached = await cache.match(req);
    if (!cached) return false;
    const count = parseInt(await cached.text(), 10) || 0;
    return count >= DAILY_CAP_PER_IP;
  } catch { return false; }
}
async function bumpDailyCount(ip) {
  try {
    const cache = caches.default;
    const req = await _capKey(ip);
    const cached = await cache.match(req);
    const count = (cached ? (parseInt(await cached.text(), 10) || 0) : 0) + 1;
    await cache.put(req, new Response(String(count), {
      headers: { 'Cache-Control': 'max-age=86400' }
    }));
  } catch { /* best-effort, ignore */ }
}
