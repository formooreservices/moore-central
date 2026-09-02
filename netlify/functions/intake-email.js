// POST /.netlify/functions/intake-email
// Called by a Make.com HTTP module whenever a CFISD email comes through.
// Stores the full email (date, sender, subject, body) into the
// cfisd_emails table, with a best-guess category based on keywords.
//
// Expected JSON body from Make's HTTP module:
//   {
//     "subject": "Permission slip due Friday",
//     "received": "2026-09-03T14:22:00Z",
//     "from": "truittes@cfisd.net",
//     "body": "Please return the signed permission slip by..."
//   }

import { createClient } from '@supabase/supabase-js';

// Basic keyword -> category guesses. Adjust/expand freely; this runs on
// subject + sender + body combined, case-insensitive.
const CATEGORY_RULES = [
  { category: 'Truitt', keywords: ['truitt'] },
  { category: 'CyFalls', keywords: ['cy falls', 'cyfalls', 'cy-falls'] },
  { category: 'Sports', keywords: ['athletics', 'practice', 'game', 'tournament', 'coach'] },
  { category: 'School', keywords: ['homework', 'permission slip', 'pta', 'report card', 'school'] },
];

function guessCategory(text) {
  const lower = text.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      return rule.category;
    }
  }
  return null;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed.' };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTAKE_SECRET } = process.env;

  if (INTAKE_SECRET) {
    const providedKey = event.queryStringParameters?.key;
    if (providedKey !== INTAKE_SECRET) {
      return { statusCode: 401, body: 'Unauthorized.' };
    }
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON.' };
  }

  const { subject, received, from, body: emailBody } = body;

  if (!subject) {
    return { statusCode: 400, body: 'Missing "subject" field.' };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const category = guessCategory(`${subject} ${from || ''} ${emailBody || ''}`);

  const { data, error } = await supabase
    .from('cfisd_emails')
    .insert({
      received_date: received ? received.slice(0, 10) : null,
      sender: from || null,
      subject,
      body: emailBody || null,
      category,
    })
    .select()
    .single();

  if (error) {
    return { statusCode: 500, body: `Failed to store email: ${error.message}` };
  }

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: data }),
  };
}
