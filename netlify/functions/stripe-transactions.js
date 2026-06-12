// netlify/functions/stripe-transactions.js
// Fetches Stripe payment intents for a date range and normalizes to the same
// shape as the Square function so the HTML can ingest both identically.
// Set STRIPE_SECRET_KEY in Netlify environment variables.
// Query params: start (YYYY-MM-DD), end (YYYY-MM-DD), starting_after (cursor, optional)

exports.handler = async function(event) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured in Netlify environment variables.' }) };
  }

  const params = event.queryStringParameters || {};
  const start  = params.start;
  const end    = params.end;
  const after  = params.starting_after || null;

  if (!start || !end) {
    return { statusCode: 400, body: JSON.stringify({ error: 'start and end required (YYYY-MM-DD)' }) };
  }

  // Convert YYYY-MM-DD to Unix timestamps
  const startTs = Math.floor(new Date(`${start}T00:00:00.000Z`).getTime() / 1000);
  const endTs   = Math.floor(new Date(`${end}T23:59:59.999Z`).getTime()   / 1000);

  // Build Stripe charges list URL
  // Using /v1/charges which includes card name, description, statement_descriptor
  const url = new URL('https://api.stripe.com/v1/charges');
  url.searchParams.set('created[gte]', startTs);
  url.searchParams.set('created[lte]', endTs);
  url.searchParams.set('limit', '100');
  url.searchParams.set('expand[]', 'data.balance_transaction');  // gets fee detail
  if (after) url.searchParams.set('starting_after', after);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Stripe-Version': '2024-06-20',
      }
    });

    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message || 'Stripe API error', raw: data }) };
    }

    const charges = (data.data || []).filter(c => c.status === 'succeeded' && !c.refunded);

    const payments = charges.map(c => {
      const amount  = (c.amount || 0) / 100;
      // Fee from expanded balance_transaction
      const feeAmt  = (c.balance_transaction?.fee || 0) / 100;
      const net     = amount - feeAmt;

      // Card name — best source for member identification
      const cardName  = c.billing_details?.name || c.payment_method_details?.card?.name || '';
      const email     = c.billing_details?.email || c.receipt_email || '';

      // Description — Cognito sends form name here
      const desc      = c.description || '';

      // Statement descriptor — contains ROUGHRIDERS-F177E216T1 pattern
      const stmt      = c.statement_descriptor || c.statement_descriptor_suffix || '';

      return {
        date:           new Date(c.created * 1000).toISOString().substring(0, 10),
        description:    desc,
        customer_name:  cardName,
        customer_email: email,
        gross_sales:    amount.toFixed(2),
        fees:           (-feeAmt).toFixed(2),
        net_total:      net.toFixed(2),
        payment_id:     c.id || '',
        status:         c.status || '',
        stmt:           stmt,
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        payments,
        has_more:       data.has_more || false,
        starting_after: charges.length ? charges[charges.length - 1].id : null,
        count:          payments.length,
      }),
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
