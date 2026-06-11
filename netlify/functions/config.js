// netlify/functions/config.js
// Serves Supabase config from environment variables so the key
// never needs to be hardcoded in the HTML source.
//
// Set these in Netlify → Site config → Environment variables:
//   SUPABASE_ANON_KEY   (your Supabase anon/public key)

exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      supabaseUrl: 'https://qyoqyeaqacdjstvkonwx.supabase.co',
    }),
  };
};
