// Ported verbatim from reference-app.html — the fixed vocabulary from
// lifeos-rebuild/REQUIREMENTS.md §3 ("do not redesign").
export const PILLARS = {
  finances: "Finances",
  careerWork: "Career & Work",
  business: "Business",
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
