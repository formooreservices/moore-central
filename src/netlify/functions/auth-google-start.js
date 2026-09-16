// GET /.netlify/functions/auth-google-start
// Redirects the browser to Google's consent screen for Calendar read access.

export async function handler() {
  const { GOOGLE_CLIENT_ID, SITE_URL } = process.env;

  const redirectUri = `${SITE_URL}/.netlify/functions/auth-google-callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set(
    'scope',
    'https://www.googleapis.com/auth/calendar.readonly'
  );
  authUrl.searchParams.set('state', 'moorecentral-google-login');

  return {
    statusCode: 302,
    headers: { Location: authUrl.toString() },
  };
}
