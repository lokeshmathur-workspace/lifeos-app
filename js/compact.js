// Byte-for-byte JS port of lifeos-rebuild/reference/sync_from_app.py's compact().
// indent 2, source key order preserved (never sorted), arrays of plain scalars
// collapse to one line if they fit in 100 chars — this is what keeps `git diff`
// on life-os/ readable. Do not "clean up" this format; it's deliberate.

function jsonScalar(v) {
  // matches Python's json.dumps(..., ensure_ascii=False) for scalars
  return JSON.stringify(v);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof PyFloat);
}

// Marks a number as "Python float" so it serializes with a decimal point even
// when whole (50 -> "50.0"), matching json.dumps(round(x, n)) — recompute.py's
// avg()/rate helpers return floats, and JS's JSON has no int/float distinction
// of its own, so without this a whole-number stat would round-trip as "50" and
// make validate.yml's byte-diff staleness check perpetually flag computed.json
// as stale even when the numbers are identical.
export class PyFloat {
  constructor(value) {
    this.value = value;
  }
}

function pyFloatStr(n) {
  const s = String(n);
  return /[.e]/.test(s) ? s : s + ".0";
}

function encNode(o, depth, indent) {
  const pad = " ".repeat(indent * depth);
  const padIn = " ".repeat(indent * (depth + 1));

  if (o instanceof PyFloat) return pyFloatStr(o.value);

  if (isPlainObject(o)) {
    const keys = Object.keys(o);
    if (keys.length === 0) return "{}";
    const items = keys.map(
      (k) => `${padIn}${jsonScalar(k)}: ${encNode(o[k], depth + 1, indent)}`
    );
    return "{\n" + items.join(",\n") + "\n" + pad + "}";
  }

  if (Array.isArray(o)) {
    if (o.length === 0) return "[]";
    const allScalar = o.every((x) => !isPlainObject(x) && !Array.isArray(x) && !(x instanceof PyFloat));
    if (allScalar) {
      const one = JSON.stringify(o);
      if (one.length + pad.length <= 100) return one;
    }
    const items = o.map((x) => padIn + encNode(x, depth + 1, indent));
    return "[\n" + items.join(",\n") + "\n" + pad + "]";
  }

  return jsonScalar(o);
}

// compact(doc) -> string (no trailing newline; caller adds one, matching
// write_if_changed's `compact(doc) + "\n"`)
export function compact(doc, indent = 2) {
  return encNode(doc, 0, indent);
}

// --- Task ID generation, per life-os/docs/DATA_PROTOCOL.md + scripts/validate.py ---
// Format: T[YYYYMMDD]-[N], N sequential within the day. validate.py's regex:
// ^(T\d{8}-\d+|LB\d{3}-A\d+|CA\d{8}-\d+)$
const TASK_ID_RE = /^T(\d{8})-(\d+)$/;

// dateISO: "2026-09-09". existingTaskArrays: array of arrays of task objects
// (e.g. [dayDoc.morning.top3, dayDoc.evening.top3Results, state.currentWeek.tasks])
// to scan for the highest N already used for that day, so a new id never collides.
export function nextTaskId(dateISO, existingTaskArrays) {
  const ymd = dateISO.replace(/-/g, "");
  let maxN = 0;
  for (const arr of existingTaskArrays || []) {
    for (const t of arr || []) {
      const m = t && typeof t.id === "string" && t.id.match(TASK_ID_RE);
      if (m && m[1] === ymd) maxN = Math.max(maxN, parseInt(m[2], 10));
    }
  }
  return `T${ymd}-${maxN + 1}`;
}
