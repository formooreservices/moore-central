// GET /.netlify/functions/get-cfisd-emails
// Returns recent CFISD emails for the "Emails from CFISD" dashboard section.

import { createClient } from '@supabase/supabase-js';

export async function handler() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from('cfisd_emails')
    .select('*')
    .order('received_date', { ascending: false })
    .limit(50);

  if (error) {
    return { statusCode: 500, body: error.message };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails: data }),
  };
}
