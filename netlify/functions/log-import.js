// netlify/functions/_auth-guard.js
// Shared token verification for all QBO import functions.
// Underscore prefix means Netlify won't expose this as an endpoint.
//
// USAGE — add to the top of each function that should require auth:
//
//   const { guardAuth } = require('./_auth-guard');
//
//   exports.handler = async (event) => {
//     const authError = guardAuth(event);
//     if (authError) return authError;
//     // ... rest of function
//   };

const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': 'https://qbo-import-trans.netlify.app',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function verifyToken(token, secret) {
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
}

/**
 * Call at the top of any function handler.
 * Returns null if auth passes, or a 401/405 response object if it fails.
 */
exports.guardAuth = function guardAuth(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  const token = event.headers['x-admin-token'] || '';
  if (!verifyToken(token, process.env.ADMIN_PASSWORD)) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }
  return null; // auth passed
};

exports.CORS = CORS;
// netlify/functions/log-import.js
// Accepts array of exported transactions, inserts to qbo_import_log.
// Returns { inserted: [], duplicates: [] }
// Called after user clicks Download IIF — logs what was actually exported.

const SUPABASE_URL = 'https://qyoqyeaqacdjstvkonwx.supabase.co';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_ANON_KEY not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { transactions = [], exportedBy = 'unknown' } = body;
  if (!transactions.length) {
    return { statusCode: 200, body: JSON.stringify({ inserted: [], duplicates: [] }) };
  }

  // Build rows for insert
  const rows = transactions.map(t => ({
    platform:         t.platform,
    transaction_id:   t.txnId,           // platform-native ID (sq_pay_xxx, ch_xxx, affinipay_xxx)
    transaction_date: t.date,            // ISO date string YYYY-MM-DD
    amount:           t.gross,
    customer_name:    t.customerName,
    qbo_account:      t.acct,
    exported_by:      exportedBy,
  }));

  // Use upsert with onConflict=transaction_id to detect duplicates gracefully
  // Insert all rows, ignoring conflicts — then check which ones already existed
  const insertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/qbo_import_log`,
    {
      method: 'POST',
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(rows),
    }
  );

  if (!insertRes.ok) {
    const err = await insertRes.text();
    return { statusCode: 500, body: JSON.stringify({ error: `Supabase insert error: ${err.substring(0, 300)}` }) };
  }

  const inserted = await insertRes.json();
  const insertedIds = new Set((inserted || []).map(r => r.transaction_id));

  // Anything we tried to insert that didn't come back = duplicate
  const duplicates = transactions
    .filter(t => !insertedIds.has(t.txnId))
    .map(t => t.txnId);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inserted: Array.from(insertedIds),
      duplicates,
      insertedCount:  insertedIds.size,
      duplicateCount: duplicates.length,
    }),
  };
};
