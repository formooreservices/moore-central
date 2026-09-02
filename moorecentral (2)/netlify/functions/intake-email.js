// POST /.netlify/functions/intake-email
// Called by a Zapier (or Make.com) webhook step whenever a Hotmail email
// matches your keyword filter. Creates a task from it automatically.
//
// Expected JSON body from Zapier's "Webhooks by Zapier" action, mapped from
// the Outlook trigger fields:
//   {
//     "subject": "Permission slip due Friday",
//     "received": "2026-09-03T14:22:00Z",   // optional, ISO date/time
//     "from": "school@example.org",          // optional
//     "keyword": "permission slip"           // optional, which filter matched
//   }

import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed.' };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTAKE_SECRET } = process.env;

  // Optional shared-secret check so random internet traffic can't write
  // tasks. Set INTAKE_SECRET in Netlify env vars and add the same value
  // as a query param on the Zapier webhook URL: ...intake-email?key=XXXX
  if (INTAKE_SECRET) {
    const providedKey = event.queryStringParameters?.key;
    if (providedKey !== INTAKE_SECRET) {
      return { statusCode: 401, body: 'Unauthorized.' };
    }
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON.' };
  }

  const { subject, received, from, keyword } = body;

  if (!subject) {
    return { statusCode: 400, body: 'Missing "subject" field.' };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const title = keyword
    ? `${subject} (matched: ${keyword})`
    : subject;

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title,
      due_date: received ? received.slice(0, 10) : null,
      source: 'email',
      assigned_to: from || null,
    })
    .select()
    .single();

  if (error) {
    return { statusCode: 500, body: `Failed to create task: ${error.message}` };
  }

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: data }),
  };
}
