// Learning-only enums. PILLARS itself is NOT redefined here (Phase H merge)
// — it's the exact same 7-key life-pillar taxonomy the rest of the app
// already has in ../constants.js (confirmed identical keys and labels), so
// Learning imports and re-exports that one shared copy instead of keeping a
// second list that could drift out of sync.
export { PILLARS } from "../constants.js";

export const SOURCE_TYPES = {
  book: "Book",
  video: "Video",
  article: "Article",
  other: "Other",
};

// Capture status enum — see plan Phase G decision #6 for why needs_retake
// exists separately from needs_text (a photo with nothing readable, vs. a
// link the routine couldn't fetch).
export const CAPTURE_STATUS = {
  PENDING_TRANSCRIPTION: "pending_transcription",
  PENDING_SUMMARY: "pending_summary",
  READY: "ready",
  NEEDS_TEXT: "needs_text",
  NEEDS_RETAKE: "needs_retake",
};

export const QUEUE_ACTION_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  DONE: "done",
  DISMISSED: "dismissed",
};

export const SOURCE_STATUS = {
  ACTIVE: "active",
  FINISHED: "finished",
};

// Learning brief topic tags — see learning/CLAUDE.md's Mode 2 (draft a
// brief) instructions for the exact allowed set.
export const BRIEF_TOPICS = ["🧠 Self-Dev", "🤖 AI & Tech", "👑 Leadership", "🤝 People", "🚀 Entrepreneurship", "📚 Other"];
