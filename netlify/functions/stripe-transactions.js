// netlify/functions/stripe-transactions.js
// Fetches Stripe charges with line item detail from associated Checkout Sessions.
// Line items are used to build a richer description/memo for QBO import.

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeGet(path, key) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { 'Authorization': `Bearer ${key}`, 'Stripe-Version': '2024-06-20' }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${path} failed: ${res.status}`);
  return data;
}

async function getLineItems(paymentIntentId, key) {
  try {
    // Find checkout session for this payment intent
    const sessions = await stripeGet(
      `/checkout/sessions?payment_intent=${paymentIntentId}&limit=1&expand[]=data.line_items`,
      key
    );
    const session = sessions.data?.[0];
    if (!session) return null;

    const items = session.line_items?.data || [];
    if (!items.length) return null;

    // Build summary string: "VIP Tent ($1,500) · Breakfast ($750)"
    const summary = items.map(item => {
      const name = item.description || item.price?.product?.name || 'Item';
      const amt  = ((item.amount_total || 0) / 100).toFixed(2);
      return `${name} ($${parseFloat(amt).toLocaleString('en-US', {minimumFractionDigits:2})})`;
    }).join(' · ');

    return {
      summary,
      items: items.map(i => ({
        name: i.description || '',
        qty:  i.quantity || 1,
        amount: ((i.amount_total || 0) / 100).toFixed(2),
      }))
    };
  } catch (e) {
    console.warn(`Could not fetch line items for ${paymentIntentId}:`, e.message);
    return null;
  }
}

exports.handler = async function(event) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { statusCode: 500, body: JSON.stringify({ error: 'STRIPE_SECRET_KEY not set' }) };

  const params  = event.queryStringParameters || {};
  const start   = params.start;
  const end     = params.end;
  const after   = params.starting_after || null;

  if (!start || !end) return { statusCode: 400, body: JSON.stringify({ error: 'start and end required (YYYY-MM-DD)' }) };

  const startTs = Math.floor(new Date(`${start}T00:00:00.000Z`).getTime() / 1000);
  const endTs   = Math.floor(new Date(`${end}T23:59:59.999Z`).getTime()   / 1000);

  const url = new URL(`${STRIPE_API}/charges`);
  url.searchParams.set('created[gte]', startTs);
  url.searchParams.set('created[lte]', endTs);
  url.searchParams.set('limit', '100');
  url.searchParams.set('expand[]', 'data.balance_transaction');
  if (after) url.searchParams.set('starting_after', after);

  try {
    const res  = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${key}`, 'Stripe-Version': '2024-06-20' }
    });
    const data = await res.json();
    if (!res.ok) return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message, raw: data }) };

    const charges = (data.data || []).filter(c => c.status === 'succeeded' && !c.refunded);

    // Fetch line items for all charges in parallel
    const lineItemResults = await Promise.allSettled(
      charges.map(c => c.payment_intent ? getLineItems(c.payment_intent, key) : Promise.resolve(null))
    );

    const payments = charges.map((c, i) => {
      const amount   = (c.amount || 0) / 100;
      const feeAmt   = (c.balance_transaction?.fee || 0) / 100;
      const net      = amount - feeAmt;

      const cardName = c.billing_details?.name || c.payment_method_details?.card?.name || '';
      const email    = c.billing_details?.email || c.receipt_email || '';
      const desc     = c.description || '';
      const stmt     = c.statement_descriptor || c.statement_descriptor_suffix || '';

      // Line items from checkout session
      const lineData = lineItemResults[i].status === 'fulfilled' ? lineItemResults[i].value : null;

      // Build enhanced description:
      // If we have line items, use them; otherwise fall back to charge description
      let enhancedDesc = desc;
      if (lineData?.summary) {
        enhancedDesc = lineData.summary;
      }

      return {
        date:           new Date(c.created * 1000).toISOString().substring(0, 10),
        description:    enhancedDesc,
        description_raw: desc,           // original charge description kept for matching
        customer_name:  cardName,
        customer_email: email,
        gross_sales:    amount.toFixed(2),
        fees:           (-feeAmt).toFixed(2),
        net_total:      net.toFixed(2),
        payment_id:     c.id || '',
        status:         c.status || '',
        stmt:           stmt,
        line_items:     lineData?.items || null,
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
