// netlify/functions/8am-transactions.js
// AffiniPay confirmed field map:
//   data.custom_fields.Notes        → event name/description
//   data.custom_fields.contactName  → member name
//   data.custom_fields.contactEmail → member email
//   data.custom_fields.Invoice      → WA invoice number
//   method.name                     → cardholder name (fallback)
//   method.email                    → email (fallback)
//   amount                          → cents
//   total_entries: 12939 (all-time) — date filter via Unix ts not supported
//   Use page-based pagination + client-side date filter

exports.handler = async function(event) {
  const secretKey = process.env.EAM_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'EAM_SECRET_KEY not configured.' }) };
  }

  const params = event.queryStringParameters || {};
  const start  = params.start;
  const end    = params.end;
  const page   = parseInt(params.page || '1');

  if (!start || !end) {
    return { statusCode: 400, body: JSON.stringify({ error: 'start and end required (YYYY-MM-DD)' }) };
  }

  const auth      = Buffer.from(`${secretKey}:`).toString('base64');
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate   = new Date(`${end}T23:59:59Z`);

  const url = new URL('https://api.affinipay.com/v1/transactions');
  url.searchParams.set('status',    'COMPLETE');
  url.searchParams.set('page_size', '100');
  url.searchParams.set('page',      page.toString());

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

    const results      = data.results || [];
    const totalEntries = data.total_entries || 0;
    const pageSize     = data.page_size || 100;
    const currentPage  = data.page || page;
    const hasMore      = (currentPage * pageSize) < totalEntries;

    // Client-side date filter — AffiniPay API doesn't support date range filtering
    const filtered = results.filter(t => {
      if (!t.created) return false;
      const d = new Date(t.created);
      return d >= startDate && d <= endDate;
    });

    // If no matches on this page AND all results are older than start date,
    // we can stop paginating early (results are newest-first)
    const oldestOnPage = results.length ? new Date(results[results.length - 1].created) : null;
    const allOlderThanRange = oldestOnPage && oldestOnPage < startDate;
    // Also stop if this page is entirely in the future (shouldn't happen but safety)
    const effectiveHasMore = hasMore && !allOlderThanRange;

    const payments = filtered.map(t => {
      const amount   = (t.amount || 0) / 100;
      const refunded = (t.amount_refunded || 0) / 100;
      const net      = amount - refunded;

      // Primary: custom_fields from data object
      const cf       = t.data?.custom_fields || {};
      const notes    = cf.Notes || cf.notes || '';
      const custName = cf.contactName || cf.contact_name || t.method?.name || '';
      const email    = cf.contactEmail || cf.contact_email || t.method?.email || '';
      const invoice  = cf.Invoice || cf.invoice || '';

      // Parse event name from Notes: 'Registration for "Event Name" (date), Ticket Type'
      let desc = notes;
      const evMatch = notes.match(/Registration for ["]?([^"(]+)["]?\s*\(/i);
      if (evMatch) desc = evMatch[1].trim();
      if (!desc) desc = t.method?.name ? `WA payment - ${t.method.name}` : 'WA/8am payment';

      return {
        date:           (t.created || '').substring(0, 10),
        description:    desc,
        customer_name:  custName,
        customer_email: email,
        gross_sales:    amount.toFixed(2),
        // AffiniPay doesn't include fee in transaction object
        // Estimate: 2.9% + $0.30 per transaction (standard AffiniPay/WA rate)
        fees:           (-(Math.round((amount * 0.029 + 0.30) * 100) / 100)).toFixed(2),
        net_total:      (amount - Math.round((amount * 0.029 + 0.30) * 100) / 100).toFixed(2),
        payment_id:     t.id || '',
        status:         t.status || '',
        invoice:        invoice,
        _notes:         notes,    // keep full notes for debugging
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        payments,
        total:      totalEntries,
        page:       currentPage,
        has_more:   effectiveHasMore,
        next_page:  effectiveHasMore ? currentPage + 1 : null,
        count:      payments.length,
        all_older:  allOlderThanRange,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
