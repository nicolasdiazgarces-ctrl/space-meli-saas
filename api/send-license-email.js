// api/send-license-email.js — Vercel Serverless Function
// Called by Make.com after Supabase license creation to send the welcome email.
// Requires env var: RESEND_API_KEY  (free at resend.com — 3,000 emails/month)
// Requires env var: MAKE_SECRET     (shared secret with Make.com to authenticate calls)

import { applyCorsHeaders, sanitizeString, escapeHtml } from './_security.js';

export default async function handler(req, res) {
  // ── CORS (fix #1: allowlist instead of *) ─────────────────────────────────
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── fix #3: Authenticate Make.com requests with shared secret ─────────────
  const makeSecret = process.env.MAKE_SECRET;
  if (makeSecret) {
    // Only enforce if MAKE_SECRET is set (backward compat during initial deploy)
    const incoming = req.headers['x-make-secret'];
    if (!incoming || incoming !== makeSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // fix #7: sanitize all inputs
  const to   = sanitizeString((req.body?.to   || ''), 254);
  const key  = sanitizeString((req.body?.key  || ''), 60);
  const plan = sanitizeString((req.body?.plan || ''), 20);

  if (!to || !key) {
    return res.status(400).json({ error: 'Missing required fields: to, key' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[SpaceMELI/send-license-email] RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'Error interno del servidor' });
  }

  const expiresLabel = plan === 'yearly' ? '12 meses' : '30 días';

  // Use escapeHtml() on any user-supplied values injected into the HTML (fix #8 / defense-in-depth)
  const safeKey = escapeHtml(key);
  const safeTo  = escapeHtml(to);

  const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
  <h2 style="color:#7c3aed;margin-bottom:8px">🚀 ¡Bienvenido a Space MELI!</h2>
  <p style="color:#374151;margin-bottom:24px">Tu pago fue procesado exitosamente. Acá está tu clave de licencia:</p>

  <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
    <p style="color:#6b7280;font-size:13px;margin:0 0 8px">TU CLAVE DE LICENCIA</p>
    <code style="font-size:22px;font-weight:bold;letter-spacing:3px;color:#1f2937">${safeKey}</code>
  </div>

  <h3 style="color:#374151">¿Cómo activarla?</h3>
  <ol style="color:#374151;padding-left:20px;line-height:1.8">
    <li>Abrí <a href="https://space-meli-saas.vercel.app" style="color:#7c3aed;font-weight:bold">Space MELI</a></li>
    <li>Click en ⚙️ <strong>Configuración</strong></li>
    <li>Pegá el código en <strong>Clave de licencia</strong> y guardá ✅</li>
  </ol>

  <div style="background:#ecfdf5;border-left:4px solid #10b981;padding:14px 16px;border-radius:4px;margin:24px 0">
    ✅ Tu licencia es válida por <strong>${expiresLabel}</strong>
  </div>

  <p style="color:#9ca3af;font-size:12px;margin-top:32px">
    ¿Problemas con tu licencia? Respondé este email y te ayudamos.
  </p>
</div>
`;

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from:    'Space MELI <onboarding@resend.dev>',
        to:      [safeTo],
        subject: `🚀 Tu licencia de Space MELI — ${safeKey}`,
        html
      })
    });

    const result = await emailRes.json();

    if (!emailRes.ok) {
      // fix #8: log real error, generic message to client
      console.error('[SpaceMELI/send-license-email] Resend error:', result);
      return res.status(502).json({ error: 'Error interno del servidor' });
    }

    return res.json({ ok: true, id: result.id, to: safeTo, key: safeKey });

  } catch (err) {
    // fix #8: log real error, generic message to client
    console.error('[SpaceMELI/send-license-email] Error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
