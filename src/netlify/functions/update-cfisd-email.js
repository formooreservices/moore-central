// PATCH /.netlify/functions/update-cfisd-email
// Updates one or more fields on a cfisd_emails row — used for toggling
// Checked / Action Item / Calendar Item, or editing the category.
//
// Expected JSON body:
//   { "id": "uuid", "checked": true }
//   { "id": "uuid", "category": "Truitt" }
//   { "id": "uuid", "action_item": true, "calendar_item": false }

import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  if (event.httpMethod !== 'PATCH') {
    return { statusCode: 405, body: 'Method not allowed.' };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON.' };
  }

  const { id, ...fields } = body;
  if (!id) {
    return { statusCode: 400, body: 'Missing "id" field.' };
  }

  const { data, error } = await supabase
    .from('cfisd_emails')
    .update(fields)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return { statusCode: 500, body: error.message };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: data }),
  };
}
