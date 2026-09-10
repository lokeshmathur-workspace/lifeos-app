import { Store, loadConfig, saveConfig, clearConfig, loadPinHash, savePinHash, clearPin, sha256Hex } from "./store.js";
import { nextTaskId } from "./compact.js";
import { readQuote, readImproveTomorrow, writeReflections, writeMorningQuote } from "./migrate.js";
import { PILLARS, BIZ, VIT, HPH, CYCLE } from "./constants.js";
import { quoteForDate, randomQuote } from "./quotes.js";
import { todayISO, nowHM, addDays, dayOfWeekName, dayKeyOf, prettyDate } from "./dateutil.js";
import { streak, hphAvg, coreCount, top3Of, computeAll } from "./derive.js";
import { loadAiConfig, saveAiConfig, clearAiConfig, pickQuoteAI, draftEveningAI, AiError } from "./ai.js";
import { copyDayForOneNote, downloadFullBackup } from "./export.js";
import { renderWeekView } from "./week.js";
import { renderMonthView } from "./month.js";
import { flash } from "./flash.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const main = () => $("#main");
const wrap = () => $("#wrap");

const S = {
  store: null,
  view: "today",
  day: todayISO(),
  unlocked: false,
  planning: false,
  eveningEditing: false,
};

/* ═══ boot / auth / pin ═══════════════════════════════════ */

export async function boot() {
  const cfg = loadConfig();
  if (!cfg) return renderSetup();
  S.store = new Store(cfg, flash);

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
}

window.addEventListener("lifeos:goto-day", (e) => {
  S.day = e.detail;
  S.view = "today";
  S.planning = false;
  S.eveningEditing = false;
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
      const doc = await S.store.getDay(S.day);
      await copyDayForOneNote(S.day, doc);
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
  boot();
});

/* ═══ settings (token status, one-click removal, PIN) ═══════ */

function openSettings() {
  const cfg = loadConfig();
  const ai = loadAiConfig();
  const mask = (t) => (t ? t.slice(0, 7) + "…" + t.slice(-4) : "");
  const pinSet = !!loadPinHash();
  const back = document.createElement("div");
  back.className = "modalback";
  back.innerHTML = `
    <div class="modal">
      <h2 style="margin-top:0">Settings</h2>
      <p class="savenote">Connected to <span class="mono">${esc(cfg?.repo || "")}</span> as <span class="mono">${esc(mask(cfg?.token))}</span>. Stored only in this browser.</p>
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
}

/* ═══ today ════════════════════════════════════════════════ */

async function renderToday() {
  main().innerHTML = `<p class="empty">Loading…</p>`;
  const dateISO = S.day;
  const doc = await S.store.getDay(dateISO);
  const state = await S.store.getState();

  const html = [];
  html.push(dateHead(dateISO));

  if (S.planning) {
    html.push(await planningForm(dateISO, doc, state));
  } else if (!doc.morning) {
    html.push(planPrompt(dateISO));
  } else if (S.eveningEditing) {
    html.push(eveningForm(dateISO, doc));
  } else if (!doc.evening?.completedAt) {
    html.push(dayInProgress(dateISO, doc));
  } else {
    html.push(daySummary(dateISO, doc));
  }

  main().innerHTML = html.join("");
  wireToday(dateISO, doc, state);
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

async function planningForm(dateISO, doc, state) {
  const q = doc.morning?.quote ? readQuote(doc.morning) : quoteForDate(dateISO);
  const dk = dayKeyOf(dateISO);
  const suggested = (state.currentWeek?.tasks || []).filter(
    (t) => t.assignedDay === dk && t.status !== "done"
  );
  const carried = (doc.morning?.top3 || []);
  const prefill = carried.length ? carried : suggested.slice(0, 3);
  while (prefill.length < 3) prefill.push({ task: "", pillar: "careerWork" });

  const pillarOpts = (sel) =>
    Object.entries(PILLARS).map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${l}</option>`).join("");

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
      <h2>This morning</h2>
      <label class="fld"><span>What are you excited about today?</span><textarea id="excited" rows="2">${esc(doc.morning?.excitedAbout || "")}</textarea></label>
      <label class="fld"><span>Potential challenge</span><textarea id="challenge" rows="2">${esc(doc.morning?.potentialChallenge || "")}</textarea></label>
      <label class="fld"><span>Plan for it</span><textarea id="challengeplan" rows="2">${esc(doc.morning?.challengePlan || "")}</textarea></label>
      <label class="fld"><span>Today is a success if…</span><textarea id="anchor" rows="2">${esc(doc.morning?.successAnchor || "")}</textarea></label>
      <label class="fld"><span>People to connect with (comma-separated)</span><input type="text" id="people" value="${esc((doc.morning?.peopleToConnect || []).join(", "))}"></label>
    </section>
    <section class="blk">
      <h2>Top 3</h2>
      ${prefill
        .map(
          (t, i) => `
        <div class="t3row">
          <input type="text" data-i="${i}" class="t3task" value="${esc(t.task)}" placeholder="Task ${i + 1}">
          <select data-i="${i}" class="t3pillar">${pillarOpts(t.pillar)}</select>
        </div>`
        )
        .join("")}
    </section>
    <div class="btnrow">
      <button class="btn pri" id="saveplan">Save plan</button>
      <button class="btn" id="cancelplan">Cancel</button>
    </div>`;
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
    <button class="task" data-group="${group}" data-i="${i}" data-s="${t.status || "not_started"}">
      <span class="box"></span>
      <span class="body"><span class="t">${esc(t.task)}</span><span class="meta">${esc(PILLARS[t.pillar] || t.pillar)}</span></span>
    </button>`;
}

function dayInProgress(dateISO, doc) {
  const q = readQuote(doc.morning) || {};
  const top3 = doc.morning?.top3 || [];
  const notes = doc.notes || [];
  return `
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <div class="affirm">
        <p class="serif">"${esc(q.text)}"</p>
        ${q.author ? `<div class="anchor"><b>—</b><span>${esc(q.author)}</span></div>` : ""}
      </div>
      <div class="anchor"><b>Anchor</b><span>${esc(doc.morning?.successAnchor || "—")}</span></div>
    </section>
    <section class="blk">
      <h2>Top 3</h2>
      <div class="tasks">${top3.map((t, i) => taskRow(t, "morning-top3", i)).join("")}</div>
    </section>
    <section class="blk">
      <h2>Business core steps <span class="count">${coreCount(doc, "businessCoreSteps") ?? 0}/6</span></h2>
      ${coreStepsRail(doc, "businessCoreSteps", BIZ)}
    </section>
    <section class="blk">
      <h2>Vitality core steps <span class="count">${coreCount(doc, "vitalityCoreSteps") ?? 0}/6</span></h2>
      ${coreStepsRail(doc, "vitalityCoreSteps", VIT)}
    </section>
    <section class="blk">
      <h2>Journal</h2>
      <div class="notes">${notes
        .map(
          (n, i) => `
        <div class="note ${n.kind === "insight" ? "insight" : ""}">
          <time>${esc(n.t)}</time><span class="txt">${esc(n.text)}</span>
          <button class="del" data-i="${i}" title="Delete">×</button>
        </div>`
        )
        .join("")}</div>
      <div class="composer">
        <textarea id="notetext" rows="1" placeholder="Add a note… (⌘/Ctrl+Enter to add)"></textarea>
        <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:12.5px;color:var(--muted)"><input type="checkbox" id="noteinsight"> insight</label>
        <button class="btn" id="addnote">Add</button>
      </div>
    </section>
    <div class="btnrow"><button class="btn pri" id="startevening">Evening review</button></div>`;
}

function eveningForm(dateISO, doc) {
  const e = doc.evening || {};
  const top3 = doc.morning?.top3 || e.top3Results || [];
  const improve = readImproveTomorrow(e.reflections);
  const hph = e.hph || {};
  return `
    <section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <h2>Evening review</h2>
      <p class="empty" style="padding:0 0 10px">Be honest — this only helps if it's accurate. No credit for what didn't happen.</p>
    </section>
    <section class="blk">
      <h2>Top 3 — final status</h2>
      <div class="tasks">${top3.map((t, i) => taskRow(t, "evening-top3", i)).join("")}</div>
    </section>
    <section class="blk">
      <div class="btnrow" style="margin-top:0"><button class="btn sm" id="aidraft">Draft with AI</button></div>
      <p class="savenote" id="draftnote" style="margin-top:8px"></p>
    </section>
    <section class="blk">
      <h2>Synthesis</h2>
      <label class="fld"><span>How the day actually went — planned vs. actual</span><textarea id="e_synth" rows="3">${esc(e.synthesis || "")}</textarea></label>
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
  const hph = e.hph || {};

  return `
    ${
      q || m.successAnchor || m.excitedAbout
        ? `<section class="blk" style="border-top:0;padding-top:0;margin-top:0">
      <h2>This morning</h2>
      ${q ? `<div class="affirm"><p class="serif">"${esc(q.text)}"</p>${q.author ? `<div class="anchor"><b>—</b><span>${esc(q.author)}</span></div>` : ""}</div>` : ""}
      ${m.successAnchor ? `<div class="anchor" style="margin-top:12px"><b>Anchor</b><span>${esc(m.successAnchor)}</span></div>` : ""}
      ${m.excitedAbout ? `<p style="margin:10px 0 0"><b>Excited about:</b> ${esc(m.excitedAbout)}</p>` : ""}
      ${m.potentialChallenge ? `<p style="margin:6px 0 0"><b>Challenge:</b> ${esc(m.potentialChallenge)}${m.challengePlan ? ` — ${esc(m.challengePlan)}` : ""}</p>` : ""}
      ${(m.peopleToConnect || []).length ? `<p style="margin:6px 0 0"><b>People:</b> ${esc(m.peopleToConnect.join(", "))}</p>` : ""}
    </section>`
        : ""
    }
    ${
      top3.length
        ? `<section class="blk" ${q || m.successAnchor ? "" : `style="border-top:0;padding-top:0;margin-top:0"`}>
      <h2>Top 3</h2>
      <div class="tasks">${top3.map((t) => `<div class="task" data-s="${t.status || "not_started"}" style="cursor:default"><span class="box"></span><span class="body"><span class="t">${esc(t.task)}</span><span class="meta">${esc(PILLARS[t.pillar] || t.pillar)}</span></span></div>`).join("")}</div>
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

function wireToday(dateISO, doc, state) {
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
  $("#skiptoevening")?.addEventListener("click", () => {
    S.eveningEditing = true;
    S.store.saveDay(dateISO, { evening: {} }, false);
    renderToday();
  });
  $("#cancelplan")?.addEventListener("click", () => {
    S.planning = false;
    renderToday();
  });

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
      shuffled = await pickQuoteAI(dateISO, state);
      const p = $(".affirm p");
      const a = $(".anchor span");
      if (p) p.textContent = `"${shuffled.text}"`;
      if (a) a.textContent = shuffled.author;
      note.textContent = shuffled.why || "";
      note.className = "savenote";
    } catch (err) {
      note.textContent = err instanceof AiError ? err.message : "Couldn't reach AI.";
      note.className = "savenote";
    } finally {
      btn.disabled = false;
    }
  });

  $("#saveplan")?.addEventListener("click", () => {
    const quote = shuffled || quoteForDate(dateISO);
    const top3Inputs = [...document.querySelectorAll(".t3task")];
    const pillarInputs = [...document.querySelectorAll(".t3pillar")];
    const existing = [state.currentWeek?.tasks || [], doc.morning?.top3 || []];
    const top3 = top3Inputs
      .map((inp, i) => ({ task: inp.value.trim(), pillar: pillarInputs[i].value }))
      .filter((t) => t.task)
      .map((t) => ({
        id: nextTaskId(dateISO, existing),
        task: t.task,
        pillar: t.pillar,
        status: "not_started",
      }));
    // ensure unique ids even when several are generated in the same batch
    const seen = new Set();
    for (const t of top3) {
      while (seen.has(t.id)) t.id = nextTaskId(dateISO, [...existing, top3]);
      seen.add(t.id);
    }
    const morning = writeMorningQuote(
      {
        completedAt: nowHM(),
        excitedAbout: $("#excited").value.trim(),
        potentialChallenge: $("#challenge").value.trim(),
        challengePlan: $("#challengeplan").value.trim(),
        successAnchor: $("#anchor").value.trim(),
        peopleToConnect: $("#people").value.split(",").map((s) => s.trim()).filter(Boolean),
        top3,
      },
      quote
    );
    S.store.saveDay(dateISO, { date: dateISO, dayOfWeek: dayOfWeekName(dateISO), morning }, true, `life-os: today ${dateISO}`);
    S.planning = false;
    flash("Plan saved.");
    renderToday();
  });

  document.querySelectorAll(".task[data-group='morning-top3']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const top3 = [...(doc.morning.top3 || [])];
      top3[i] = { ...top3[i], status: CYCLE[top3[i].status || "not_started"] };
      S.store.saveDay(dateISO, { morning: { top3 } }, true);
      doc.morning.top3 = top3;
      renderToday();
    });
  });
  document.querySelectorAll(".task[data-group='evening-top3']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const top3 = [...(doc.morning?.top3 || doc.evening?.top3Results || [])];
      top3[i] = { ...top3[i], status: CYCLE[top3[i].status || "not_started"] };
      doc.morning.top3 = top3;
      renderToday();
    });
  });

  document.querySelectorAll(".step").forEach((btn) => {
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

  $("#addnote")?.addEventListener("click", () => addNote());
  $("#notetext")?.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addNote();
  });
  function addNote() {
    const text = $("#notetext").value.trim();
    if (!text) return;
    const kind = $("#noteinsight").checked ? "insight" : "note";
    const notes = [...(doc.notes || []), { t: nowHM(), text, kind }];
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
      const draft = await draftEveningAI(dateISO, doc, state);
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
      note.className = "savenote";
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

  $("#saveevening")?.addEventListener("click", () => {
    const top3Results = [...(doc.morning?.top3 || doc.evening?.top3Results || [])];
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
    const evening = {
      completedAt: nowHM(),
      synthesis: $("#e_synth").value.trim(),
      top3Results,
      successAnchorMet: $("#anchormet").value,
      businessCoreSteps: doc.evening?.businessCoreSteps || {},
      vitalityCoreSteps: doc.evening?.vitalityCoreSteps || {},
      reflections,
      hph,
      hphNote: $("#hphnote").value.trim(),
    };
    S.store.saveDay(dateISO, { evening }, true, `life-os: evening ${dateISO}`);
    S.eveningEditing = false;
    flash("Evening review saved.");
    renderToday();
    refreshComputed(dateISO); // fire-and-forget; doesn't block the save the user is waiting on
  });
}

/* ═══ computed.json write-back ════════════════════════════ */
// Keeps life-os/state/computed.json in sync with what scripts/recompute.py would
// produce, so validate.yml's staleness check stays green even though nothing runs
// the Python script in this flow anymore. Runs in the background after an evening
// save; failures are non-fatal (computed.json is derived data — a stale run just
// means it regenerates cleanly next time).
async function refreshComputed(latestISO) {
  try {
    const [y, m] = latestISO.split("-").map(Number);
    const monthDates = [];
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d++) {
      monthDates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    const monthMap = await S.store.loadJournalMap(monthDates.filter((d) => d <= latestISO));
    const streakMap = await S.store.loadBackToGap(latestISO);
    const merged = new Map([...monthMap, ...streakMap]);

    // learningPending / careerSprint come from outside life-os/journal — read
    // them fresh rather than zeroing them, matching recompute.py's own inputs.
    const [{ json: queue }, { json: career }] = await Promise.all([
      S.store.gh.getFile("learning/queue.json"),
      S.store.gh.getFile("life-os/state/career-ascent.json"),
    ]);
    let learningPending = 0;
    for (const item of queue?.items || []) {
      learningPending += (item.actionItems || []).filter((a) => a.status === "pending").length;
    }
    const tasks = career?.activeSprint?.tasks || [];
    const done = tasks.filter((t) => t.status === "done").length;
    const careerSprint = tasks.length
      ? { completed: done, total: tasks.length, pct: Math.round((100 * done) / tasks.length) }
      : {};

    const computed = computeAll(merged, { learningPending, careerSprint });
    await S.store.saveComputed(computed);
  } catch {
    // best-effort — see comment above
  }
}
