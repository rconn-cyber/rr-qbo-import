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
