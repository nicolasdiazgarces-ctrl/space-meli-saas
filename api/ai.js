// api/ai.js — Proxy seguro de Claude con validación de licencia
// La API key NUNCA llega al browser. Cada llamada valida la licencia contra Supabase.
// Variables de entorno necesarias: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Obtener y validar licencia ──────────────────────────────────────────
  const licenseKey = req.headers['x-license-key'];
  if (!licenseKey) return res.status(401).json({ error: 'No license key provided' });

  const supaUrl  = process.env.SUPABASE_URL;
  const supaKey  = process.env.SUPABASE_SERVICE_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;

  if (!supaUrl || !supaKey || !claudeKey) {
    console.error('[SpaceMELI/ai] Missing env vars');
    return res.status(500).json({ error: 'Server config error' });
  }

  const cleanKey = licenseKey.trim().toUpperCase();

  try {
    // Validar licencia en Supabase (igual que /api/validate)
    const dbRes = await fetch(
      `${supaUrl}/rest/v1/licenses?key=eq.${encodeURIComponent(cleanKey)}&select=active,expires_at&limit=1`,
      { headers: { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}` } }
    );

    if (!dbRes.ok) {
      console.error('[SpaceMELI/ai] Supabase error:', dbRes.status);
      return res.status(502).json({ error: 'License check failed' });
    }

    const rows = await dbRes.json();
    if (!rows?.length) return res.status(401).json({ error: 'License not found' });

    const lic = rows[0];
    if (!lic.active) return res.status(403).json({ error: 'License deactivated' });
    if (lic.expires_at && new Date(lic.expires_at) < new Date()) {
      return res.status(403).json({ error: 'License expired' });
    }

    // ── 2. Construir y enviar request a Anthropic ──────────────────────────
    const { prompt, imageB64, maxTokens = 1800, model = 'claude-opus-4-5' } = req.body || {};

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'No prompt provided' });
    }

    // Limitar tamaño para evitar abuso
    const truncatedPrompt = prompt.slice(0, 40000);
    const safeMaxTokens = Math.min(Number(maxTokens) || 1800, 4000);

    let messages;
    if (imageB64 && typeof imageB64 === 'string' && imageB64.includes('base64,')) {
      // Vision: imagen + texto
      const mime = imageB64.split(';')[0].split(':')[1] || 'image/jpeg';
      const data = imageB64.split(',')[1];
      messages = [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data } },
          { type: 'text',  text: truncatedPrompt }
        ]
      }];
    } else {
      messages = [{ role: 'user', content: truncatedPrompt }];
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: safeMaxTokens, messages })
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      console.error('[SpaceMELI/ai] Anthropic error:', aiRes.status, err);
      return res.status(aiRes.status).json({ error: err?.error?.message || `AI error ${aiRes.status}` });
    }

    const result = await aiRes.json();
    return res.json({ text: result.content?.[0]?.text || '' });

  } catch (err) {
    console.error('[SpaceMELI/ai] Error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
