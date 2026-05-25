// api/generate-image.js — Vercel Serverless Function
// Genera imágenes con Together AI (FLUX) en nombre del usuario.
// Valida licencia + descuenta créditos en Supabase.
// Requiere env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, TOGETHER_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { key, prompt, imageB64 } = req.body || {};
  if (!key || !prompt) return res.status(400).json({ error: 'Missing key or prompt' });

  const supaUrl  = process.env.SUPABASE_URL;
  const supaKey  = process.env.SUPABASE_SERVICE_KEY;
  const togetherKey = process.env.TOGETHER_API_KEY;

  if (!supaUrl || !supaKey)   return res.status(500).json({ error: 'Server config error' });
  if (!togetherKey)           return res.status(500).json({ error: 'Image service not configured' });

  const cleanKey = key.trim().toUpperCase();

  try {
    // ── 1. Validar licencia y leer créditos ───────────────────────────────
    const q = `${supaUrl}/rest/v1/licenses?key=eq.${encodeURIComponent(cleanKey)}&select=key,active,expires_at,img_credits_total,img_credits_used,img_credits_reset&limit=1`;
    const dbRes = await fetch(q, {
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
    });
    if (!dbRes.ok) return res.status(502).json({ error: 'Database error' });
    const rows = await dbRes.json();
    if (!rows?.length)  return res.status(403).json({ error: 'License not found' });

    const lic = rows[0];
    if (!lic.active)                                             return res.status(403).json({ error: 'License deactivated' });
    if (lic.expires_at && new Date(lic.expires_at) < new Date()) return res.status(403).json({ error: 'License expired' });

    const total = lic.img_credits_total ?? 50;
    let used    = lic.img_credits_used  ?? 0;

    // Reset mensual automático si corresponde
    const resetAt = lic.img_credits_reset ? new Date(lic.img_credits_reset) : null;
    let needsReset = resetAt && new Date() >= resetAt;
    if (needsReset) used = 0;

    // Costo en créditos: sin foto = 1 crédito, con foto de referencia = 3 créditos
    const costCredits = imageB64 ? 3 : 1;

    if (used + costCredits > total) {
      return res.status(402).json({
        error: 'SIN_CREDITOS',
        creditsUsed: used,
        creditsTotal: total,
        creditsLeft: Math.max(0, total - used),
        message: `Sin créditos de imagen. Usaste ${used}/${total} este mes.`
      });
    }

    // ── 2. Generar imagen con Together AI ────────────────────────────────
    let payload;
    if (imageB64) {
      // Imagen de referencia → FLUX.1-kontext-max (image-to-image)
      payload = {
        model: 'black-forest-labs/FLUX.1-kontext-max',
        prompt: `CRITICAL: Use the EXACT product from the reference image — same design, colors, materials, shape. Do NOT invent or replace the product.\n\n${prompt}\n\nREMEMBER: The product from the reference image must appear IDENTICAL in the result. Only change the scene and lighting.`,
        image_url: imageB64,
        n: 1, steps: 28, width: 1024, height: 1024,
        response_format: 'b64_json'
      };
    } else {
      // Sin referencia → FLUX.1-schnell (text-to-image, rápido y económico)
      payload = {
        model: 'black-forest-labs/FLUX.1-schnell',
        prompt, n: 1, steps: 4, width: 1024, height: 1024,
        response_format: 'b64_json'
      };
    }

    const imgRes = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${togetherKey}` },
      body: JSON.stringify(payload)
    });
    const imgData = await imgRes.json();

    if (imgRes.status === 402) return res.status(402).json({ error: 'SIN_CREDITOS', message: 'Cuenta de imágenes sin créditos (servidor)' });
    if (!imgRes.ok || imgData.error) {
      console.error('Together AI error:', imgData);
      return res.status(502).json({ error: 'Image generation failed', details: imgData.error?.message?.slice(0, 200) });
    }

    const b64 = imgData.data?.[0]?.b64_json;
    const url = imgData.data?.[0]?.url;
    if (!b64 && !url) return res.status(502).json({ error: 'No image in response' });

    // ── 3. Decrementar créditos en Supabase (fire-and-forget) ────────────
    const newUsed = used + costCredits;
    const patchBody = { img_credits_used: newUsed };
    if (needsReset) {
      // Próximo reset: 30 días desde hoy
      patchBody.img_credits_reset = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    }
    fetch(`${supaUrl}/rest/v1/licenses?key=eq.${encodeURIComponent(cleanKey)}`, {
      method: 'PATCH',
      headers: {
        apikey: supaKey, Authorization: `Bearer ${supaKey}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal'
      },
      body: JSON.stringify(patchBody)
    }).catch(() => {});

    // ── 4. Devolver imagen + estado de créditos ───────────────────────────
    const imageData = b64 ? `data:image/png;base64,${b64}` : url;
    return res.json({
      ok: true,
      image: imageData,
      creditsUsed: newUsed,
      creditsTotal: total,
      creditsLeft: total - newUsed,
      costCredits
    });

  } catch (err) {
    console.error('generate-image error:', err);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
