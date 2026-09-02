import { createClient } from '@supabase/supabase-js';

async function getGoogleAccessToken() {
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

export async function handler() {
  try {
    const accessToken = await getGoogleAccessToken();

    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const url = new URL(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events'
    );
    url.searchParams.set('timeMin', now.toISOString());
    url.searchParams.set('timeMax', weekOut.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '25');

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify(data) };
    }

    const events = (data.items || []).map((e) => ({
      id: e.id,
      title: e.summary,
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      source: 'google',
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
