// Exchanges the stored Microsoft refresh token for a short-lived access
// token. Call this at the top of any function that needs to hit Graph.

import { createClient } from '@supabase/supabase-js';

export async function getMicrosoftAccessToken() {
  const { MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT,
          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('refresh_token')
    .eq('provider', 'microsoft')
    .single();

  if (error || !data) {
    throw new Error('No stored Microsoft refresh token. Connect the account first.');
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: 'refresh_token',
        scope: 'offline_access Mail.Read Calendars.Read User.Read',
      }),
    }
  );

  const tokenData = await res.json();
  if (!res.ok) {
    throw new Error(tokenData.error_description || 'Token refresh failed.');
  }

  // Microsoft rotates refresh tokens on use — save the new one.
  if (tokenData.refresh_token) {
    await supabase
      .from('oauth_tokens')
      .upsert({
        provider: 'microsoft',
        refresh_token: tokenData.refresh_token,
        updated_at: new Date().toISOString(),
      });
  }

  return tokenData.access_token;
}
