// GET /.netlify/functions/list-calendars
//
// Exposes the calendars configured in the GOOGLE_CALENDARS env var so the
// frontend can offer a "which calendar?" dropdown instead of hardcoding
// calendar names. Uses the same "Label:calendarId,Label:calendarId" format
// as get-google-events.js (see that file for the canonical parsing logic —
// duplicated here since it's a tiny, stable helper).

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

export async function handler() {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calendars: parseCalendarList() }),
  };
}
