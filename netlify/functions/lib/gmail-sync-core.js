// Shared core logic used by both sync-gmail-emails.js (the automatic
// hourly-scheduled version) and poll-gmail-emails.js (the manual "Sync
// now" button in the app). Both call runGmailSync() and return its result
// as-is — this file is the only place the actual sync logic lives, so the
// two entry points can never drift apart.
//
// Reads recent Gmail messages (forward your CFISD emails to Gmail),
// categorizes them with the same logic as intake-email.js, and stores new
// ones into cfisd_emails. Safe to run repeatedly — already-synced messages
// are skipped via their unique Gmail message id.
//
// Uses a persistent cursor (the sync_state table) rather than a fixed
// rolling time window, so it always resumes exactly where it left off no
// matter how long it's been since the last run — a fixed window silently
// loses mail if nothing runs for longer than that window.
//
// Configure in Netlify env vars:
//   GMAIL_SYNC_SENDER_FILTER (optional) — narrows which mail counts as
//     CFISD mail, e.g. 'from:cfisd.net'. Strongly recommended — without
//     it, every email in the inbox gets pulled in (newsletters, receipts,
//     etc.).
//   GMAIL_SYNC_QUERY_INITIAL (optional) — how far back the very first run
//     (before any cursor exists) should look. Defaults to "newer_than:30d".
//     Only matters once; after the first successful run, the stored
//     cursor takes over completely regardless of this value.

import { createClient } from '@supabase/supabase-js';
import { guessCategory } from './categorize-email.js';

const MAX_PAGES = 1; // 1 page = up to 50 messages checked per run.
// Kept intentionally small: with the per-message delay below (needed to
// avoid Gmail's burst rate limit) plus Netlify's own function execution
// time limit, a single run can't safely process hundreds of messages.
// Any backlog beyond 50 just gets picked up on the next run automatically
// via the stored cursor — nothing is lost, it just takes a few runs to
// fully catch up after a long gap. Steady-state (checking for new mail
// since the last run) is comfortably under 50 messages either way.

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

// For a message that was manually forwarded (as opposed to auto-forwarded
// at the mail-server level), Gmail's own "From:" header only shows the
// person who clicked Forward — the real original sender only exists as
// quoted text inside the body, in the block Outlook/Gmail insert above a
// forwarded message, e.g.:
//   From: Christopher Brister <Christopher.brister@cfisd.net>
//   Sent: Wednesday, September 17, 2026 10:15 AM
//   ...
// This pulls that address back out so we can use the real sender instead
// of the forwarder's address.
function extractForwardedSender(bodyText) {
  if (!bodyText) return null;
  const match = bodyText.match(/^From:\s*(?:.*?<([^>]+)>|([^\s<]+@[^\s<]+))/im);
  return match ? (match[1] || match[2]) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function runGmailSync() {
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
  let skippedNonCfisd = 0;
  const errors = [];
  let newestSuccessful = storedCursor ? new Date(storedCursor) : new Date(0);
  let oldestErrored = null;

  for (const ref of messageRefs) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const msg = await msgRes.json();

    if (!msgRes.ok) {
      errors.push(`Message ${ref.id}: ${msg.error?.message}`);
      // We don't know this message's date since the fetch itself failed,
      // so we can't factor it into oldestErrored — the 1-day overlap
      // buffer on the next run's cursor is what catches it instead.
      continue;
    }

    const headers = msg.payload?.headers;
    const subject = getHeader(headers, 'Subject') || '(no subject)';
    const visibleFrom = getHeader(headers, 'From');
    const emailBody = extractPlainTextBody(msg.payload) || msg.snippet || '';
    const internalDate = new Date(Number(msg.internalDate));

    // If the visible sender isn't already CFISD, this might be a manual
    // forward — try to recover the real original sender from the quoted
    // header block inside the body. If we can't find a cfisd.net address
    // anywhere (visible or embedded), this almost certainly isn't a school
    // email, so skip it rather than storing noise. It still counts toward
    // cursor progress, since we did successfully check it.
    let from = visibleFrom;
    if (!from.toLowerCase().includes('cfisd.net')) {
      const embedded = extractForwardedSender(emailBody);
      if (embedded && embedded.toLowerCase().includes('cfisd.net')) {
        from = embedded;
      } else {
        skippedNonCfisd++;
        if (internalDate > newestSuccessful) newestSuccessful = internalDate;
        continue;
      }
    }

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
      // one — expected on overlapping queries, not a real error. It still
      // counts as "successfully accounted for" for cursor purposes.
      if (insertError.code === '23505') {
        skipped++;
        if (internalDate > newestSuccessful) newestSuccessful = internalDate;
      } else {
        errors.push(`Message ${ref.id}: ${insertError.message}`);
        if (!oldestErrored || internalDate < oldestErrored) oldestErrored = internalDate;
      }
    } else {
      inserted++;
      if (internalDate > newestSuccessful) newestSuccessful = internalDate;
    }

    // Small pause between messages — fetching many messages back-to-back
    // with no delay is what triggers Gmail's per-minute burst limit, even
    // though the actual daily quota usage is nowhere close to the cap.
    await sleep(150);
  }

  // Advance the cursor as far as we safely can:
  //  - No errors at all -> advance to the newest message processed.
  //  - Some errors -> advance only up to just before the oldest failed
  //    message, so it's guaranteed to be re-checked on the next run
  //    instead of being silently skipped forever.
  //  - Nothing processed -> leave the cursor untouched.
  let newCursor = null;
  if (messageRefs.length > 0) {
    if (errors.length === 0) {
      newCursor = newestSuccessful;
    } else if (oldestErrored) {
      const safeCursor = new Date(oldestErrored.getTime() - 1000);
      const currentCursor = storedCursor ? new Date(storedCursor) : new Date(0);
      if (safeCursor > currentCursor) newCursor = safeCursor;
    }
  }

  if (newCursor) {
    await setStoredCursor(supabase, newCursor.toISOString());
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
      skippedNonCfisd,
      errors,
      cursorAdvancedTo: newCursor ? newCursor.toISOString() : '(unchanged)',
    }),
  };
}
