// POST /.netlify/functions/create-calendar-event
// Creates a Google Calendar event, typically triggered from checking
// "Calendar Item" on a CFISD email row in MooreCentral.
//
// Expected JSON body:
//   {
//     "title": "Progress Report available",
//     "description": "Dear Parents and Guardians...",
//     "date": "2026-09-05",        // required, YYYY-MM-DD
//     "time": "15:30",             // optional, HH:MM (24hr) — omit for all-day
//     "calendarId": "primary"      // optional, defaults to primary
//   }

import { getGoogleAccessToken } from './lib/googleAuth.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed.' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON.' };
  }

  const { title, description, date, time, calendarId } = body;

  if (!title || !date) {
    return { statusCode: 400, body: 'Missing required "title" or "date" field.' };
  }

  try {
    const accessToken = await getGoogleAccessToken();
    const targetCalendar = calendarId || 'primary';

    let eventPayload;
    if (time) {
      // Timed event, defaults to a 1-hour block.
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      eventPayload = {
        summary: title,
        description: description || '',
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      };
    } else {
      // All-day event.
      const nextDay = new Date(`${date}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      eventPayload = {
        summary: title,
        description: description || '',
        start: { date },
        end: { date: nextDay.toISOString().slice(0, 10) },
      };
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendar)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify(data) };
    }

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: data }),
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
