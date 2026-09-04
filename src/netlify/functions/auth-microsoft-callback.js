// GET /.netlify/functions/auth-microsoft-callback?code=...
// Exchanges the auth code for access + refresh tokens, saves the refresh
// token in Supabase, and redirects back to the app.

import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  const { MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT, SITE_URL,
          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  const code = event.queryStringParameters?.code;
  if (!code) {
    return { statusCode: 400, body: 'Missing authorization code.' };
  }

  const redirectUri = `${SITE_URL}/.netlify/functions/auth-microsoft-callback`;

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    }
  );

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return {
      statusCode: 502,
      body: `Microsoft token exchange failed: ${tokenData.error_description || tokenData.error}`,
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      provider: 'microsoft',
      refresh_token: tokenData.refresh_token,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    return { statusCode: 500, body: `Failed to store token: ${error.message}` };
  }

  return {
    statusCode: 302,
    headers: { Location: `${SITE_URL}/?connected=microsoft` },
  };
}
