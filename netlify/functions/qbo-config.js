// netlify/functions/qbo-config.js
// Serves QBO accounts, classes, and matching rules from Supabase.
// Cached — Netlify CDN will cache for 1 hour; force-refresh by adding ?bust=1.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function query(table, select = '*', filter = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}${filter}&order=sort_order.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

exports.handler = async function () {
  try {
    const [accounts, classes, rules] = await Promise.all([
      query('qbo_accounts', '*', '&active=eq.true'),
      query('qbo_classes', '*', '&active=eq.true'),
      query('qbo_rules', '*', '&active=eq.true'),
    ]);

    // Split rules by type for easy consumption in index.html
    const general   = rules.filter(r => r.rule_type === 'general');
    const sq_item   = rules.filter(r => r.rule_type === 'sq_item');
    const sq_event  = rules.filter(r => r.rule_type === 'sq_event');
    const wa_event  = rules.filter(r => r.rule_type === 'wa_event');

    // Build customer defaults map keyed by account full_name
    const customerDefaults = {};
    accounts.forEach(a => {
      customerDefaults[a.full_name] = {
        c: a.customer_default || '',
        m: a.member_num_default || '',
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // 1hr CDN cache
      },
      body: JSON.stringify({
        accounts: accounts.map(a => a.full_name),
        classes:  classes.map(c => c.full_path),
        customerDefaults,
        rules: { general, sq_item, sq_event, wa_event },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
