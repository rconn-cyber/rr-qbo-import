// netlify/functions/square-transactions.js
// Proxies Square Payments API to avoid CORS.
// Set SQUARE_ACCESS_TOKEN in Netlify environment variables.
// Query params: start (YYYY-MM-DD), end (YYYY-MM-DD), cursor (optional)

exports.handler = async function(event) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'SQUARE_ACCESS_TOKEN not configured in Netlify environment variables.' })
    };
  }

  const params = event.queryStringParameters || {};
  const start  = params.start;
  const end    = params.end;
  const cursor = params.cursor || null;

  if (!start || !end) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'start and end query params required (YYYY-MM-DD)' })
    };
  }

  const beginTime = `${start}T00:00:00.000Z`;
  const endTime   = `${end}T23:59:59.999Z`;

  const url = new URL('https://connect.squareup.com/v2/payments');
  url.searchParams.set('begin_time', beginTime);
  url.searchParams.set('end_time',   endTime);
  url.searchParams.set('sort_order', 'ASC');
  url.searchParams.set('limit',      '100');
  if (cursor) url.searchParams.set('cursor', cursor);

  try {
    const squareRes = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Square-Version': '2024-01-18',
        'Content-Type':   'application/json',
      },
    });

    const data = await squareRes.json();

    if (!squareRes.ok) {
      return {
        statusCode: squareRes.status,
        body: JSON.stringify({ error: data.errors?.[0]?.detail || 'Square API error', raw: data })
      };
    }

    // Normalize into CSV-equivalent shape the HTML already knows how to parse
    const payments = (data.payments || []).map(p => {
      const amount  = (p.amount_money?.amount         || 0) / 100;
      const feeAmt  = (p.processing_fee?.[0]?.amount_money?.amount || 0) / 100;
      const absFee  = Math.abs(feeAmt);
      const net     = amount - absFee;
      const cardName = p.card_details?.card?.cardholder_name || '';
      const desc    = p.note || 'Square payment';
      return {
        date:           (p.created_at || '').substring(0, 10),
        description:    desc,
        customer_name:  cardName,
        customer_email: p.buyer_email_address || '',
        gross_sales:    amount.toFixed(2),
        fees:           (-absFee).toFixed(2),
        net_total:      net.toFixed(2),
        location:       p.location_id || '',
        payment_id:     p.id || '',
        status:         p.status || '',
        source:         p.source_type || '',
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ payments, cursor: data.cursor || null, count: payments.length }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
