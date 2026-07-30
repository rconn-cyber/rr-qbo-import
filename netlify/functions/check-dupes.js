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
// netlify/functions/check-dupes.js
// Accepts array of transaction IDs, returns which ones are already in qbo_import_log.
// Called when user opens Export modal — flags already-exported rows before download.

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

  const { txnIds = [] } = body;
  if (!txnIds.length) {
    return { statusCode: 200, body: JSON.stringify({ duplicates: [], details: [] }) };
  }

  // Query qbo_import_log for any of these transaction IDs
  // Supabase: use `in` filter with comma-separated values
  const idList = txnIds.map(id => `"${id}"`).join(',');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/qbo_import_log?select=transaction_id,platform,transaction_date,amount,customer_name,qbo_account,exported_at,exported_by&transaction_id=in.(${txnIds.join(',')})`,
    {
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      },
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return { statusCode: 500, body: JSON.stringify({ error: `Supabase query error: ${err.substring(0, 300)}` }) };
  }

  const rows = await res.json();
  const duplicateIds = new Set((rows || []).map(r => r.transaction_id));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      duplicates: Array.from(duplicateIds),
      details:    rows || [],   // full rows so UI can show when it was last exported
    }),
  };
};
