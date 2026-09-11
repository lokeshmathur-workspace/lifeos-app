// Originally ported verbatim from reference-app.html — the fixed vocabulary from
// lifeos-rebuild/REQUIREMENTS.md §3. `personal` added 2026-09-11 (seventh pillar,
// see life-os/reference/frameworks.md in the data repo and CHANGELOG.md there).
export const PILLARS = {
  finances: "Finances",
  careerWork: "Career & Work",
  business: "Business",
  personal: "Personal",
  vitality: "Vitality",
  relationships: "Relationships",
  mindGrowth: "Mind & Growth",
};

export const BIZ = [
  ["counselHuddle", "Counsel"],
  ["stp", "STP"],
  ["retail", "Retail"],
  ["productLearning", "Product"],
  ["association", "Association"],
  ["podcast", "Podcast"],
];

export const VIT = [
  ["dailyRead", "Daily Read"],
  ["meditation", "Meditation"],
  ["hydrate", "Hydrate"],
  ["exercise", "Exercise"],
  ["nutrition", "Nutrition"],
  ["sleep", "Sleep"],
];

// The subset shown as a quick check-in during the evening review (see app.js's
// eveningForm) — the other two (dailyRead, sleep) stay toggleable via the
// day-in-progress six-rail only, per what was actually asked for.
export const VIT_EVENING_CHECKIN = [
  ["meditation", "Meditate"],
  ["hydrate", "Hydrate"],
  ["nutrition", "Nutrition"],
  ["exercise", "Exercise"],
];

export const HPH = [
  ["clarity", "Clarity"],
  ["energy", "Energy"],
  ["necessity", "Necessity"],
  ["productivity", "Productivity"],
  ["influence", "Influence"],
  ["courage", "Courage"],
];

export const CYCLE = {
  not_started: "in_progress",
  in_progress: "done",
  done: "carried_forward",
  carried_forward: "not_started",
};
