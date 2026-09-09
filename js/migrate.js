// Read-side migration helpers, per lifeos-rebuild/DATA-MODEL.md:
//   "reflections.improveTomorrow was called toImprove in older files. Migrate on read."
//   "morning.quote replaced morning.affirmation. Older days carry the latter;
//    render whichever exists."
//
// New writes use ONLY the new field names (quote, improveTomorrow) — this module
// exists so the app can read the live repo's live-mixed schema (confirmed: 5 of 6
// existing journal files still say toImprove; none yet use morning.quote) without
// a flag-day rewrite of old files.

// Returns { text, author, why } from whichever of morning.quote / morning.affirmation
// is present. affirmation-only days get a synthetic quote shape so the UI has one
// thing to render either way; `legacy: true` lets the UI know not to show a "why".
export function readQuote(morning) {
  if (!morning) return null;
  if (morning.quote) return { ...morning.quote, legacy: false };
  if (morning.affirmation) {
    return { text: morning.affirmation, author: "", why: "", legacy: true };
  }
  return null;
}

// Returns the "what to improve tomorrow" reflection string from whichever key exists.
export function readImproveTomorrow(reflections) {
  if (!reflections) return "";
  if (typeof reflections.improveTomorrow === "string") return reflections.improveTomorrow;
  if (typeof reflections.toImprove === "string") return reflections.toImprove;
  return "";
}

// Writes always use the new key only, dropping the old one if present, so a day
// that gets touched by the app finishes its own migration.
export function writeReflections(reflections, improveTomorrow) {
  const { toImprove, ...rest } = reflections || {};
  return { ...rest, improveTomorrow };
}

export function writeMorningQuote(morning, quote) {
  const { affirmation, ...rest } = morning || {};
  return { ...rest, quote };
}
