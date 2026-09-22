// GET /.netlify/functions/sync-gmail-emails
// Also runs automatically on a schedule (see netlify.toml).
//
// Replaces the old Make.com "watch Outlook inbox" step: reads messages
// directly from Gmail (forward your CFISD emails to Gmail), categorizes
// them with the same logic as intake-email.js, and stores new ones into
// cfisd_emails. Safe to run repeatedly — already-synced messages are
// skipped via their unique Gmail message id.
//
// IMPORTANT: this does NOT rely on a fixed rolling time window (like
// "check the last 2 days") to decide what's new. A fixed window silently
// loses mail if the function doesn't run for longer than that window —
// which is exactly what happened when the scheduled trigger wasn't
// actually active for several days. Instead, it stores the timestamp of
// the newest message it has successfully processed (in the sync_state
// table) and always queries everything after that point, however long
// it's been. The very first run (no stored cursor yet) falls back to
// GMAIL_SYNC_QUERY_INITIAL, then switches to cursor-based queries after.
//
// Configure in Netlify env vars:
//   GMAIL_SYNC_SENDER_FILTER (optional) — narrows which mail counts as
//     CFISD mail, e.g. 'from:cfisd.net'. Strongly recommended — without
//     it, every email in the inbox gets pulled in (newsletters, receipts,
//     etc.), same issue you hit before.
//   GMAIL_SYNC_QUERY_INITIAL (optional) — how far back the very first run
//     (before any cursor exists) should look. Defaults to "newer_than:30d".
//     Only matters once; after the first successful run, the stored
//     cursor takes over completely regardless of this value.

import { createClient } from '@supabase/supabase-js';
import { guessCategory } from './lib/categorize-email.js';

const MAX_PAGES = 5; // 5 pages x 50 = up to 250 messages checked per run

async function getAccessToken({ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, supabase }) {
  const { data: tokenRow, error } = await supabase
    .from('oauth_tokens')
    .select('refresh_token')
    .eq('provider', 'google')
    .single();

  if (error || !tokenRow?.refresh_token) {
    throw new Error('Google account not connected yet (no stored refresh token).');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokenRow.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  }
  return data.access_token;
}

// Recursively finds the first text/plain part of a Gmail message payload
// and returns its decoded contents. Falls back to the message snippet.
function extractPlainTextBody(payload) {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const found = extractPlainTextBody(part);
      if (found) return found;
    }
  }

  return '';
}

function decodeBase64Url(data) {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function getHeader(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function getStoredCursor(supabase) {
  const { data } = await supabase
    .from('sync_state')
    .select('value')
    .eq('key', 'gmail_last_synced_at')
    .maybeSingle();
  return data?.value || null;
}

async function setStoredCursor(supabase, isoTimestamp) {
  await supabase
    .from('sync_state')
    .upsert({ key: 'gmail_last_synced_at', value: isoTimestamp, updated_at: new Date().toISOString() });
}

export async function handler() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    GMAIL_SYNC_SENDER_FILTER,
    GMAIL_SYNC_QUERY_INITIAL,
  } = process.env;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let accessToken;
  try {
    accessToken = await getAccessToken({ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, supabase });
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }

  const storedCursor = await getStoredCursor(supabase);
  const senderFilter = GMAIL_SYNC_SENDER_FILTER || '';

  let query;
  if (storedCursor) {
    // Gmail's "after:" operator takes whole days, not precise timestamps,
    // so pull from one day before the cursor and rely on gmail_message_id
    // uniqueness to silently skip anything already synced.
    const cursorDate = new Date(storedCursor);
    cursorDate.setDate(cursorDate.getDate() - 1);
    const afterEpochSeconds = Math.floor(cursorDate.getTime() / 1000);
    query = `${senderFilter} after:${afterEpochSeconds}`.trim();
  } else {
    query = `${senderFilter} ${GMAIL_SYNC_QUERY_INITIAL || 'newer_than:30d'}`.trim();
  }

  // Collect message refs across pages instead of stopping at the first 50.
  const messageRefs = [];
  let pageToken;
  let page = 0;

  do {
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('q', query);
    listUrl.searchParams.set('maxResults', '50');
    if (pageToken) listUrl.searchParams.set('pageToken', pageToken);

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const listData = await listRes.json();

    if (!listRes.ok) {
      return { statusCode: 502, body: `Gmail list request failed: ${listData.error?.message}` };
    }

    if (listData.messages) messageRefs.push(...listData.messages);
    pageToken = listData.nextPageToken;
    page++;
  } while (pageToken && page < MAX_PAGES);

  let inserted = 0;
  let skipped = 0;
  const errors = [];
  let newestSeen = storedCursor ? new Date(storedCursor) : new Date(0);

  for (const ref of messageRefs) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const msg = await msgRes.json();

    if (!msgRes.ok) {
      errors.push(`Message ${ref.id}: ${msg.error?.message}`);
      continue;
    }

    const headers = msg.payload?.headers;
    const subject = getHeader(headers, 'Subject') || '(no subject)';
    const from = getHeader(headers, 'From');
    const emailBody = extractPlainTextBody(msg.payload) || msg.snippet || '';

    const internalDate = new Date(Number(msg.internalDate));
    if (internalDate > newestSeen) newestSeen = internalDate;

    const receivedDate = internalDate.toISOString().slice(0, 10);
    const category = guessCategory(`${subject} ${from} ${emailBody}`);

    const { error: insertError } = await supabase.from('cfisd_emails').insert({
      gmail_message_id: ref.id,
      received_date: receivedDate,
      sender: from || null,
      subject,
      body: emailBody || null,
      category,
    });

    if (insertError) {
      // Unique violation on gmail_message_id means we already synced this
      // one — expected on overlapping queries, not a real error.
      if (insertError.code === '23505') {
        skipped++;
      } else {
        errors.push(`Message ${ref.id}: ${insertError.message}`);
      }
    } else {
      inserted++;
    }
  }

  // Only advance the cursor if nothing went wrong — if there were errors,
  // leave it where it was so the next run retries the same window rather
  // than silently skipping past a message that failed to insert.
  if (errors.length === 0 && messageRefs.length > 0) {
    await setStoredCursor(supabase, newestSeen.toISOString());
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      pagesFetched: page,
      checked: messageRefs.length,
      inserted,
      skipped,
      errors,
      cursorAdvancedTo: errors.length === 0 ? newestSeen.toISOString() : '(unchanged due to errors)',
    }),
  };
}
