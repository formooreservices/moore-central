// GET /.netlify/functions/sync-gmail-emails
// Runs automatically on a schedule (see netlify.toml) — Netlify blocks
// this URL from being called directly for that reason. For a manual
// "sync right now" trigger (e.g. a button in the app), use
// poll-gmail-emails.js instead, which runs the identical logic without
// the scheduled-function restriction.

import { runGmailSync } from './lib/gmail-sync-core.js';

export async function handler() {
  return runGmailSync();
}
