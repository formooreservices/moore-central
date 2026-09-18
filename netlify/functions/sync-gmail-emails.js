// GET /.netlify/functions/sync-gmail-emails
// Also runs automatically on a schedule (see netlify.toml).
//
// Replaces the Make.com "watch Outlook inbox" step: reads recent messages
// directly from Gmail (forward your CFISD emails from Outlook to Gmail),
// categorizes them with the same logic as intake-email.js, and stores new
// ones into cfisd_emails. Safe to run repeatedly — already-synced messages
// are skipped via their unique Gmail message id.
//
// Configure in Netlify env vars:
//   GMAIL_SYNC_QUERY (optional) — a Gmail search query limiting which
//     messages to check each run. Defaults to "newer_than:2d" so a normal
//     run only looks at the last couple of days; the gmail_message_id
//     uniqueness check makes re-checking overlap harmless.
//     Example: 'newer_than:2d from:(*@cfisd.net OR yourname@gmail.com)'

import { createClient } from '@supabase/supabase-js';
import { guessCategory } from './lib/categorize-email.js';

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

export async function handler() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    GMAIL_SYNC_QUERY,
  } = process.env;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let accessToken;
  try {
    accessToken = await getAccessToken({ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, supabase });
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }

  const query = GMAIL_SYNC_QUERY || 'newer_than:2d';
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('q', query);
  listUrl.searchParams.set('maxResults', '50');

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listData = await listRes.json();

  if (!listRes.ok) {
    return { statusCode: 502, body: `Gmail list request failed: ${listData.error?.message}` };
  }

  const messageRefs = listData.messages || [];
  let inserted = 0;
  let skipped = 0;
  const errors = [];

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
    const dateHeader = getHeader(headers, 'Date');
    const emailBody = extractPlainTextBody(msg.payload) || msg.snippet || '';

    const receivedDate = dateHeader
      ? new Date(dateHeader).toISOString().slice(0, 10)
      : new Date(Number(msg.internalDate)).toISOString().slice(0, 10);

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
      // one — that's expected on overlapping runs, not a real error.
      if (insertError.code === '23505') {
        skipped++;
      } else {
        errors.push(`Message ${ref.id}: ${insertError.message}`);
      }
    } else {
      inserted++;
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      checked: messageRefs.length,
      inserted,
      skipped,
      errors,
    }),
  };
}
