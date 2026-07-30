// netlify/functions/log-export.js
// Logs each IIF/CSV export event to Supabase for audit trail.
// Called by the frontend immediately before triggering the file download.
//
// Supabase table: qbo_export_log (see log-export-setup.sql for schema)
//
// Request body:
// {
//   exportedAt:   ISO timestamp string (client-generated)
//   dateFrom:     'YYYY-MM-DD'
//   dateTo:       'YYYY-MM-DD'
//   rowCount:     number  — total transaction rows exported
//   grossTotal:   number  — sum of gross amounts
//   netTotal:     number  — sum of net amounts
//   platforms:    string[]  — e.g. ['Square', 'Stripe', '8am']
//   filename:     string  — the downloaded filename
// }

const { createClient } = require('@supabase/supabase-js');
const { guardAuth, CORS } = require('./_auth-guard');

exports.handler = async (event) => {
  const authError = guardAuth(event);
  if (authError) return authError;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    exportedAt,
    dateFrom,
    dateTo,
    rowCount,
    grossTotal,
    netTotal,
    platforms,
    filename,
  } = body;

  // Basic validation
  if (!dateFrom || !dateTo || rowCount === undefined) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Missing required fields: dateFrom, dateTo, rowCount' }),
    };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const record = {
    exported_at:  exportedAt || new Date().toISOString(),
    date_from:    dateFrom,
    date_to:      dateTo,
    row_count:    Number(rowCount) || 0,
    gross_total:  Number(grossTotal) || 0,
    net_total:    Number(netTotal) || 0,
    platforms:    Array.isArray(platforms) ? platforms.join(', ') : (platforms || ''),
    filename:     filename || '',
  };

  const { error } = await supabase
    .from('qbo_export_log')
    .insert(record);

  if (error) {
    console.error('Supabase insert error:', error);
    // Don't block the export if logging fails — just report it
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, warning: 'Export proceeded but log write failed', detail: error.message }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
