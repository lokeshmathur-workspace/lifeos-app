import { Store, loadConfig, saveConfig, clearConfig, loadPinHash, savePinHash, clearPin, sha256Hex } from "./store.js";
import { readQuote, readImproveTomorrow, writeReflections, writeMorningQuote } from "./migrate.js";
import { PILLARS, BIZ, VIT, VIT_EVENING_CHECKIN, HPH, CYCLE } from "./constants.js";
import { quoteForDate, randomQuote } from "./quotes.js";
import { todayISO, nowHM, addDays, dayOfWeekName, dayKeyOf, prettyDate, mondayOf, monthKeyOf } from "./dateutil.js";
import { streak, hphAvg, coreCount, top3Of } from "./derive.js";
import { loadAiConfig, saveAiConfig, clearAiConfig, pickQuoteAI, draftEveningAI, AiError } from "./ai.js";
import { copyDayForOneNote, downloadFullBackup } from "./export.js";
import { renderWeekView, copyWeekForOneNote } from "./week.js";
import { renderMonthView, copyMonthForOneNote } from "./month.js";
import { flash } from "./flash.js";
import { openBulkImport, parseTaskLines } from "./bulkimport.js";
import { taskKey, isOpen, addTasks, setTaskStatus, removeTask } from "./tasks.js";
import { openOutlookSync } from "./outlook.js";
import { renderLearningView } from "./learning/learning.js";
import { LearningStore } from "./learning/store.js";
import { loadRoutineConfig, saveRoutineConfig, clearRoutineConfig } from "./learning/routine.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const main = () => $("#main");
const wrap = () => $("#wrap");

const S = {
  store: null,
  view: "today",
  day: todayISO(),
  week: mondayOf(todayISO()),
  month: monthKeyOf(todayISO()),
  unlocked: false,
  planning: false,
  eveningEditing: false,
  picked: new Set(), // morning picker's ticked master-task ids, kept across in-place redraws
};

/* ═══ boot / auth / pin ═══════════════════════════════════ */

export async function boot() {
  const cfg = loadConfig();
  if (!cfg) return renderSetup();
  S.store = new Store(cfg, flash);
  // Phase H merge: one shared GitHub token for the whole app now — the
  // Learning tab used to hold its own separate one, but both apps only
  // ever needed Contents read/write on this same private repo, so there's
  // nothing a second token bought once they share one page anyway.
  S.learningStore = new LearningStore(cfg, flash);

  const pinHash = loadPinHash();
  if (pinHash && !S.unlocked) return renderPinGate(pinHash);

  return renderApp();
}

function renderSetup() {
  main().innerHTML = `
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <h2>Connect your data</h2>
      <p class="empty" style="padding:0 0 14px">Paste a GitHub fine-grained token for the private repo that holds your journal. Create it at GitHub → Settings → Developer settings → Fine-grained tokens. Repository access: <b>only</b> the data repo. Permissions: <b>Contents → Read and write</b>, nothing else.</p>
      <label class="fld"><span>Token</span><input type="password" id="tok" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
      <label class="fld"><span>Repository (owner/name)</span><input type="text" id="repo" value="lokeshmathur-workspace/Claude" spellcheck="false"></label>
      <div class="btnrow"><button class="btn pri" id="save">Connect</button></div>
      <p class="savenote" id="note" style="margin-top:10px"></p>
    </section>`;
  $("#save").onclick = async () => {
    const token = $("#tok").value.trim();
    const repo = $("#repo").value.trim();
    const note = $("#note");
    if (!/^(github_pat_|ghp_)/.test(token)) {
      note.textContent = "That doesn't look like a GitHub token — it should start with github_pat_ or ghp_.";
      return;
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      note.textContent = "Repository should look like owner/name.";
      return;
    }
    saveConfig({ token, repo, branch: "main" });
    boot();
  };
}

function renderPinGate(pinHash) {
  main().innerHTML = `
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0;max-width:280px;margin:60px auto 0;text-align:center">
      <h2 style="justify-content:center">Enter PIN</h2>
      <input type="password" id="pin" inputmode="numeric" style="text-align:center;font-size:20px;letter-spacing:.3em" autofocus>
      <p class="savenote" id="pinnote" style="margin-top:10px"></p>
    </section>`;
  const input = $("#pin");
  input.focus();
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const hash = await sha256Hex(input.value);
    if (hash === pinHash) {
      S.unlocked = true;
      renderApp();
    } else {
      $("#pinnote").textContent = "Wrong PIN.";
      input.value = "";
    }
  });
}

/* ═══ shell ════════════════════════════════════════════════ */

function renderApp() {
  wrap().classList.toggle("wide", S.view !== "today");
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.v === S.view)));
  if (S.view === "today") return renderToday();
  if (S.view === "week") return renderWeekView(S.store, S, renderApp);
  if (S.view === "month") return renderMonthView(S.store, S, renderApp);
  if (S.view === "learning") return renderLearningView(S.learningStore, S, renderApp);
}

window.addEventListener("lifeos:open-settings", openSettings);

// After an Outlook import: redraw so new tasks show up — except mid-planning or
// mid-review, where a redraw would wipe what's being typed.
window.addEventListener("lifeos:tasks-changed", () => {
  if (S.view === "learning" || S.planning || S.eveningEditing) return;
  renderApp();
});

window.addEventListener("lifeos:goto-day", (e) => {
  S.day = e.detail;
  S.view = "today";
  S.planning = false;
  S.eveningEditing = false;
  renderApp();
});

window.addEventListener("lifeos:goto-week", (e) => {
  S.week = e.detail;
  S.view = "week";
  S.weekReviewEditing = false;
  renderApp();
});

document.addEventListener("DOMContentLoaded", () => {
  $("#seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    S.view = b.dataset.v;
    renderApp();
  });
  $("#settingsbtn").addEventListener("click", openSettings);
  const locked = () => !S.store || (loadPinHash() && !S.unlocked);
  $("#exportbtn").addEventListener("click", async (e) => {
    if (locked()) return;
    const btn = e.currentTarget;
    const original = btn.textContent;
    try {
      if (S.view === "week") {
        await copyWeekForOneNote(S.store, S.week);
      } else if (S.view === "month") {
        await copyMonthForOneNote(S.store, S.month);
      } else {
        const doc = await S.store.getDay(S.day);
        await copyDayForOneNote(S.day, doc);
      }
      btn.textContent = "Copied!";
    } catch {
      btn.textContent = "Couldn't copy";
    } finally {
      setTimeout(() => (btn.textContent = original), 2000);
    }
  });
  $("#backupbtn").addEventListener("click", async (e) => {
    if (locked()) return;
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      await downloadFullBackup(S.store);
    } catch {
      flash("Couldn't build the backup.", true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
  $("#importbtn").addEventListener("click", () => {
    if (locked()) return;
    openBulkImport(S.store);
  });
  boot();
});

/* ═══ settings (token status, one-click removal, PIN) ═══════ */

function openSettings() {
  const cfg = loadConfig();
  const ai = loadAiConfig();
  const rc = loadRoutineConfig();
  const mask = (t) => (t ? t.slice(0, 7) + "…" + t.slice(-4) : "");
  const pinSet = !!loadPinHash();
  const back = document.createElement("div");
  back.className = "modalback";
  back.innerHTML = `
    <div class="modal">
      <h2 style="margin-top:0">Settings</h2>
      <p class="savenote">Connected to <span class="mono">${esc(cfg?.repo || "")}</span> as <span class="mono">${esc(mask(cfg?.token))}</span>. Stored only in this browser. Covers both Life OS and Learning — one token for both since the merge.</p>
      <div class="btnrow"><button class="btn" id="forgettoken">Forget token &amp; sign out</button></div>
      <div class="btnrow" style="margin-top:18px">
        ${pinSet ? `<button class="btn" id="clearpin">Remove PIN</button>` : `<button class="btn" id="setpin">Set a PIN</button>`}
      </div>
      <div class="btnrow" style="margin-top:18px"><button class="btn" id="privacytest">Check: is today's journal file publicly reachable?</button></div>
      <p class="savenote" id="privacynote" style="margin-top:8px"></p>
      <h2 style="margin-top:22px">AI features</h2>
      <p class="savenote" style="margin-bottom:10px">${ai?.url ? `Connected to <span class="mono">${esc(ai.url)}</span>.` : "Not set up — every AI feature has a manual fallback, so this is optional."} See worker/README.md for deploy steps.</p>
      <label class="fld"><span>Worker URL</span><input type="text" id="aiurl" value="${esc(ai?.url || "")}" placeholder="https://lifeos-ai-proxy.….workers.dev" spellcheck="false"></label>
      <label class="fld"><span>Shared secret</span><input type="password" id="aisecret" value="${esc(ai?.secret || "")}" autocomplete="off" spellcheck="false"></label>
      <div class="btnrow" style="margin-top:0">
        <button class="btn sm" id="saveai">Save</button>
        ${ai?.url ? `<button class="btn sm" id="clearai">Remove</button>` : ""}
      </div>
      <h2 style="margin-top:22px">Learning processing</h2>
      <p class="savenote" style="margin-bottom:10px">The routine that transcribes photos, summarizes links, and drafts briefs for the Learning tab — a separate credential from the GitHub token above, scoped by Anthropic to firing that one routine only. <a href="https://claude.ai/code/routines" target="_blank" rel="noopener">Manage your routine</a>.</p>
      <label class="fld"><span>Routine API URL</span><input type="text" id="rurl" value="${esc(rc?.url || "")}" placeholder="https://api.anthropic.com/v1/claude_code/routines/.../fire" spellcheck="false"></label>
      <label class="fld"><span>Routine token</span><input type="password" id="rtoken" value="${esc(rc?.token || "")}" placeholder="sk-ant-oat01-..." autocomplete="off" spellcheck="false"></label>
      <div class="btnrow" style="margin-top:0">
        <button class="btn sm" id="saveroutine">Save</button>
        ${rc?.url ? `<button class="btn sm" id="clearroutine">Remove</button>` : ""}
      </div>
      <div class="btnrow" style="margin-top:18px"><button class="btn pri" id="closesettings">Close</button></div>
    </div>`;
  document.body.appendChild(back);
  back.addEventListener("click", (e) => {
    if (e.target === back) back.remove();
  });
  document.addEventListener("keydown", function esc1(e) {
    if (e.key === "Escape") {
      back.remove();
      document.removeEventListener("keydown", esc1);
    }
  });
  $("#closesettings", back).addEventListener("click", () => back.remove());
  $("#forgettoken", back).addEventListener("click", () => {
    clearConfig();
    clearPin();
    location.reload();
  });
  $("#setpin", back)?.addEventListener("click", async () => {
    const pin = prompt("Choose a PIN (this is a convenience lock, not the real security boundary — that's your token):");
    if (!pin) return;
    savePinHash(await sha256Hex(pin));
    back.remove();
  });
  $("#clearpin", back)?.addEventListener("click", () => {
    clearPin();
    back.remove();
  });
  $("#privacytest", back).addEventListener("click", async () => {
    const note = $("#privacynote", back);
    note.textContent = "Checking…";
    try {
      const isPrivate = await S.store.verifyPrivate(todayISO(), cfg.repo);
      note.textContent = isPrivate
        ? "✓ Private — an unauthenticated request for today's file gets a 404, same as any other private-repo file."
        : "⚠ That file answered without authentication — this needs investigating before you trust it with real entries.";
    } catch {
      note.textContent = "Couldn't run the check.";
    }
  });
  $("#saveai", back).addEventListener("click", () => {
    const url = $("#aiurl", back).value.trim();
    const secret = $("#aisecret", back).value.trim();
    if (!url || !secret) return;
    saveAiConfig({ url, secret });
    back.remove();
  });
  $("#clearai", back)?.addEventListener("click", () => {
    clearAiConfig();
    back.remove();
  });
  $("#saveroutine", back).addEventListener("click", () => {
    const url = $("#rurl", back).value.trim();
    const token = $("#rtoken", back).value.trim();
    if (!url || !token) return;
    saveRoutineConfig({ url, token });
    back.remove();
  });
  $("#clearroutine", back)?.addEventListener("click", () => {
    clearRoutineConfig();
    back.remove();
  });
}

/* ═══ today ════════════════════════════════════════════════ */

async function renderToday() {
  main().innerHTML = `<p class="empty">Loading…</p>`;
  const dateISO = S.day;
  const doc = await S.store.getDay(dateISO);
  const weekDoc = await S.store.getWeek(mondayOf(dateISO));
  const monthDoc = await S.store.getMonth(monthKeyOf(dateISO));

  const html = [];
  html.push(dateHead(dateISO));

  if (S.planning) {
    html.push(await planningForm(dateISO, doc, monthDoc, weekDoc));
  } else if (S.eveningEditing) {
    // Checked before the "nothing planned" gate below: "Skip to evening review"
    // sets eveningEditing without ever creating a morning block, and must still
    // win here — otherwise it silently bounces back to "Nothing planned yet".
    html.push(eveningForm(dateISO, doc, monthDoc, weekDoc));
  } else if (!doc.morning && !doc.evening?.completedAt) {
    html.push(planPrompt(dateISO));
  } else if (!doc.evening?.completedAt) {
    html.push(dayInProgress(dateISO, doc));
  } else {
    // Reachable with no doc.morning at all (an evening-only day, via "Skip to
    // evening review") — daySummary already renders fine without it, just
    // omitting the "This morning" section.
    html.push(daySummary(dateISO, doc));
  }

  main().innerHTML = html.join("");
  wireToday(dateISO, doc, monthDoc, weekDoc);
}

function dateHead(dateISO) {
  return `
    <div class="datehead">
      <div class="nav-day">
        <button class="iconbtn" id="prevday" title="Previous day">‹</button>
      </div>
      <div>
        <div class="sub">${esc(dayOfWeekName(dateISO))}</div>
        <h1 class="serif">${esc(prettyDate(dateISO))}</h1>
      </div>
      <div class="nav-day">
        <button class="iconbtn" id="nextday" title="Next day" ${dateISO >= todayISO() ? "disabled" : ""}>›</button>
        ${dateISO !== todayISO() ? `<button class="btn sm" id="jumptoday">Today</button>` : ""}
      </div>
    </div>`;
}

function planPrompt(dateISO) {
  return `
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <div class="card">
        <p style="margin:0 0 14px;color:var(--ink-2)">Nothing planned yet for this day.</p>
        <div class="btnrow" style="margin-top:0">
          <button class="btn pri" id="startplan">Plan the day</button>
          <button class="btn" id="skiptoevening">Skip to evening review</button>
        </div>
      </div>
    </section>`;
}

function pickerGroup(title, hint, items, checkedIds) {
  if (!items.length) return "";
  return `
    <div class="pickgroup">
      <h4>${esc(title)} <span>${esc(hint)}</span></h4>
      ${items
        .map(
          (t) => `
        <label class="pickrow">
          <input type="checkbox" class="addlpick" value="${esc(t.id)}" ${checkedIds.has(t.id) ? "checked" : ""}>
          <span class="tk">${esc(t.task)}</span>
          <span class="pl">${esc(PILLARS[t.pillar] || t.pillar)}</span>
        </label>`
        )
        .join("")}
    </div>`;
}

async function planningForm(dateISO, doc, monthDoc, weekDoc) {
  const q = doc.morning?.quote ? readQuote(doc.morning) : quoteForDate(dateISO);
  const dk = dayKeyOf(dateISO);
  const master = await S.store.getTasks();
  const byId = new Map(master.tasks.map((t) => [t.id, t]));

  // Pre-ticked: re-editing keeps today's picks; otherwise yesterday's "Plan
  // tomorrow" picks, otherwise whatever the week board assigned to today.
  let preIds = (doc.morning?.top3 || []).map((t) => t.id).filter((id) => byId.has(id));
  if (!preIds.length) {
    const yesterday = await S.store.getDay(addDays(dateISO, -1));
    const draft = yesterday.evening?.tomorrowDraftTasks || [];
    const byKey = new Map(master.tasks.map((t) => [taskKey(t.task), t.id]));
    preIds = draft.map((t) => (t.id && byId.has(t.id) ? t.id : byKey.get(taskKey(t.task)))).filter(Boolean);
    if (!preIds.length) preIds = (weekDoc.tasks || []).filter((t) => t.assignedDay === dk && byId.has(t.id)).map((t) => t.id);
  }
  S.picked = new Set(preIds.filter((id) => isOpen(byId.get(id)) || (doc.morning?.top3 || []).some((t) => t.id === id)));
  const weekDay = new Map((weekDoc.tasks || []).filter((t) => t.assignedDay).map((t) => [t.id, t.assignedDay]));
  const m = doc.morning || {};
  const challenge = [m.potentialChallenge, m.challengePlan].filter(Boolean).join(" — ");

  return `
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <h2>Quote</h2>
      <div class="affirm">
        <p class="serif">"${esc(q.text)}"</p>
        <div class="anchor"><b>—</b><span>${esc(q.author || "")}</span></div>
      </div>
      <div class="btnrow"><button class="btn sm" id="shufflequote">Another</button><button class="btn sm" id="aiquote">Fit one to my day (AI)</button></div>
      <p class="savenote" id="quotenote" style="margin-top:8px"></p>
    </section>
    <section class="blk">
      <h2>Pick today's tasks</h2>
      <div class="todaypin" id="todaypin">${todayPinHtml(master)}</div>
      ${Object.entries(PILLARS)
        .map(([k, label], i) => categoryListHtml(k, label, master.tasks.filter((t) => t.pillar === k && (isOpen(t) || S.picked.has(t.id))), weekDay, i < 2))
        .join("")}
    </section>
    <section class="blk">
      <h2>This morning</h2>
      <label class="fld"><span>What are you excited about today?</span><textarea id="excited" rows="2">${esc(m.excitedAbout || "")}</textarea></label>
      <label class="fld"><span>Today is a success if…</span><textarea id="anchor" rows="2">${esc(m.successAnchor || "")}</textarea></label>
      <label class="fld"><span>Challenge &amp; plan</span><textarea id="challenge" rows="2" placeholder="What might get in the way — and what you'll do about it">${esc(challenge)}</textarea></label>
      <label class="fld"><span>People to connect with (comma-separated)</span><input type="text" id="people" value="${esc((m.peopleToConnect || []).join(", "))}"></label>
    </section>
    <div class="btnrow">
      <button class="btn pri" id="saveplan">${doc.morning ? "Save plan" : "Start my day"}</button>
      <button class="btn" id="cancelplan">Cancel</button>
    </div>`;
}

function todayPinHtml(master) {
  const picked = master.tasks.filter((t) => S.picked.has(t.id));
  return `<div class="k">Today · ${picked.length} picked</div>${
    picked.map((t) => `<div class="it"><span class="pdot" data-p="${t.pillar}"></span>${esc(t.task)}</div>`).join("") ||
    `<div class="it" style="color:var(--muted)">Tick tasks below, or add a new one in its category.</div>`
  }`;
}

function catRowHtml(t, weekDay) {
  const tag = t.due ? `due ${shortDue(t.due)}` : weekDay.get(t.id) ? `week: ${weekDay.get(t.id)}` : "";
  return `
    <label class="catrow" data-id="${esc(t.id)}">
      <input type="checkbox" class="pick" value="${esc(t.id)}" ${S.picked.has(t.id) ? "checked" : ""}>
      <span class="tk">${esc(t.task)}</span>
      ${tag ? `<span class="due">${esc(tag)}</span>` : ""}
      <button type="button" class="drop" data-drop="${esc(t.id)}" title="Remove from your list">×</button>
    </label>`;
}

function categoryListHtml(key, label, tasks, weekDay, openByDefault) {
  const pickedHere = tasks.filter((t) => S.picked.has(t.id)).length;
  return `
    <details class="cat" data-cat="${key}" ${openByDefault || pickedHere ? "open" : ""}>
      <summary><span class="pdot" data-p="${key}"></span><span class="nm">${esc(label)}</span><span class="cnt">${pickedHere ? pickedHere + " picked · " : ""}${tasks.length} open</span></summary>
      <div class="body">
        <div class="rows">${tasks.map((t) => catRowHtml(t, weekDay)).join("")}</div>
        <form class="catadd" data-pillar="${key}">
          <input type="text" class="newcat" placeholder="+ New ${esc(label)} task" enterkeyhint="done" autocomplete="off">
          <button type="submit" class="btn sm">Add</button>
        </form>
        <p class="caterr" hidden></p>
      </div>
    </details>`;
}

function shortDue(iso) {
  const [, mo, d] = iso.split("-").map(Number);
  return `${mo}/${d}`;
}

function coreStepsRail(doc, which, defs) {
  const steps = doc.evening?.[which] || {};
  return `<div class="rail">${defs
    .map(
      ([k, l]) => `
      <button class="step" data-which="${which}" data-key="${k}" aria-pressed="${steps[k] === true}">
        <span class="dot"></span><span class="lb">${esc(l)}</span>
      </button>`
    )
    .join("")}</div>`;
}

function taskRow(t, group, i) {
  return `
    <div class="taskrow">
      <button class="task" data-group="${group}" data-i="${i}" data-s="${t.status || "not_started"}">
        <span class="box"></span>
        <span class="body"><span class="t">${esc(t.task)}</span><span class="meta">${esc(PILLARS[t.pillar] || t.pillar)}</span></span>
      </button>
      <button class="rm" data-group="${group}" data-i="${i}" title="Remove">×</button>
    </div>`;
}

function answersHtml(m) {
  const challenge = [m.potentialChallenge, m.challengePlan].filter(Boolean).join(" — ");
  const rows = [
    ["Excited about", m.excitedAbout],
    ["Success if", m.successAnchor],
    ["Challenge & plan", challenge],
    ["Connect with", (m.peopleToConnect || []).join(", ")],
  ].filter(([, v]) => v);
  return rows.length ? `<dl class="answers">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
}

function dayInProgress(dateISO, doc) {
  const q = readQuote(doc.morning) || {};
  const top3 = doc.morning?.top3 || [];
  const additionalTasks = doc.morning?.additionalTasks || [];
  const notes = doc.notes || [];
  return `
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <div class="todaypin">
        <div class="k">Today's plan</div>
        <div class="tasks" data-taskgroup="morning-top3">${top3.map((t, i) => taskRow(t, "morning-top3", i)).join("") || `<p class="empty" style="padding:4px 0">No tasks picked.</p>`}</div>
        ${answersHtml(doc.morning || {})}
      </div>
      <div class="btnrow" style="margin-top:0"><button class="btn sm" id="editmorning">Edit morning</button></div>
    </section>
    <section class="blk">
      <h2>How's the day going?</h2>
      <div class="notes">${notes
        .map(
          (n, i) => `
        <div class="note ${n.kind === "insight" ? "insight" : ""}">
          <input type="time" class="notetime-edit" data-i="${i}" value="${esc(n.t)}">
          <span class="txt">${esc(n.text)}</span>
          <button class="del" data-i="${i}" title="Delete">×</button>
        </div>`
        )
        .join("")}</div>
      <textarea id="notetext" rows="5" placeholder="Thoughts, updates, anything worth remembering… (⌘/Ctrl+Enter to add)"></textarea>
      <div class="composer" style="margin-top:8px;justify-content:flex-end">
        <input type="time" id="notetime" value="${esc(nowHM())}" title="Time for this entry">
        <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:12.5px;color:var(--muted)"><input type="checkbox" id="noteinsight"> insight</label>
        <button class="btn pri" id="addnote">Add note</button>
      </div>
    </section>
    ${q.text ? `<section class="blk"><div class="affirm"><p class="serif">"${esc(q.text)}"</p>${q.author ? `<div class="anchor"><b>—</b><span>${esc(q.author)}</span></div>` : ""}</div></section>` : ""}
    ${
      additionalTasks.length
        ? `<section class="blk">
      <h2>Also today <span class="count">if there's time</span></h2>
      <div class="tasks" data-taskgroup="morning-additional">${additionalTasks.map((t, i) => taskRow(t, "morning-additional", i)).join("")}</div>
    </section>`
        : ""
    }
    <section class="blk">
      <h2>Business core steps <span class="count">${coreCount(doc, "businessCoreSteps") ?? 0}/6</span></h2>
      ${coreStepsRail(doc, "businessCoreSteps", BIZ)}
    </section>
    <section class="blk">
      <h2>Vitality core steps <span class="count">${coreCount(doc, "vitalityCoreSteps") ?? 0}/6</span></h2>
      ${coreStepsRail(doc, "vitalityCoreSteps", VIT)}
    </section>
    <div class="btnrow"><button class="btn pri" id="startevening">Evening review →</button></div>`;
}

// The day's journal as one block of text for the evening review to start from.
function journalDigest(doc) {
  return (doc.notes || []).map((n) => n.text.trim()).filter(Boolean).join("\n");
}

function eveningForm(dateISO, doc, monthDoc, weekDoc) {
  const e = doc.evening || {};
  const m = doc.morning || {};
  const top3 = doc.morning?.top3 || e.top3Results || [];
  const additionalTasks = doc.morning?.additionalTasks || e.additionalResults || [];
  const improve = readImproveTomorrow(e.reflections);
  const hph = e.hph || {};
  const vit = e.vitalityCoreSteps || {};
  const digest = journalDigest(doc);
  const synth = e.synthesis || digest;
  const doneToday = top3.filter((t) => t.status === "done");

  // "Plan tomorrow": today's unfinished tasks to carry over; anything else
  // gets picked from the full list in tomorrow's morning picker.
  const unfinishedToday = [...top3, ...additionalTasks].filter((t) => t.status !== "done");
  // Reopening a saved review shows what was actually saved, not a fresh
  // "everything ticked" default — otherwise a re-save quietly re-adds unticked tasks.
  const savedDraft = e.completedAt && Array.isArray(e.tomorrowDraftTasks) ? e.tomorrowDraftTasks.filter((t) => t.id) : null;
  const carryTicked = savedDraft ? new Set(savedDraft.map((t) => t.id)) : new Set(unfinishedToday.map((t) => t.id));
  const todayIds = new Set(unfinishedToday.map((t) => t.id));
  const addedForTomorrow = (savedDraft || []).filter((t) => !todayIds.has(t.id));

  return `
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <h2>Evening review</h2>
      ${digest && !e.synthesis ? `<div class="prefill"><b>From your journal</b>Your notes are pre-filled below — edit them into how the day actually went.</div>` : ""}
      ${m.successAnchor ? `<div class="prefill" style="background:var(--raised)"><b style="color:var(--ink-2)">Success check</b>"${esc(m.successAnchor)}"${doneToday.length ? ` — done: ${esc(doneToday.map((t) => t.task).join(" · "))}` : ""}</div>` : ""}
      <p class="empty" style="padding:0 0 10px">Only fill in what the journal missed. Be honest — no credit for what didn't happen.</p>
    </section>
    <section class="blk">
      <h2>Today's tasks — final status</h2>
      <div class="tasks" data-taskgroup="evening-top3">${top3.map((t, i) => taskRow(t, "evening-top3", i)).join("")}</div>
    </section>
    ${
      additionalTasks.length
        ? `<section class="blk">
      <h2>Also today — final status</h2>
      <div class="tasks" data-taskgroup="evening-additional">${additionalTasks.map((t, i) => taskRow(t, "evening-additional", i)).join("")}</div>
    </section>`
        : ""
    }
    <section class="blk">
      <div class="btnrow" style="margin-top:0"><button class="btn sm" id="aidraft">Draft with AI</button></div>
      <p class="savenote" id="draftnote" style="margin-top:8px"></p>
    </section>
    <section class="blk">
      <h2>Synthesis</h2>
      <label class="fld"><span>How the day actually went — planned vs. actual</span><textarea id="e_synth" rows="${synth ? 5 : 3}">${esc(synth)}</textarea></label>
    </section>
    <section class="blk">
      <h2>Anchor met?</h2>
      <select id="anchormet">
        ${["yes", "partially", "no"].map((v) => `<option value="${v}" ${e.successAnchorMet === v ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </section>
    <section class="blk">
      <h2>Reflections</h2>
      <label class="fld"><span>Gratitude</span><textarea id="r_grat" rows="2">${esc(e.reflections?.gratitude || "")}</textarea></label>
      <label class="fld"><span>Handled well</span><textarea id="r_well" rows="2">${esc(e.reflections?.taskHandledWell || "")}</textarea></label>
      <label class="fld"><span>Learned</span><textarea id="r_learn" rows="2">${esc(e.reflections?.learned || "")}</textarea></label>
      <label class="fld"><span>Improve tomorrow</span><textarea id="r_improve" rows="2">${esc(improve)}</textarea></label>
    </section>
    <section class="blk">
      <h2>Vitality check-in</h2>
      <div class="rail rail4">${VIT_EVENING_CHECKIN.map(
        ([k, l]) => `
        <button class="step eve-vit-step" data-key="${k}" aria-pressed="${vit[k] === true}">
          <span class="dot"></span><span class="lb">${esc(l)}</span>
        </button>`
      ).join("")}</div>
      <p class="savenote" style="margin-top:8px">Same checklist as the day view's rail — Daily Read and Sleep stay there, these four are just surfaced here too.</p>
    </section>
    <section class="blk">
      <h2>HPH — score honestly, 1–10</h2>
      <div class="hphlist">
        ${HPH.map(
          ([k, l]) => `
          <div class="hphrow">
            <span class="nm">${l}</span>
            <input type="range" min="1" max="10" step="1" data-hph="${k}" value="${hph[k] ?? 5}">
            <span class="num" id="hphnum_${k}">${hph[k] ?? 5}</span>
          </div>`
        ).join("")}
      </div>
      <label class="fld" style="margin-top:12px"><span>Note on anything below 6 (one sentence, no lecture)</span><input type="text" id="hphnote" value="${esc(e.hphNote || "")}"></label>
    </section>
    <section class="blk">
      <h2>Plan tomorrow</h2>
      <div class="picker">
        ${pickerGroup("Carry over?", "didn't finish today", unfinishedToday, carryTicked)}
        ${pickerGroup("Added for tomorrow", "from your last save", addedForTomorrow, new Set(addedForTomorrow.map((t) => t.id)))}
      </div>
      ${!unfinishedToday.length ? `<p class="empty">Nothing left over from today.</p>` : ""}
      <label class="fld" style="margin-top:10px;margin-bottom:6px"><span>Add something new for tomorrow (one per line)</span><textarea id="tomorrownew" rows="2" placeholder="Type a task…"></textarea></label>
      <label class="fld" style="margin-bottom:0"><span>Category for new tasks</span><select id="tomorrowpillar">${Object.entries(PILLARS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <p class="savenote" style="margin-top:8px">Tomorrow morning these come pre-ticked; everything else on your list is one tap away there.</p>
    </section>
    <div class="btnrow">
      <button class="btn pri" id="saveevening">Save evening review</button>
      <button class="btn" id="cancelevening">Cancel</button>
    </div>`;
}

function daySummary(dateISO, doc) {
  const e = doc.evening;
  const m = doc.morning || {};
  const q = readQuote(m);
  const avg = hphAvg(doc);
  const top3 = e.top3Results?.length ? e.top3Results : m.top3 || [];
  const additionalTasks = e.additionalResults?.length ? e.additionalResults : m.additionalTasks || [];
  const hph = e.hph || {};

  return `
    ${
      q || m.successAnchor || m.excitedAbout
        ? `<section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <h2>This morning</h2>
      ${q ? `<div class="affirm"><p class="serif">"${esc(q.text)}"</p>${q.author ? `<div class="anchor"><b>—</b><span>${esc(q.author)}</span></div>` : ""}</div>` : ""}
      ${m.successAnchor ? `<div class="anchor" style="margin-top:12px"><b>Success if</b><span>${esc(m.successAnchor)}</span></div>` : ""}
      ${m.excitedAbout ? `<p style="margin:10px 0 0"><b>Excited about:</b> ${esc(m.excitedAbout)}</p>` : ""}
      ${m.potentialChallenge ? `<p style="margin:6px 0 0"><b>Challenge:</b> ${esc(m.potentialChallenge)}${m.challengePlan ? ` — ${esc(m.challengePlan)}` : ""}</p>` : ""}
      ${(m.peopleToConnect || []).length ? `<p style="margin:6px 0 0"><b>People:</b> ${esc(m.peopleToConnect.join(", "))}</p>` : ""}
      <div class="btnrow" style="margin-top:10px"><button class="btn sm" id="editmorning">Edit morning</button></div>
    </section>`
        : ""
    }
    ${
      top3.length
        ? `<section class="blk" ${q || m.successAnchor ? "" : `style="border-top:0;padding-top:0;margin-top:0"`}>
      <h2>Today's tasks</h2>
      <div class="tasks">${top3.map((t) => `<div class="task" data-s="${t.status || "not_started"}" style="cursor:default"><span class="box"></span><span class="body"><span class="t">${esc(t.task)}</span><span class="meta">${esc(PILLARS[t.pillar] || t.pillar)}</span></span></div>`).join("")}</div>
    </section>`
        : ""
    }
    ${
      additionalTasks.length
        ? `<section class="blk">
      <h2>Also today</h2>
      <div class="tasks">${additionalTasks.map((t) => `<div class="task" data-s="${t.status || "not_started"}" style="cursor:default"><span class="box"></span><span class="body"><span class="t">${esc(t.task)}</span><span class="meta">${esc(PILLARS[t.pillar] || t.pillar)}</span></span></div>`).join("")}</div>
    </section>`
        : ""
    }
    <section class="blk">
      <div class="stats">
        <div class="stat"><div class="k">HPH avg</div><div class="v">${avg != null ? avg.toFixed(1) : "—"}</div></div>
        <div class="stat"><div class="k">Anchor met</div><div class="v" style="font-size:20px">${esc(e.successAnchorMet || "—")}</div></div>
      </div>
    </section>
    ${
      Object.keys(hph).length
        ? `<section class="blk"><h2>HPH</h2><div class="hphlist">${HPH.map(
            ([k, l]) =>
              `<div class="hphrow"><span class="nm">${l}</span><div class="track"><div class="fill" style="width:${((hph[k] || 0) / 10) * 100}%"></div></div><span class="num">${hph[k] ?? "—"}</span></div>`
          ).join("")}</div>${e.hphNote ? `<p class="savenote" style="margin-top:8px">${esc(e.hphNote)}</p>` : ""}</section>`
        : ""
    }
    ${e.synthesis ? `<section class="blk"><h2>Synthesis</h2><p>${esc(e.synthesis)}</p></section>` : ""}
    <section class="blk">
      <h2>Reflections</h2>
      <p><b>Gratitude:</b> ${esc(e.reflections?.gratitude || "—")}</p>
      <p><b>Handled well:</b> ${esc(e.reflections?.taskHandledWell || "—")}</p>
      <p><b>Learned:</b> ${esc(e.reflections?.learned || "—")}</p>
      <p><b>Improve tomorrow:</b> ${esc(readImproveTomorrow(e.reflections))}</p>
    </section>
    <div class="btnrow"><button class="btn" id="editevening">Edit evening review</button></div>`;
}

/* ═══ wiring ═══════════════════════════════════════════════ */

// Morning picker. Everything updates in place (never a full renderToday) so
// answers typed into the morning questions below are never wiped.
let pickerWeekDay = new Map();
let pickerWired = false;

async function refreshPickerCounts() {
  const pin = $("#todaypin");
  if (!pin) return;
  const master = await S.store.getTasks();
  pin.innerHTML = todayPinHtml(master);
  document.querySelectorAll(".cat").forEach((cat) => {
    const rows = cat.querySelectorAll(".catrow");
    const n = [...rows].filter((r) => S.picked.has(r.dataset.id)).length;
    cat.querySelector(".cnt").textContent = `${n ? n + " picked · " : ""}${rows.length} open`;
  });
}

// Listeners go on #main once — #main outlives every re-render, so wiring it
// per render would stack duplicate handlers.
function wirePicker(weekDoc) {
  pickerWeekDay = new Map((weekDoc.tasks || []).filter((t) => t.assignedDay).map((t) => [t.id, t.assignedDay]));
  if (pickerWired) return;
  pickerWired = true;
  const refreshCounts = refreshPickerCounts;
  const root = main();
  root.addEventListener("change", (e) => {
    if (S.view !== "today" || !e.target.classList.contains("pick")) return;
    e.target.checked ? S.picked.add(e.target.value) : S.picked.delete(e.target.value);
    refreshCounts();
  });
  root.addEventListener("click", async (e) => {
    const drop = e.target.closest(".catrow .drop");
    if (S.view !== "today" || !drop) return;
    e.preventDefault();
    const row = drop.closest(".catrow");
    if (drop.dataset.armed !== "1") {
      drop.dataset.armed = "1";
      drop.textContent = "Remove?";
      setTimeout(() => {
        if (drop.isConnected) {
          drop.dataset.armed = "";
          drop.textContent = "×";
        }
      }, 3000);
      return;
    }
    const id = drop.dataset.drop;
    const err = row.closest(".cat").querySelector(".caterr");
    drop.disabled = true;
    const ok = await removeTask(S.store, id).catch(() => null);
    drop.disabled = false;
    if (ok) {
      S.picked.delete(id);
      row.remove();
      err.hidden = true;
      refreshCounts();
      flash("Removed from your list.");
    } else {
      showCatError(err, "Couldn't remove it");
    }
  });
  // A real <form> per category: Enter and the phone keyboard's Done/Go both
  // submit it, and the Add button is there for anyone who doesn't press Enter.
  root.addEventListener("submit", async (e) => {
    const form = e.target.closest("form.catadd");
    if (S.view !== "today" || !form) return;
    e.preventDefault();
    const input = form.querySelector(".newcat");
    const btn = form.querySelector("button");
    const err = form.closest(".cat").querySelector(".caterr");
    const text = input.value.trim();
    if (!text || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Saving…";
    let created = null;
    try {
      created = await addTasks(S.store, [{ task: text, pillar: form.dataset.pillar }], `life-os: new task`);
    } catch {
      created = null;
    } finally {
      btn.disabled = false;
      btn.textContent = "Add";
    }
    if (!created) {
      showCatError(err, "Couldn't save it");
      return;
    }
    err.hidden = true;
    const t = created[0];
    S.picked.add(t.id);
    form.closest(".cat").querySelector(".rows").insertAdjacentHTML("beforeend", catRowHtml(t, pickerWeekDay));
    input.value = "";
    input.focus();
    refreshCounts();
  });
}

function showCatError(el, what) {
  el.textContent = `${what} — ${S.store.lastTasksError || "Couldn't reach GitHub."} Tap again to retry.`;
  el.hidden = false;
}

function wireToday(dateISO, doc, monthDoc, weekDoc) {
  $("#prevday")?.addEventListener("click", () => {
    S.day = addDays(dateISO, -1);
    S.planning = false;
    S.eveningEditing = false;
    renderToday();
  });
  $("#nextday")?.addEventListener("click", () => {
    if (dateISO >= todayISO()) return;
    S.day = addDays(dateISO, 1);
    S.planning = false;
    S.eveningEditing = false;
    renderToday();
  });
  $("#jumptoday")?.addEventListener("click", () => {
    S.day = todayISO();
    S.planning = false;
    S.eveningEditing = false;
    renderToday();
  });

  $("#startplan")?.addEventListener("click", () => {
    S.planning = true;
    renderToday();
  });
  $("#editmorning")?.addEventListener("click", () => {
    S.planning = true;
    S.eveningEditing = false;
    renderToday();
  });
  $("#skiptoevening")?.addEventListener("click", () => {
    S.eveningEditing = true;
    S.store.saveDay(dateISO, { evening: {} }, false);
    renderToday();
  });
  $("#cancelplan")?.addEventListener("click", () => {
    S.planning = false;
    renderToday();
  });

  wirePicker(weekDoc);

  let shuffled = null;
  $("#shufflequote")?.addEventListener("click", () => {
    const cur = shuffled || quoteForDate(dateISO);
    shuffled = randomQuote(cur.text);
    const p = $(".affirm p");
    const a = $(".anchor span");
    if (p) p.textContent = `"${shuffled.text}"`;
    if (a) a.textContent = shuffled.author;
  });
  $("#aiquote")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const note = $("#quotenote");
    btn.disabled = true;
    note.textContent = "Thinking…";
    note.className = "savenote thinking";
    try {
      shuffled = await pickQuoteAI(dateISO, monthDoc, weekDoc);
      const p = $(".affirm p");
      const a = $(".anchor span");
      if (p) p.textContent = `"${shuffled.text}"`;
      if (a) a.textContent = shuffled.author;
      note.textContent = shuffled.why || "";
      note.className = "savenote";
    } catch (err) {
      note.textContent = err instanceof AiError ? err.message : "Couldn't reach AI.";
      note.className = "savenote warn";
    } finally {
      btn.disabled = false;
    }
  });

  $("#saveplan")?.addEventListener("click", async () => {
    const quote = shuffled || quoteForDate(dateISO);
    const master = await S.store.getTasks();
    // Picked tasks keep their master id, so ticking one done here is the same
    // task on the Week board and in the Outlook sync. Re-editing keeps any
    // status already set today.
    const prevStatus = new Map((doc.morning?.top3 || []).map((t) => [t.id, t.status]));
    const top3 = master.tasks
      .filter((t) => S.picked.has(t.id))
      .map((t) => ({ id: t.id, task: t.task, pillar: t.pillar, status: prevStatus.get(t.id) || (t.status === "done" ? "done" : "not_started") }));

    const morning = writeMorningQuote(
      {
        completedAt: nowHM(),
        excitedAbout: $("#excited").value.trim(),
        potentialChallenge: $("#challenge").value.trim(),
        challengePlan: "",
        successAnchor: $("#anchor").value.trim(),
        peopleToConnect: $("#people").value.split(",").map((s) => s.trim()).filter(Boolean),
        top3,
        additionalTasks: doc.morning?.additionalTasks || [],
      },
      quote
    );
    S.store.saveDay(dateISO, { date: dateISO, dayOfWeek: dayOfWeekName(dateISO), morning }, true, `life-os: today ${dateISO}`);
    S.planning = false;
    flash("Plan saved.");
    renderToday();
  });

  // Journal: tap a task to mark it done (tap again to undo). Updated in place,
  // not via renderToday, so a half-typed journal note isn't wiped; the master
  // list gets the same status so the Week board and Outlook export agree.
  document.querySelectorAll(".task[data-group='morning-top3']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const top3 = [...(doc.morning.top3 || [])];
      const status = top3[i].status === "done" ? "not_started" : "done";
      top3[i] = { ...top3[i], status };
      S.store.saveDay(dateISO, { morning: { top3 } }, true);
      doc.morning.top3 = top3;
      btn.dataset.s = status;
      setTaskStatus(S.store, [top3[i].id], status, `life-os: ${status === "done" ? "done" : "reopened"} ${top3[i].id}`);
    });
  });
  document.querySelectorAll(".task[data-group='morning-additional']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const additionalTasks = [...(doc.morning.additionalTasks || [])];
      additionalTasks[i] = { ...additionalTasks[i], status: CYCLE[additionalTasks[i].status || "not_started"] };
      S.store.saveDay(dateISO, { morning: { additionalTasks } }, true);
      doc.morning.additionalTasks = additionalTasks;
      renderToday();
    });
  });
  // Delete — morning context is safe to fully re-render on click, same as the
  // status-cycle handlers just above.
  document.querySelectorAll(".rm[data-group='morning-top3']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const top3 = (doc.morning.top3 || []).filter((_, idx) => idx !== i);
      doc.morning.top3 = top3;
      S.store.saveDay(dateISO, { morning: { top3 } }, true);
      renderToday();
    });
  });
  document.querySelectorAll(".rm[data-group='morning-additional']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const additionalTasks = (doc.morning.additionalTasks || []).filter((_, idx) => idx !== i);
      doc.morning.additionalTasks = additionalTasks;
      S.store.saveDay(dateISO, { morning: { additionalTasks } }, true);
      renderToday();
    });
  });

  // Evening-context cycle + delete both update doc.morning in place and avoid a
  // full renderToday() — that would wipe whatever's currently being typed into
  // Synthesis/Reflections below. Delete regenerates just its own .tasks
  // container (found via data-taskgroup) and re-wires it, rather than the
  // whole form.
  function wireEveningTaskGroup(group) {
    const isTop3 = group.endsWith("top3");
    const readArr = () => (isTop3 ? doc.morning?.top3 || doc.evening?.top3Results || [] : doc.morning?.additionalTasks || doc.evening?.additionalResults || []);
    const writeArr = (arr) => {
      // doc.morning can be absent here (evening review skipped straight past a
      // day with no morning plan), so don't assume it exists.
      doc.morning = doc.morning || {};
      if (isTop3) doc.morning.top3 = arr;
      else doc.morning.additionalTasks = arr;
    };
    document.querySelectorAll(`.task[data-group='${group}']`).forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        const arr = [...readArr()];
        arr[i] = { ...arr[i], status: CYCLE[arr[i].status || "not_started"] };
        writeArr(arr);
        btn.dataset.s = arr[i].status;
      });
    });
    document.querySelectorAll(`.rm[data-group='${group}']`).forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        const arr = readArr().filter((_, idx) => idx !== i);
        writeArr(arr);
        const container = document.querySelector(`.tasks[data-taskgroup='${group}']`);
        if (!container) return;
        container.innerHTML = arr.map((t, idx) => taskRow(t, group, idx)).join("");
        wireEveningTaskGroup(group);
      });
    });
  }
  wireEveningTaskGroup("evening-top3");
  wireEveningTaskGroup("evening-additional");

  document.querySelectorAll(".step:not(.eve-vit-step)").forEach((btn) => {
    btn.addEventListener("click", () => {
      const which = btn.dataset.which;
      const key = btn.dataset.key;
      const cur = doc.evening?.[which] || {};
      const next = { ...cur, [key]: !cur[key] };
      const defs = which === "businessCoreSteps" ? BIZ : VIT;
      next.totalCompleted = defs.filter(([k]) => next[k] === true).length;
      S.store.saveDay(dateISO, { evening: { [which]: next } }, true);
      doc.evening = { ...doc.evening, [which]: next };
      renderToday();
    });
  });
  // The evening review's own vitality check-in writes to the same
  // evening.vitalityCoreSteps field as the day rail above, but toggling it here
  // must NOT re-render the whole form — that would wipe whatever's mid-typing
  // in Synthesis/Reflections. Update the button and save in place instead.
  document.querySelectorAll(".eve-vit-step").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const cur = doc.evening?.vitalityCoreSteps || {};
      const next = { ...cur, [key]: !cur[key] };
      next.totalCompleted = VIT.filter(([k]) => next[k] === true).length;
      S.store.saveDay(dateISO, { evening: { vitalityCoreSteps: next } }, true);
      doc.evening = { ...doc.evening, vitalityCoreSteps: next };
      btn.setAttribute("aria-pressed", String(next[key] === true));
    });
  });

  $("#addnote")?.addEventListener("click", () => addNote());
  $("#notetext")?.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addNote();
  });
  function addNote() {
    const text = $("#notetext").value.trim();
    if (!text) return;
    const kind = $("#noteinsight").checked ? "insight" : "note";
    const t = $("#notetime")?.value || nowHM();
    const notes = [...(doc.notes || []), { t, text, kind }];
    S.store.saveDay(dateISO, { notes }, true);
    doc.notes = notes;
    renderToday();
  }
  document.querySelectorAll(".note .del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const notes = (doc.notes || []).filter((_, idx) => idx !== i);
      S.store.saveDay(dateISO, { notes }, true);
      doc.notes = notes;
      renderToday();
    });
  });
  document.querySelectorAll(".notetime-edit").forEach((input) => {
    input.addEventListener("change", () => {
      const i = Number(input.dataset.i);
      const notes = [...(doc.notes || [])];
      if (!notes[i] || !input.value) return;
      notes[i] = { ...notes[i], t: input.value };
      S.store.saveDay(dateISO, { notes }, true);
      doc.notes = notes;
    });
  });

  $("#startevening")?.addEventListener("click", () => {
    S.eveningEditing = true;
    renderToday();
  });
  $("#editevening")?.addEventListener("click", () => {
    S.eveningEditing = true;
    renderToday();
  });
  $("#cancelevening")?.addEventListener("click", () => {
    S.eveningEditing = false;
    renderToday();
  });
  $("#aidraft")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const note = $("#draftnote");
    btn.disabled = true;
    note.textContent = "Thinking…";
    note.className = "savenote thinking";
    try {
      const draft = await draftEveningAI(dateISO, doc, monthDoc, weekDoc);
      $("#e_synth").value = draft.synthesis || "";
      $("#anchormet").value = draft.successAnchorMet || "yes";
      $("#r_grat").value = draft.reflections?.gratitude || "";
      $("#r_well").value = draft.reflections?.taskHandledWell || "";
      $("#r_learn").value = draft.reflections?.learned || "";
      $("#r_improve").value = draft.reflections?.improveTomorrow || "";
      HPH.forEach(([k]) => {
        const v = draft.hph?.[k];
        if (v == null) return;
        const input = document.querySelector(`[data-hph="${k}"]`);
        input.value = v;
        $(`#hphnum_${k}`).textContent = v;
      });
      $("#hphnote").value = draft.hphNote || "";
      note.textContent = "Draft filled in — review and edit before saving, especially the HPH scores.";
      note.className = "savenote";
    } catch (err) {
      note.textContent = err instanceof AiError ? err.message : "Couldn't reach AI.";
      note.className = "savenote warn";
    } finally {
      btn.disabled = false;
    }
  });

  HPH.forEach(([k]) => {
    const input = document.querySelector(`[data-hph="${k}"]`);
    input?.addEventListener("input", () => {
      $(`#hphnum_${k}`).textContent = input.value;
    });
  });

  $("#saveevening")?.addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    const top3Results = [...(doc.morning?.top3 || doc.evening?.top3Results || [])];
    const additionalResults = [...(doc.morning?.additionalTasks || doc.evening?.additionalResults || [])];
    const hph = {};
    let sum = 0;
    HPH.forEach(([k]) => {
      const v = Number(document.querySelector(`[data-hph="${k}"]`).value);
      hph[k] = v;
      sum += v;
    });
    hph.average = Math.round((sum / HPH.length) * 100) / 100;
    const reflections = writeReflections(
      {
        gratitude: $("#r_grat").value.trim(),
        taskHandledWell: $("#r_well").value.trim(),
        learned: $("#r_learn").value.trim(),
      },
      $("#r_improve").value.trim()
    );

    // Final statuses go to the master list too: done here means done everywhere,
    // and anything un-done here is reopened there.
    const master = await S.store.getTasks();
    const masterStatus = new Map(master.tasks.map((t) => [t.id, t.status]));
    const nowDone = top3Results.filter((t) => t.status === "done" && masterStatus.has(t.id) && masterStatus.get(t.id) !== "done").map((t) => t.id);
    const reopened = top3Results.filter((t) => t.status !== "done" && masterStatus.get(t.id) === "done").map((t) => t.id);
    if (nowDone.length) await setTaskStatus(S.store, nowDone, "done", `life-os: evening ${dateISO}`);
    if (reopened.length) await setTaskStatus(S.store, reopened, "not_started", `life-os: evening ${dateISO}`);

    // "Plan tomorrow": carry-overs keep their master id; anything typed new is
    // added to the master list first so tomorrow's picker can pre-tick it.
    const tomorrowPool = [...top3Results, ...additionalResults, ...(doc.evening?.tomorrowDraftTasks || []).filter((t) => t.id)];
    const checkedTomorrowIds = new Set([...document.querySelectorAll(".addlpick:checked")].map((el) => el.value));
    const seenTomorrow = new Set();
    const tomorrowFromPicker = tomorrowPool
      .filter((t) => checkedTomorrowIds.has(t.id) && !seenTomorrow.has(t.id) && seenTomorrow.add(t.id))
      .map((t) => ({ id: t.id, task: t.task, pillar: t.pillar }));
    const newLines = parseTaskLines($("#tomorrownew")?.value || "");
    const created = newLines.length
      ? (await addTasks(S.store, newLines.map((task) => ({ task, pillar: $("#tomorrowpillar").value })), `life-os: evening ${dateISO}`)) || []
      : [];
    const tomorrowDraftTasks = [...tomorrowFromPicker, ...created.map((t) => ({ id: t.id, task: t.task, pillar: t.pillar }))];

    // Claim: a board task picked here for tomorrow gets tagged to that day, same
    // reasoning as the morning plan's "If there's time" claim — but only when
    // tomorrow is still in this same week's file. If today is Sunday, tomorrow
    // is a new week's file; claiming across that boundary would really be a
    // carry-forward, which Week's own picker already handles as an opt-in pull,
    // so it's left alone here rather than silently reaching into another file.
    const tomorrowISO = addDays(dateISO, 1);
    if (mondayOf(tomorrowISO) === mondayOf(dateISO)) {
      const tomorrowDk = dayKeyOf(tomorrowISO);
      const weekTasks = weekDoc.tasks || [];
      let boardChanged = false;
      const claimedWeekTasks = weekTasks.map((wt) => {
        if (!checkedTomorrowIds.has(wt.id) || wt.assignedDay === tomorrowDk) return wt;
        boardChanged = true;
        return { ...wt, assignedDay: tomorrowDk };
      });
      if (boardChanged) {
        weekDoc.tasks = claimedWeekTasks;
        S.store.saveWeek(mondayOf(dateISO), { tasks: claimedWeekTasks }, true, `life-os: evening ${dateISO}`);
      }
    }

    const evening = {
      completedAt: nowHM(),
      synthesis: $("#e_synth").value.trim(),
      top3Results,
      additionalResults,
      successAnchorMet: $("#anchormet").value,
      businessCoreSteps: doc.evening?.businessCoreSteps || {},
      vitalityCoreSteps: doc.evening?.vitalityCoreSteps || {},
      reflections,
      hph,
      hphNote: $("#hphnote").value.trim(),
      tomorrowDraftTasks,
    };
    S.store.saveDay(dateISO, { evening }, true, `life-os: evening ${dateISO}`);
    S.eveningEditing = false;
    flash("Evening review saved.");
    renderToday();
  });
}
