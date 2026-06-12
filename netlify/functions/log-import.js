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
