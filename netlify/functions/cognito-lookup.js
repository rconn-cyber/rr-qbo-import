// netlify/functions/_auth-guard.js
// Shared token verification for all QBO import functions.
// Underscore prefix means Netlify won't expose this as an endpoint.
//
// USAGE — add to the top of each function that should require auth:
//
//   const { guardAuth } = require('./_auth-guard');
//
//   exports.handler = async (event) => {
//     const authError = guardAuth(event);
//     if (authError) return authError;
//     // ... rest of function
//   };

const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': 'https://qbo-import-trans.netlify.app',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expires, sig] = parts;
  if (Date.now() > Number(expires)) return false;
  const expected = crypto.createHmac('sha256', secret).update(expires).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Call at the top of any function handler.
 * Returns null if auth passes, or a 401/405 response object if it fails.
 */
exports.guardAuth = function guardAuth(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  const token = event.headers['x-admin-token'] || '';
  if (!verifyToken(token, process.env.ADMIN_PASSWORD)) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }
  return null; // auth passed
};

exports.CORS = CORS;
// netlify/functions/cognito-lookup.js
// Looks up a Cognito Forms entry to get member name, number, and form name for QBO categorization.
// Set COGNITO_API_KEY in Netlify environment variables.
// Query params: formId (e.g. "204"), entryId (e.g. "7")

exports.handler = async function(event) {
  const apiKey = process.env.COGNITO_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'COGNITO_API_KEY not configured.' }) };
  }

  const params  = event.queryStringParameters || {};
  const formId  = params.formId;
  const entryId = params.entryId;
  if (!formId || !entryId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'formId and entryId required' }) };
  }

  try {
    const res = await fetch(`https://www.cognitoforms.com/api/forms/${formId}/entries/${entryId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      }
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: `Cognito error ${res.status}: ${err.substring(0,200)}` }) };
    }

    const entry = await res.json();

    // Log raw entry to diagnose field mapping issues
        console.log('Cognito raw entry F'+formId+'E'+entryId+':', JSON.stringify(entry).substring(0,500));

        // Member name — check multiple possible field locations including nested sections
        const ci        = entry.ContactInformation || {};
        const firstName = entry.FirstName || entry.Name?.First || ci.Name?.First || ci.FirstName || '';
        const lastName  = entry.LastName  || entry.Name?.Last  || ci.Name?.Last  || ci.LastName  || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ').trim();

        // Member number
        const memberNo  = (entry.MemberNo || entry.MemberNumber || entry.MemberNum || ci.MemberNo || '').toString().trim();

        // Email
        const email     = entry.EMail || entry.Email || ci.Email || ci.EMail || '';

    // Form name — used to guess QBO account/class
    const formName  = entry.Form?.Name || '';
    const formInternalName = entry.Form?.InternalName || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        fullName, firstName, lastName,
        memberNo, email,
        formId, entryId,
        formName,          // e.g. "Non-Resident Member - Out of Town 2026-2027"
        formInternalName,  // e.g. "NonResidentMemberOutOfTown20262027"
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
