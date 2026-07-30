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
// netlify/functions/qbo-config.js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function query(table, filter = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*${filter}&order=sort_order.asc,id.asc`;
  console.log(`Querying ${table}: ${url.replace(SUPABASE_URL, '[URL]')}`);
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Supabase ${table} error ${res.status}: ${text}`);
    throw new Error(`Supabase ${table}: ${res.status} — ${text}`);
  }
  return JSON.parse(text);
}

exports.handler = async function () {
  console.log('qbo-config invoked');
  console.log('SUPABASE_URL set:', !!SUPABASE_URL);
  console.log('SUPABASE_KEY set:', !!SUPABASE_KEY);

  try {
    const [accounts, classes, rules] = await Promise.all([
      query('qbo_accounts', '&active=eq.true'),
      query('qbo_classes', '&active=eq.true'),
      query('qbo_rules', '&active=eq.true'),
    ]);

    const general  = rules.filter(r => r.rule_type === 'general');
    const sq_item  = rules.filter(r => r.rule_type === 'sq_item');
    const sq_event = rules.filter(r => r.rule_type === 'sq_event');
    const wa_event = rules.filter(r => r.rule_type === 'wa_event');

    const customerDefaults = {};
    accounts.forEach(a => {
      customerDefaults[a.full_name] = {
        c: a.customer_default || '',
        m: a.member_num_default || '',
      };
    });

    console.log(`Success: ${accounts.length} accounts, ${classes.length} classes, ${rules.length} rules`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify({
        accounts: accounts.map(a => a.full_name),
        classes:  classes.map(c => c.full_path),
        customerDefaults,
        rules: { general, sq_item, sq_event, wa_event },
      }),
    };
  } catch (err) {
    console.error('qbo-config handler error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
