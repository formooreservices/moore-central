// GET /.netlify/functions/auth-microsoft-start
// Redirects the browser to Microsoft's login/consent screen.
// Personal accounts (Hotmail/Outlook.com) use the "consumers" tenant.

export async function handler(event) {
  const { MS_CLIENT_ID, MS_TENANT, SITE_URL } = process.env;

  const redirectUri = `${SITE_URL}/.netlify/functions/auth-microsoft-callback`;
  const scopes = [
    'offline_access',
    'Mail.Read',
    'Calendars.Read',
    'User.Read',
  ].join(' ');

  const authUrl = new URL(
    `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize`
  );
  authUrl.searchParams.set('client_id', MS_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', scopes);
  // In production, generate a random value, store it in a short-lived
  // cookie, and verify it matches on callback to prevent CSRF.
  authUrl.searchParams.set('state', 'moorecentral-ms-login');

  return {
    statusCode: 302,
    headers: { Location: authUrl.toString() },
  };
}
