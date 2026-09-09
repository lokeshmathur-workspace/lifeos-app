// Dates are always America/Los_Angeles, never the browser/server's own clock —
// per DESIGN-SYSTEM.md / REQUIREMENTS.md NFR ("a real prior bug misfiled evenings
// after 5pm as next day"). Same Intl-based approach as reference-app.html.
export const TZ = "America/Los_Angeles";

const fmtISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const todayISO = () => fmtISO.format(new Date());

export const nowHM = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

export const D = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const isoOf = (dt) => dt.toISOString().slice(0, 10);

export const addDays = (dateISO, n) => {
  const d = D(dateISO);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
};

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAYKEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const dayOfWeekName = (dateISO) => DOW[D(dateISO).getUTCDay()];

// "Mon".."Sun" for a date, matching DATA-MODEL.md's dayKey enum.
export const dayKeyOf = (dateISO) => {
  const idx = D(dateISO).getUTCDay(); // 0=Sun..6=Sat
  return DAYKEYS[(idx + 6) % 7];
};

export const prettyDate = (dateISO) => {
  const d = D(dateISO);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(d);
};

export const shortDate = (dateISO) => {
  const d = D(dateISO);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(d);
};

// Monday of the ISO week containing dateISO — DATA-MODEL.md: "weekOf is the
// Monday, ISO weeks throughout."
export const mondayOf = (dateISO) => addDays(dateISO, -((D(dateISO).getUTCDay() + 6) % 7));
export const sundayOf = (dateISO) => addDays(mondayOf(dateISO), 6);

export const isoWeekNumber = (dateISO) => {
  const d = D(dateISO);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
};

export const monthName = (year, month) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
