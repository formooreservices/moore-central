// Shared helper for getting a fresh Google access token from the stored
// refresh token. Used by any function that needs to call the Google
// Calendar API.

import { createClient } from '@supabase/supabase-js';

export async function getGoogleAccessToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('refresh_token')
    .eq('provider', 'google')
    .single();

  if (error || !data) {
    throw new Error('No stored Google refresh token. Connect the account first.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const tokenData = await res.json();
  if (!res.ok) throw new Error(tokenData.error_description || 'Token refresh failed.');
  return tokenData.access_token;
}
