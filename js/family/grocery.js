// Dishes and the grocery list for the Nutrition tab. The library is the starter dishes plus any
// looked up on the web (recipes.json); the list adds up the ingredients of every dish picked for
// the week, by aisle, merging the same item across dishes.
import { STARTER_DISHES, AISLES } from "./dishes.js";

export const SLOTS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"]];
export const QUICK = ["Leftovers", "Eating out"];

export function allDishes(D) {
  const looked = (D.recipes?.dishes || []).map((d) => ({ ...d, source: "lookup" }));
  return [...STARTER_DISHES, ...looked];
}
export const dishById = (D, id) => allDishes(D).find((d) => d.id === id) || null;

const keyOf = (item) => item.toLowerCase().replace(/\s+/g, " ").trim();
const FRAC = { 0.25: "¼", 0.5: "½", 0.75: "¾", 0.33: "⅓", 0.67: "⅔" };
export function fmtQty(q) {
  if (q == null || q === "") return "";
  const whole = Math.floor(q), part = Math.round((q - whole) * 100) / 100, f = FRAC[part];
  return f ? `${whole || ""}${f}` : String(Math.round(q * 100) / 100);
}
const PLURAL = { cup: "cups", lb: "lb", oz: "oz", tbsp: "tbsp", tsp: "tsp", clove: "cloves", can: "cans", pack: "packs", bunch: "bunches", head: "heads", jar: "jars", bottle: "bottles", loaf: "loaves", bag: "bags", box: "boxes", stalk: "stalks", pint: "pints", tub: "tubs", inch: "inch", pinch: "pinch" };
export const fmtAmount = (q, unit) => (unit ? `${fmtQty(q)} ${q > 1 ? PLURAL[unit] || unit : unit}` : fmtQty(q));

// The week's list: [{aisle, items: [{key, item, amounts: "4 cups", for: [dish names]}]}]
export function groceryList(D, days) {
  const map = new Map();
  for (const d of days) for (const [slot] of SLOTS) {
    const ds = d[`${slot}Id`] ? dishById(D, d[`${slot}Id`]) : null;
    if (!ds) continue;
    for (const ing of ds.ingredients || []) {
      const k = keyOf(ing.item), e = map.get(k) || { key: k, item: ing.item, aisle: AISLES.includes(ing.aisle) ? ing.aisle : "Other", units: new Map(), for: new Set() };
      e.units.set(ing.unit || "", (e.units.get(ing.unit || "") || 0) + (+ing.qty || 0)); e.for.add(ds.name); map.set(k, e);
    }
  }
  const items = [...map.values()].map((e) => ({ key: e.key, item: e.item[0].toUpperCase() + e.item.slice(1), aisle: e.aisle,
    amounts: [...e.units].map(([u, q]) => fmtAmount(q, u)).filter(Boolean).join(" + "), for: [...e.for] }));
  return AISLES.map((aisle) => ({ aisle, items: items.filter((i) => i.aisle === aisle).sort((a, b) => a.item.localeCompare(b.item)) })).filter((a) => a.items.length);
}

// Plain text to paste into a shopping app or notes.
export function groceryText(list, have, extra, title) {
  const lines = [title];
  for (const a of list) { const its = a.items.filter((i) => !have.includes(i.key)); if (its.length) lines.push("", a.aisle.toUpperCase(), ...its.map((i) => `- ${i.item}${i.amounts ? ` (${i.amounts})` : ""}`)); }
  const ex = extra.filter((x) => !have.includes(`x:${x.id}`)); if (ex.length) lines.push("", "ALSO", ...ex.map((x) => `- ${x.item}`));
  return lines.join("\n");
}
