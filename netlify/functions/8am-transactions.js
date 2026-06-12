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

  // AffiniPay uses Basic auth: secret_key as username, blank password
  const auth = Buffer.from(`${secretKey}:`).toString('base64');

  // Build query — AffiniPay supports created_gte/created_lte as ISO date strings
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

    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: data.message || data.error || `AffiniPay error ${res.status}`, raw: data })
      };
    }

    const results = data.results || data.transactions || data.data || [];
    const total   = data.total_entries || data.total || results.length;

    const payments = results.map(t => {
      const amount  = (t.amount || 0) / 100;         // AffiniPay stores in cents
      const feeAmt  = (t.fee_amount || t.fees || 0) / 100;
      const net     = amount - Math.abs(feeAmt);

      // Card holder name
      const cardName = t.account_holder_name ||
                       t.card?.cardholder_name ||
                       t.payment_method?.card?.name || '';

      // Email from billing details
      const email = t.email ||
                    t.billing_details?.email ||
                    t.customer?.email || '';

      // Description — WA sends the event name as the description
      const desc = t.description || t.reference || t.memo || '';

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
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        payments,
        total,
        offset,
        has_more: (offset + results.length) < total,
        next_offset: offset + results.length,
        count: payments.length,
      }),
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
