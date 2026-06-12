// netlify/functions/8am-transactions.js
// AffiniPay confirmed structure:
// Response: { page, page_size, total_entries, results[] }
// Transaction: { id, created, amount(cents), status, data{}, method{}, type, ... }

exports.handler = async function(event) {
  const secretKey = process.env.EAM_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'EAM_SECRET_KEY not configured.' }) };
  }

  const params = event.queryStringParameters || {};
  const start  = params.start;   // YYYY-MM-DD
  const end    = params.end;     // YYYY-MM-DD
  const page   = parseInt(params.page || '1');

  if (!start || !end) {
    return { statusCode: 400, body: JSON.stringify({ error: 'start and end required (YYYY-MM-DD)' }) };
  }

  const auth = Buffer.from(`${secretKey}:`).toString('base64');

  // AffiniPay uses page-based pagination and Unix timestamps for date filtering
  const startTs = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
  const endTs   = Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000);

  const url = new URL('https://api.affinipay.com/v1/transactions');
  // Try Unix timestamp filters — common AffiniPay pattern
  url.searchParams.set('created_gte', startTs.toString());
  url.searchParams.set('created_lte', endTs.toString());
  url.searchParams.set('status',      'COMPLETE');
  url.searchParams.set('page_size',   '100');
  url.searchParams.set('page',        page.toString());

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });

    const raw = await res.text();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: `AffiniPay ${res.status}: ${raw.substring(0,300)}` }) };
    }

    let data;
    try { data = JSON.parse(raw); } catch(e) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Invalid JSON', raw: raw.substring(0,200) }) };
    }

    const results       = data.results || [];
    const totalEntries  = data.total_entries || 0;
    const pageSize      = data.page_size || 100;
    const currentPage   = data.page || page;
    const hasMore       = (currentPage * pageSize) < totalEntries;

    // Filter by date client-side as a safety net since API date filters may not work
    const startDate = new Date(`${start}T00:00:00Z`);
    const endDate   = new Date(`${end}T23:59:59Z`);

    const filtered = results.filter(t => {
      if (!t.created) return true; // include if no date
      const d = new Date(t.created);
      return d >= startDate && d <= endDate;
    });

    const payments = filtered.map(t => {
      const amount   = (t.amount || 0) / 100;
      const refunded = (t.amount_refunded || 0) / 100;
      const net      = amount - refunded;

      // method contains card info
      const method   = t.method || {};
      const cardName = method.name || method.account_holder_name || method.cardholder_name || '';
      const email    = method.email || '';

      // data contains description/reference from WA
      const dataObj  = t.data || {};
      // Expose ALL data keys for debugging
      const desc     = dataObj.description || dataObj.reference || dataObj.memo ||
                       dataObj.note || dataObj.invoice_number || dataObj.custom_fields ||
                       t.description || t.reference || '';

      return {
        date:           (t.created || '').substring(0, 10),
        description:    typeof desc === 'string' ? desc : JSON.stringify(desc),
        customer_name:  cardName,
        customer_email: email,
        gross_sales:    amount.toFixed(2),
        fees:           '0.00',
        net_total:      net.toFixed(2),
        payment_id:     t.id || '',
        status:         t.status || '',
        _data_keys:     Object.keys(dataObj).join(',') || 'empty',
        _method_keys:   Object.keys(method).join(',') || 'empty',
        _data_sample:   JSON.stringify(dataObj).substring(0, 200),
        _method_sample: JSON.stringify(method).substring(0, 200),
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        payments,
        total:      totalEntries,
        page:       currentPage,
        has_more:   hasMore,
        next_page:  hasMore ? currentPage + 1 : null,
        count:      payments.length,
        _debug: {
          top_keys:         Object.keys(data).join(','),
          total_entries:    totalEntries,
          current_page:     currentPage,
          page_size:        pageSize,
          returned:         results.length,
          filtered:         filtered.length,
          has_more:         hasMore,
          sample_data_keys:   results[0] ? Object.keys(results[0].data || {}).join(',') : 'none',
          sample_method_keys: results[0] ? Object.keys(results[0].method || {}).join(',') : 'none',
          sample_data:        results[0] ? JSON.stringify(results[0].data || {}).substring(0,300) : 'none',
          sample_method:      results[0] ? JSON.stringify(results[0].method || {}).substring(0,200) : 'none',
          sample_created:     results[0]?.created || 'none',
          url_used:           url.toString().replace(secretKey, '[KEY]'),
        }
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
