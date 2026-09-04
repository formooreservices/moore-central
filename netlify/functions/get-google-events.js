import { getGoogleAccessToken } from './lib/googleAuth.js';

// Parses the GOOGLE_CALENDARS env var, formatted as:
//   "Household:primary,Dennis School:abc123@group.calendar.google.com,..."
// Falls back to just "primary" if not set, so the app still works before
// this is configured.
function parseCalendarList() {
  const raw = process.env.GOOGLE_CALENDARS;
  if (!raw) {
    return [{ label: 'Household', calendarId: 'primary' }];
  }
  return raw.split(',').map((entry) => {
    const [label, calendarId] = entry.split(':').map((s) => s.trim());
    return { label, calendarId: calendarId || label };
  });
}

async function fetchEventsForCalendar(accessToken, calendarId, label, timeMin, timeMax) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '25');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();

  if (!res.ok) {
    return { label, error: data.error?.message || 'Failed to fetch', events: [] };
  }

  const events = (data.items || []).map((e) => ({
    id: e.id,
    title: e.summary,
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    source: 'google',
    calendar: label,
  }));

  return { label, error: null, events };
}

export async function handler() {
  try {
    const accessToken = await getGoogleAccessToken();
    const calendars = parseCalendarList();

    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const results = await Promise.all(
      calendars.map((c) =>
        fetchEventsForCalendar(
          accessToken,
          c.calendarId,
          c.label,
          now.toISOString(),
          weekOut.toISOString()
        )
      )
    );

    const events = results.flatMap((r) => r.events);
    events.sort((a, b) => new Date(a.start) - new Date(b.start));

    const errors = results.filter((r) => r.error).map((r) => `${r.label}: ${r.error}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events, calendarErrors: errors }),
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
