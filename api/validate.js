// api/validate.js — Vercel Serverless Function
import { applyCorsHeaders, sanitizeString, getClientIP, isRateLimited } from './_security.js';

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Rate limit: max 10 intentos por IP por minuto (anti brute-force) ──────
  const ip = getClientIP(req);
  if (isRateLimited(ip, 'validate', 10, 60_000)) {
    return res.status(429).json({ valid: false, error: 'Demasiados intentos. Esperá un minuto.' });
  }

  const { key } = req.body || {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ valid: false, error: 'No key provided' });
  }

  const cleanKey = sanitizeString(key, 60).toUpperCase();

  try {
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supaUrl || !supaKey) {
      return res.status(500).json({ valid: false, error: 'Error interno del servidor' });
    }

    const query = supaUrl + '/rest/v1/licenses?key=eq.' + encodeURIComponent(cleanKey) +
      '&select=key,email,plan,active,expires_at,img_credits_total,img_credits_used,img_credits_reset&limit=1';

    const dbRes = await fetch(query, {
      headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, 'Content-Type': 'application/json' }
    });

    if (!dbRes.ok) {
      console.error('[SpaceMELI/validate] Supabase error:', dbRes.status);
      return res.status(502).json({ valid: false, error: 'Error interno del servidor' });
    }

    const rows = await dbRes.json();
    if (!rows || rows.length === 0) return res.json({ valid: false, error: 'Key not found' });

    const license = rows[0];
    if (!license.active) return res.json({ valid: false, error: 'License deactivated' });
    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return res.json({ valid: false, error: 'License expired' });
    }

    // Fire-and-forget: update last_validated_at
    fetch(supaUrl + '/rest/v1/licenses?key=eq.' + encodeURIComponent(cleanKey), {
      method: 'PATCH',
      headers: {
        apikey: supaKey, Authorization: 'Bearer ' + supaKey,
        'Content-Type': 'application/json', Prefer: 'return=minimal'
      },
      body: JSON.stringify({ last_validated_at: new Date().toISOString() })
    }).catch(() => {});

    // Calcular créditos (con reset mensual automático)
    const imgTotal = license.img_credits_total ?? 200;
    let imgUsed    = license.img_credits_used  ?? 0;
    const resetAt  = license.img_credits_reset ? new Date(license.img_credits_reset) : null;
    if (resetAt && new Date() >= resetAt) imgUsed = 0; // reset visual

    return res.json({
      valid:             true,
      email:             license.email,
      plan:              license.plan,
      expires_at:        license.expires_at,
      img_credits_total: imgTotal,
      img_credits_left:  Math.max(0, imgTotal - imgUsed)
    });

  } catch (err) {
    // fix #8: log real error, generic message to client
    console.error('[SpaceMELI/validate] Error:', err);
    return res.status(500).json({ valid: false, error: 'Error interno del servidor' });
  }
}
