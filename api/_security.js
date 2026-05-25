// api/_security.js — Shared security utilities for Space MELI API handlers

// Allowed origins: production, Vercel preview URLs, and localhost
const ALLOWED_ORIGINS = [
  'https://space-meli-saas.vercel.app'
];
const PREVIEW_PATTERN = /^https:\/\/space-meli-saas-[a-z0-9-]+\.vercel\.app$/;
const LOCAL_PATTERN   = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Returns CORS headers scoped to the request origin.
 * Falls back to the production URL if origin is not in the allowlist.
 */
export function getCorsHeaders(req) {
  const origin = req.headers['origin'] || '';
  let allowedOrigin = 'https://space-meli-saas.vercel.app'; // safe default

  if (
    ALLOWED_ORIGINS.includes(origin) ||
    PREVIEW_PATTERN.test(origin) ||
    LOCAL_PATTERN.test(origin)
  ) {
    allowedOrigin = origin;
  }

  return {
    'Access-Control-Allow-Origin':  allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-License-Key, x-make-secret',
    'Vary': 'Origin'
  };
}

/**
 * Applies CORS headers from getCorsHeaders to a response object.
 */
export function applyCorsHeaders(req, res) {
  const headers = getCorsHeaders(req);
  for (const [k, v] of Object.entries(headers)) {
    res.setHeader(k, v);
  }
}

/**
 * Reads the real client IP from forwarded headers or the socket.
 */
export function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; first is the real client
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * Strips dangerous HTML characters and trims to maxLen.
 * Returns a safe string suitable for DB storage / API calls.
 */
export function sanitizeString(str, maxLen = 1000) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/</g,  '')
    .replace(/>/g,  '')
    .replace(/&/g,  '')
    .replace(/"/g,  '')
    .replace(/'/g,  '')
    .trim()
    .slice(0, maxLen);
}

/**
 * HTML-safe encoding for values injected into HTML strings.
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

/**
 * Returns false if JSON.stringify(body) exceeds maxMB megabytes.
 */
export function checkPayloadSize(body, maxMB = 5) {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    return bytes <= maxMB * 1024 * 1024;
  } catch {
    return false;
  }
}

// ── In-memory rate limiter ────────────────────────────────────────────────────
// Note: resets on serverless cold-start. Still blocks burst attacks within
// the same function instance. For multi-instance persistence use Upstash Redis.
const _rl = new Map(); // key → { count, resetAt }

/**
 * Returns true if the request should be BLOCKED (rate limit exceeded).
 * @param {string} ip      - Client IP
 * @param {string} action  - Unique bucket name (e.g. 'validate', 'ai')
 * @param {number} max     - Max requests allowed in the window
 * @param {number} windowMs - Window in milliseconds (default 60 seconds)
 */
export function isRateLimited(ip, action, max, windowMs = 60_000) {
  const key = `${action}:${ip}`;
  const now = Date.now();
  const entry = _rl.get(key);

  if (!entry || now >= entry.resetAt) {
    _rl.set(key, { count: 1, resetAt: now + windowMs });
    return false; // first request in window → allow
  }

  entry.count++;
  if (entry.count > max) return true; // blocked
  return false;
}
