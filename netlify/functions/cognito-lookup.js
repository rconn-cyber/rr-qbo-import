// netlify/functions/cognito-lookup.js
// Looks up a Cognito Forms entry by form ID + entry number to get member name/number.
// Set COGNITO_API_KEY in Netlify environment variables.
// Query params: formId (e.g. "204"), entryId (e.g. "7")
//
// Get your Cognito API key from:
// cognitoforms.com → Account → API Keys

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

    // Extract the fields we need
    const firstName  = entry.FirstName  || entry.Name?.First  || '';
    const lastName   = entry.LastName   || entry.Name?.Last   || '';
    const memberNo   = entry.MemberNo   || entry.MemberNumber || entry.MemberNum || '';
    const email      = entry.EMail      || entry.Email        || '';
    const fullName   = [firstName, lastName].filter(Boolean).join(' ').trim();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ fullName, firstName, lastName, memberNo, email, formId, entryId }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
