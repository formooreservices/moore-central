// GET /.netlify/functions/get-outlook-events?start=<iso>&end=<iso>
// Returns events from the Hotmail/Outlook.com calendar within the given
// window. Defaults to the next 7 days if start/end aren't provided.

import { getMicrosoftAccessToken } from './lib/msGraphAuth.js';

export async function handler(event) {
  try {
    const accessToken = await getMicrosoftAccessToken();

    const qs = event?.queryStringParameters || {};
    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const rangeStart = qs.start ? new Date(qs.start) : now;
    const rangeEnd = qs.end ? new Date(qs.end) : weekOut;

    const url = new URL('https://graph.microsoft.com/v1.0/me/calendarview');
    url.searchParams.set('startDateTime', rangeStart.toISOString());
    url.searchParams.set('endDateTime', rangeEnd.toISOString());
    url.searchParams.set('$orderby', 'start/dateTime');
    // Raised from 25 so wider windows (a month, YTD) aren't truncated.
    // Note: this is a single page — a very busy year could still exceed it,
    // which would need @odata.nextLink pagination to fully solve.
    url.searchParams.set('$top', '250');

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
