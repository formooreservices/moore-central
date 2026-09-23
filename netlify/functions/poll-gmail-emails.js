// GET /.netlify/functions/poll-gmail-emails
// Manually-triggerable twin of sync-gmail-emails.js — same logic, same
// cursor, just not marked as scheduled, so it CAN be called directly
// (Netlify blocks direct calls to scheduled function URLs). This is what
// the "Sync now" button in the app calls.

import { runGmailSync } from './lib/gmail-sync-core.js';

export async function handler() {
  return runGmailSync();
}
