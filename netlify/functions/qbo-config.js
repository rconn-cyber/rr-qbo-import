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
        'Cache-Control': 'public, max-age=3600',
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
