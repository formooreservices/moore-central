// GET /.netlify/functions/get-outlook-events
// Returns the next 7 days of events from the Hotmail/Outlook.com calendar.

import { getMicrosoftAccessToken } from './lib/msGraphAuth.js';

export async function handler() {
  try {
    const accessToken = await getMicrosoftAccessToken();

    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const url = new URL('https://graph.microsoft.com/v1.0/me/calendarview');
    url.searchParams.set('startDateTime', now.toISOString());
    url.searchParams.set('endDateTime', weekOut.toISOString());
    url.searchParams.set('$orderby', 'start/dateTime');
    url.searchParams.set('$top', '25');

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify(data) };
    }

    const events = (data.value || []).map((e) => ({
      id: e.id,
      title: e.subject,
      start: e.start.dateTime,
      end: e.end.dateTime,
      source: 'outlook',
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
