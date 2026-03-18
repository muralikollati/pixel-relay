/**
 * Normalises a date value coming from SQLite before passing it to `new Date()`.
 *
 * SQLite's datetime('now') stores "2026-03-18 11:11:56" — no T, no Z.
 * `new Date()` then treats that as *local* time, so the UTC→local conversion
 * never happens and the displayed time is always in UTC regardless of timezone.
 *
 * This helper appends the missing "T" separator and "Z" suffix so JS always
 * knows the value is UTC, then lets the browser convert to local time normally.
 */
export const toUTC = (date) => {
  if (!date) return null;
  if (date instanceof Date) return date;
  // Bare SQLite format: "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" (no Z)
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(date)) {
    return new Date(date.replace(" ", "T") + "Z");
  }
  return new Date(date);
};

export const dateFormatter = (date) => {
  if (!date) return "N/A";
  const d = toUTC(date);
  if (isNaN(d)) return "N/A";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

/** Short date only — e.g. "18/03/2026" */
export const dateOnlyFormatter = (date) => {
  if (!date) return "N/A";
  const d = toUTC(date);
  if (isNaN(d)) return "N/A";
  return d.toLocaleDateString("en-GB");
};

/** Short time only — e.g. "04:41 pm" */
export const timeFormatter = (date) => {
  if (!date) return "N/A";
  const d = toUTC(date);
  if (isNaN(d)) return "N/A";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
};