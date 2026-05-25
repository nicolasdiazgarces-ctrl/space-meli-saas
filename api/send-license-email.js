// api/send-license-email.js — Vercel Serverless Function
// Called by Make.com after Supabase license creation to send the welcome email.
// Requires env var: RESEND_API_KEY  (free at resend.com — 3,000 emails/month)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-make-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, key, plan } = req.body || {};

  if (!to || !key) {
    return res.status(400).json({ error: 'Missing required fields: to, key' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const expiresLabel = plan === 'yearly' ? '12 meses' : '30 días';

  const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
  <h2 style="color:#7c3aed;margin-bottom:8px">🚀 ¡Bienvenido a Space MELI!</h2>
  <p style="color:#374151;margin-bottom:24px">Tu pago fue procesado exitosamente. Acá está tu clave de licencia:</p>

  <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
    <p style="color:#6b7280;font-size:13px;margin:0 0 8px">TU CLAVE DE LICENCIA</p>
    <code style="font-size:22px;font-weight:bold;letter-spacing:3px;color:#1f2937">${key}</code>
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
        from: 'Space MELI <onboarding@resend.dev>',
        to: [to],
        subject: `🚀 Tu licencia de Space MELI — ${key}`,
        html
      })
    });

    const result = await emailRes.json();

    if (!emailRes.ok) {
      console.error('Resend error:', result);
      return res.status(502).json({ error: 'Email delivery failed', details: result });
    }

    return res.json({ ok: true, id: result.id, to, key });
  } catch (err) {
    console.error('Send error:', err);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
