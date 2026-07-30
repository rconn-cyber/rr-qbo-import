// netlify/functions/get-export-log.js
// Returns recent export history from qbo_export_log.
// Called by the Load History UI alongside existing import history.

const { createClient } = require('@supabase/supabase-js');
const { guardAuth, CORS } = require('./_auth-guard');

exports.handler = async (event) => {
  const authError = guardAuth(event);
  if (authError) return authError;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase
    .from('qbo_export_log')
    .select('*')
    .order('exported_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Supabase error:', error);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to load export history' }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ exports: data }),
  };
};
