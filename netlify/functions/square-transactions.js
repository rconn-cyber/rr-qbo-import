// netlify/functions/square-transactions.js
// Fetches Square payments + enriches with order line items for descriptions.
// Set SQUARE_ACCESS_TOKEN in Netlify environment variables.
// Query params: start (YYYY-MM-DD), end (YYYY-MM-DD), cursor (optional)

exports.handler = async function(event) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'SQUARE_ACCESS_TOKEN not configured.' })
    };
  }

  const params    = event.queryStringParameters || {};
  const start     = params.start;
  const end       = params.end;
  const cursor    = params.cursor || null;
  if (!start || !end) {
    return { statusCode: 400, body: JSON.stringify({ error: 'start and end required (YYYY-MM-DD)' }) };
  }

  const headers = {
    'Authorization':  `Bearer ${token}`,
    'Square-Version': '2024-01-18',
    'Content-Type':   'application/json',
  };

  // ── Step 1: Fetch payments ──
  const paymentsUrl = new URL('https://connect.squareup.com/v2/payments');
  paymentsUrl.searchParams.set('begin_time', `${start}T00:00:00.000Z`);
  paymentsUrl.searchParams.set('end_time',   `${end}T23:59:59.999Z`);
  paymentsUrl.searchParams.set('sort_order', 'ASC');
  paymentsUrl.searchParams.set('limit',      '100');
  if (cursor) paymentsUrl.searchParams.set('cursor', cursor);

  let paymentsData;
  try {
    const res = await fetch(paymentsUrl.toString(), { method: 'GET', headers });
    paymentsData = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: paymentsData.errors?.[0]?.detail || 'Square payments error' }) };
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }

  const rawPayments = (paymentsData.payments || []).filter(p => p.status === 'COMPLETED');

  // ── Step 2: Batch fetch orders for line item descriptions ──
  // Collect order IDs from payments
  const orderIds = [...new Set(rawPayments.map(p => p.order_id).filter(Boolean))];
  const orderMap = {};  // orderId → { lineItems, customerName }

  if (orderIds.length > 0) {
    // Square batch retrieve orders — up to 100 at a time
    try {
      const orderRes = await fetch('https://connect.squareup.com/v2/orders/batch-retrieve', {
        method: 'POST',
        headers,
        body: JSON.stringify({ order_ids: orderIds.slice(0, 100) }),
      });
      const orderData = await orderRes.json();
      (orderData.orders || []).forEach(order => {
        // Build description from line items
        const items = (order.line_items || []).map(li => {
          const qty  = parseFloat(li.quantity) || 1;
          const name = li.name || li.variation_name || '';
          return qty > 1 ? `${qty} x ${name}` : name;
        }).filter(Boolean);

        // Customer name from fulfillments or customer_id lookup (best effort)
        const custName = order.fulfillments?.[0]?.pickup_details?.recipient?.display_name || '';

        orderMap[order.id] = {
          desc:     items.join(', ') || '',
          custName: custName,
        };
      });
    } catch (e) {
      // Order fetch failed — continue with payment-level data only
      console.error('Order batch fetch failed:', e.message);
    }
  }

  // ── Step 3: Normalize payments ──
  const payments = rawPayments.map(p => {
    const amount = (p.amount_money?.amount || 0) / 100;
    const feeAmt = (p.processing_fee?.[0]?.amount_money?.amount || 0) / 100;
    const absFee = Math.abs(feeAmt);
    const net    = amount - absFee;

    // Card name from payment details
    const cardName  = p.card_details?.card?.cardholder_name || '';
    const buyerEmail = p.buyer_email_address || '';

    // Description: prefer order line items, fall back to note, then payment source
    const order = orderMap[p.order_id] || {};
    const desc  = order.desc || p.note || '';

    // Customer name: prefer Square register customer, then card name
    const custName = order.custName || cardName || '';

    return {
      date:           (p.created_at || '').substring(0, 10),
      description:    desc,
      customer_name:  custName,
      customer_email: buyerEmail,
      gross_sales:    amount.toFixed(2),
      fees:           (-absFee).toFixed(2),
      net_total:      net.toFixed(2),
      location:       p.location_id || '',
      payment_id:     p.id || '',
      status:         p.status || '',
    };
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ payments, cursor: paymentsData.cursor || null, count: payments.length }),
  };
};
