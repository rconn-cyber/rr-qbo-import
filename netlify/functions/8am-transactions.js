// netlify/functions/8am-transactions.js
// Fetches AffiniPay/8am transactions for Wild Apricot event payments.
// Set EAM_SECRET_KEY in Netlify environment variables.
// Query params: start (YYYY-MM-DD), end (YYYY-MM-DD), offset (pagination, optional)

exports.handler = async function(event) {
  const secretKey = process.env.EAM_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'EAM_SECRET_KEY not configured.' }) };
  }

  const params = event.queryStringParameters || {};
  const start  = params.start;
  const end    = params.end;
  const offset = parseInt(params.offset || '0');

  if (!start || !end) {
    return { statusCode: 400, body: JSON.stringify({ error: 'start and end required (YYYY-MM-DD)' }) };
  }

  const auth = Buffer.from(`${secretKey}:`).toString('base64');

  const url = new URL('https://api.affinipay.com/v1/transactions');
  url.searchParams.set('created_gte', `${start}T00:00:00Z`);
  url.searchParams.set('created_lte', `${end}T23:59:59Z`);
  url.searchParams.set('status',      'COMPLETE');
  url.searchParams.set('limit',       '100');
  if (offset) url.searchParams.set('offset', offset.toString());

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      }
    });

    const raw = await res.text();

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: `AffiniPay error ${res.status}: ${raw.substring(0,300)}` })
      };
    }

    let data;
    try { data = JSON.parse(raw); }
    catch(e) { return { statusCode: 500, body: JSON.stringify({ error: 'Invalid JSON from AffiniPay', raw: raw.substring(0,300) }) }; }

    // Log the response structure so we can see exactly what AffiniPay returns
    const topKeys = Object.keys(data);
    console.log('AffiniPay response keys:', topKeys);
    console.log('AffiniPay response (truncated):', JSON.stringify(data).substring(0, 500));

    const results       = data.results || data.transactions || data.data || data.charges || [];
    const totalEntries  = data.total_entries || data.total || data.count || null;
    const returnedCount = results.length;
    const nextOffset    = offset + returnedCount;
    // Only paginate if total_entries is explicitly provided and we haven't reached it
    const hasMore       = (totalEntries !== null) && (nextOffset < totalEntries) && (returnedCount === 100);

    const payments = results.map(t => {
      // AffiniPay stores amounts in cents
      const amount = typeof t.amount === 'number' ? t.amount / 100 : parseFloat(t.amount || 0);
      const feeAmt = typeof t.fee_amount === 'number' ? t.fee_amount / 100 :
                     typeof t.fees === 'number' ? t.fees / 100 : 0;
      const net    = amount - Math.abs(feeAmt);

      const cardName = t.account_holder_name || t.cardholder_name ||
                       t.card?.cardholder_name || t.payment_method?.name || '';
      const email    = t.email || t.billing_details?.email || t.customer?.email || '';
      const desc     = t.description || t.reference || t.memo || t.invoice_number || '';

      return {
        date:           (t.created_at || t.created || '').substring(0, 10),
        description:    desc,
        customer_name:  cardName,
        customer_email: email,
        gross_sales:    amount.toFixed(2),
        fees:           (-Math.abs(feeAmt)).toFixed(2),
        net_total:      net.toFixed(2),
        payment_id:     t.id || '',
        status:         t.status || '',
        // Include raw fields for debugging
        _raw_keys:      Object.keys(t).slice(0, 15).join(','),
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        payments,
        total:       totalEntries,
        offset,
        has_more:    hasMore,
        next_offset: nextOffset,
        count:       payments.length,
        _debug: {
          top_keys:     topKeys,
          total_entries: totalEntries,
          returned:     returnedCount,
          has_more:     hasMore,
        }
      }),
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
