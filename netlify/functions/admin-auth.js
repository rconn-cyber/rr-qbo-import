// netlify/functions/admin-auth.js
// Server-side password check for qbo-import-trans.
// Password stored in ADMIN_PASSWORD env var — never in client code.
// Returns a signed 8-hour session token on success.

const crypto = require('crypto');

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': 'https://qbo-import-trans.netlify.app',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function makeToken(secret) {
  const expires = Date.now() + TOKEN_TTL_MS;
  const sig = crypto.createHmac('sha256', secret).update(String(expires)).digest('hex');
  return `${expires}.${sig}`;
}

// Exported so other functions can call verifyToken(token, process.env.ADMIN_PASSWORD)
exports.verifyToken = function (token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expires, sig] = parts;
  if (Date.now() > Number(expires)) return false;
  const expected = crypto.createHmac('sha256', secret).update(expires).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD env var not set');
    return { statusCode: 500, headers: CORS, body: 'Server misconfiguration' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: 'Invalid JSON' }; }

  const { password } = body;
  if (!password) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Password required' }) };

  const inputBuf = Buffer.from(password.trim());
  const expectedBuf = Buffer.from(adminPassword);
  let match = false;
  if (inputBuf.length === expectedBuf.length) {
    match = crypto.timingSafeEqual(inputBuf, expectedBuf);
  }

  if (!match) {
    await new Promise(r => setTimeout(r, 400));
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Incorrect password' }) };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: makeToken(adminPassword) }),
  };
};
