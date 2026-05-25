// api/validate.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { key } = req.body || {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ valid: false, error: 'No key provided' });
  }
  const cleanKey = key.trim().toUpperCase();
  try {
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supaUrl || !supaKey) {
      return res.status(500).json({ valid: false, error: 'Server config error' });
    }
    const query = supaUrl + '/rest/v1/licenses?key=eq.' + encodeURIComponent(cleanKey) + '&select=key,email,plan,active,expires_at,img_credits_total,img_credits_used,img_credits_reset&limit=1';
    const dbRes = await fetch(query, {
      headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, 'Content-Type': 'application/json' }
    });
    if (!dbRes.ok) return res.status(502).json({ valid: false, error: 'Database error' });
    const rows = await dbRes.json();
    if (!rows || rows.length === 0) return res.json({ valid: false, error: 'Key not found' });
    const license = rows[0];
    if (!license.active) return res.json({ valid: false, error: 'License deactivated' });
    if (license.expires_at && new Date(license.expires_at) < new Date()) return res.json({ valid: false, error: 'License expired' });
    fetch(supaUrl + '/rest/v1/licenses?key=eq.' + encodeURIComponent(cleanKey), {
      method: 'PATCH',
      headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ last_validated_at: new Date().toISOString() })
    }).catch(() => {});
    // Calcular créditos (con reset mensual automático)
    const imgTotal = license.img_credits_total ?? 50;
    let imgUsed    = license.img_credits_used  ?? 0;
    const resetAt  = license.img_credits_reset ? new Date(license.img_credits_reset) : null;
    if (resetAt && new Date() >= resetAt) imgUsed = 0; // reset visual (el reset real ocurre en generate-image)

    return res.json({
      valid: true,
      email: license.email,
      plan: license.plan,
      expires_at: license.expires_at,
      img_credits_total: imgTotal,
      img_credits_left:  Math.max(0, imgTotal - imgUsed)
    });
  } catch (err) {
    return res.status(500).json({ valid: false, error: 'Server error' });
  }
}
