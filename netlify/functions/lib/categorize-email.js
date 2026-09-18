// Shared by intake-email.js (Make.com webhook) and sync-gmail-emails.js
// (direct Gmail sync), so both categorize emails identically.
//
// Basic keyword -> category guesses. Adjust/expand freely; this runs on
// subject + sender + body combined, case-insensitive.

const CATEGORY_RULES = [
  { category: 'Truitt', keywords: ['truitt'] },
  { category: 'CyFalls', keywords: ['cy falls', 'cyfalls', 'cy-falls'] },
  { category: 'Sports', keywords: ['athletics', 'practice', 'game', 'tournament', 'coach'] },
  { category: 'School', keywords: ['homework', 'permission slip', 'pta', 'report card', 'school'] },
];

export function guessCategory(text) {
  const lower = text.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      return rule.category;
    }
  }
  return null;
}

// Handles ISO strings, RFC 2822 strings, and other JS-parseable formats.
// Falls back to null if nothing usable comes through, rather than crashing
// the whole request on a bad date string.
export function parseToDateOnly(dateInput) {
  if (!dateInput) return null;
  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
