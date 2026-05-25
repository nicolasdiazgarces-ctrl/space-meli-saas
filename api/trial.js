// api/trial.js — Crea una licencia de prueba gratuita (1 día, 5 créditos imagen)
// Cada email solo puede tener UNA licencia (trial o paga). Captura el lead automáticamente.
// Requiere env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY

import { applyCorsHeaders, getClientIP, sanitizeString } from './_security.js';

export default async function handler(req, res) {
  // ── CORS (fix #1: allowlist instead of *) ─────────────────────────────────
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name } = req.body || {};

  // fix #7: sanitize inputs with appropriate maxLen values
  const cleanName  = sanitizeString(name  || '', 60);   // fix #4: maxLen 60
  const rawEmail   = sanitizeString(email || '', 254);  // fix #4: maxLen 254

  if (!rawEmail || !rawEmail.includes('@')) {
    return res.status(400).json({ error: 'Ingresá un email válido' });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supaUrl || !supaKey) return res.status(500).json({ error: 'Error interno del servidor' });

  const cleanEmail = rawEmail.trim().toLowerCase();

  // ── IP rate limiting (fix #4) ─────────────────────────────────────────────
  const clientIP = getClientIP(req);

  try {
    // Check how many trial licenses were created from this IP in the last 24 hours
    const ipCheckRes = await fetch(
      `${supaUrl}/rest/v1/licenses?plan=eq.trial&created_ip=eq.${encodeURIComponent(clientIP)}&created_at=gte.${new Date(Date.now() - 24 * 3600 * 1000).toISOString()}&select=key`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
    );

    if (ipCheckRes.ok) {
      const ipRows = await ipCheckRes.json();
      if (Array.isArray(ipRows) && ipRows.length >= 3) {
        return res.status(429).json({
          error: 'Demasiados intentos desde tu red. Intentá mañana.'
        });
      }
    }

    // ── 1. Verificar si ya existe licencia para este email ────────────────
    const checkRes = await fetch(
      `${supaUrl}/rest/v1/licenses?email=eq.${encodeURIComponent(cleanEmail)}&select=key,plan,active,expires_at&limit=1`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
    );
    const existing = await checkRes.json();

    if (existing?.length > 0) {
      const lic = existing[0];
      // Si tiene licencia paga activa, no damos trial (ya tiene acceso)
      if (lic.plan !== 'trial') {
        return res.json({ ok: true, key: lic.key, existing: true, paid: true });
      }
      // Si ya tiene trial, devolvemos la misma key (no creamos una nueva)
      return res.json({ ok: true, key: lic.key, existing: true, paid: false,
        expires_at: lic.expires_at });
    }

    // ── 2. Generar clave trial única ──────────────────────────────────────
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rand  = n => Array.from({ length: n }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    const key = `TRIAL-${rand(4)}-${rand(4)}-${rand(4)}`;

    // fix #4: change 7 days → 1 day
    const expiresAt = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString();

    // ── 3. Insertar en Supabase ───────────────────────────────────────────
    const insertRes = await fetch(`${supaUrl}/rest/v1/licenses`, {
      method: 'POST',
      headers: {
        apikey:            supaKey,
        Authorization:     `Bearer ${supaKey}`,
        'Content-Type':    'application/json',
        Prefer:            'return=minimal'
      },
      body: JSON.stringify({
        key,
        email:              cleanEmail,
        plan:               'trial',
        active:             true,
        expires_at:         expiresAt,
        img_credits_total:  5,
        img_credits_used:   0,
        created_ip:         clientIP,                          // fix #4: store IP
        notes:              `Trial automático${cleanName ? ` · ${cleanName}` : ''}`
      })
    });

    if (!insertRes.ok) {
      const errBody = await insertRes.text().catch(() => '');
      // fix #8: log real error, generic message to client
      console.error('[SpaceMELI/trial] Supabase insert error:', insertRes.status, errBody);
      return res.status(502).json({ error: 'No se pudo crear la licencia de prueba' });
    }

    return res.json({ ok: true, key, expires_at: expiresAt, email: cleanEmail });

  } catch (err) {
    // fix #8: log real error, generic message to client
    console.error('[SpaceMELI/trial] Error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
