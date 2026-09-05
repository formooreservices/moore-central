// GET /.netlify/functions/get-cfisd-emails
// GET /.netlify/functions/get-cfisd-emails?archived=true
// Returns recent CFISD emails for the "Emails from CFISD" dashboard section.
// By default excludes archived emails; pass ?archived=true to see only
// the archived ones instead.

import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const wantArchived = event.queryStringParameters?.archived === 'true';

  const { data, error } = await supabase
    .from('cfisd_emails')
    .select('*')
    .eq('archived', wantArchived)
    .order('received_date', { ascending: false })
    .limit(200);

  if (error) {
    return { statusCode: 500, body: error.message };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails: data }),
  };
}
