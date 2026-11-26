// "From your career plan" rows, shared by the Week board and the Month planner.
import { daysBetween } from "./sync.js";
import { shortDate } from "../dateutil.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "From your career plan" rows (Week board and Month planner share the look).
export function careerPullHtml(items, today, buttons) {
  if (!items.length) return "";
  return `<div class="frommonth fromcareer">
        <span class="lbl">From your career plan</span>
        ${items
          .map((a) => {
            const late = a.due < today;
            return `
        <div class="item${a.gate ? " gate" : ""}">
          <span>${a.gate ? `<b class="gatechip">Gate</b> ` : ""}${esc(a.title)} <span class="duechip${late ? " late" : ""}">${late ? `${daysBetween(a.due, today)}d overdue` : `due ${esc(shortDate(a.due))}`}</span></span>
          ${buttons(a)}
        </div>`;
          })
          .join("")}
      </div>`;
}

