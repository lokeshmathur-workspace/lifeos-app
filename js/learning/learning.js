// Learning tab — Phase H merge of the standalone learning-app into this
// app's shared nav shell. Same event-delegation shape the original used (one
// click/input/change listener, data-act dispatch) — that pattern coexists
// fine with Today/Week/Month's own directly-wired listeners since neither
// touches the other's data-act/data-v/etc. attributes. What changed moving
// in: no more separate auth/PIN/Settings screens (the app has exactly one of
// each now — see boot()/openSettings() in ../app.js), state lives nested
// under S.learning instead of its own top-level S, rendering targets the
// shared #main (wrapped in a .learning div, which is what gives this tab its
// own green accent — see index.html's tokens), and toasts go through the
// shared flash() instead of a separate toast element.
import { fireRoutine, RoutineError } from "./routine.js";
import { isPendingCapture } from "./store.js";
import { PILLARS, SOURCE_TYPES, CAPTURE_STATUS, QUEUE_ACTION_STATUS, BRIEF_TOPICS } from "./constants.js";
import { fmtRelative, todayISO, prettyDate } from "../dateutil.js";
import { flash } from "../flash.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Module-level refs, set on every call to renderLearningView() — the same
// three values throughout the app's life in practice, but refreshed anyway
// since nothing here should assume otherwise.
let S, learningStore, renderApp;
let pollTimer = null;

// A processing run in flight: { firedAt, keys: ["LB002/C005", ...], sessionUrl }.
// Kept in localStorage (not just memory) so leaving the page, switching tabs
// or reloading can't lose it — losing it is what used to re-offer Process
// now mid-run and let a second, overlapping run start.
const RUN_KEY = "learning.processing";
const RUN_TTL_MS = 15 * 60 * 1000;
const POLL_MS = 5000;

function loadRun() {
  try {
    const run = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
    return run && Date.now() - Date.parse(run.firedAt) < RUN_TTL_MS ? run : null;
  } catch {
    return null;
  }
}

function saveRun(run) {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(run));
  } catch {
    /* private mode etc. — the in-memory poll still covers this page's life */
  }
}

function clearRun() {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

function runExpired() {
  try {
    const run = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
    return !!run && Date.now() - Date.parse(run.firedAt) >= RUN_TTL_MS;
  } catch {
    return false;
  }
}

function defaultLearningState() {
  return {
    view: "home", // home | new | source | capture | actions
    curId: null,
    sources: [],
    index: null,
    queue: { items: [] },
    form: null,
    draft: null,
    busy: "",
    fatal: "",
    fullCaptures: {},
    actionUI: {},
    briefForm: null,
    delArm: null,
    meta: null,
  };
}

function L() {
  return S.learning;
}

function actionUIFor(capId) {
  const l = L();
  if (!l.actionUI[capId]) l.actionUI[capId] = { picks: new Set(), custom: [], saving: false };
  return l.actionUI[capId];
}

export async function renderLearningView(store, _S, _renderApp) {
  S = _S;
  learningStore = store;
  renderApp = _renderApp;
  if (!S.learning) {
    S.learning = defaultLearningState();
    render();
    await loadHome();
    ensurePolling();
    return;
  }
  render();
  ensurePolling();
}

async function loadHome() {
  const l = L();
  try {
    l.index = await learningStore.getIndex(true);
    l.queue = await learningStore.getQueue(true);
    l.sources = l.index.sources;
  } catch (e) {
    l.fatal = e.message || "Couldn't load your library.";
  }
  render();
}

/* ---------- Home / dashboard (FR-1) ---------- */
function vHome() {
  const l = L();
  if (l.fatal) return `<h1 class="serif">Learning</h1><p class="empty" style="margin-top:16px">${esc(l.fatal)}</p>`;
  const active = l.sources.filter((s) => s.status !== "finished").sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const books = active.filter((s) => s.type === "book");
  const vids = active.filter((s) => s.type === "video");
  const arts = active.filter((s) => s.type === "article" || s.type === "other");
  const done = l.sources.filter((s) => s.status === "finished").sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""));
  // Grouped by the queue item's own sourceType, not by matching l.sources —
  // that also covers queue items from before this app existed (e.g. a brief
  // written via a manual chat session), which have no sources/index.json
  // row to match against but do carry sourceType. "youtube" (the existing
  // real-data value) and "video" (this app's Type picker value) both roll
  // up under "Videos".
  const TYPE_LABEL = { book: "Books", video: "Videos", youtube: "Videos", article: "Articles", other: "Other" };
  const actionsByType = {};
  let openActions = 0;
  for (const it of l.queue.items || []) {
    const n = (it.actionItems || []).filter((a) => a.status !== QUEUE_ACTION_STATUS.DONE && a.status !== QUEUE_ACTION_STATUS.DISMISSED).length;
    openActions += n;
    if (n) {
      const label = TYPE_LABEL[it.sourceType] || "Other";
      actionsByType[label] = (actionsByType[label] || 0) + n;
    }
  }
  const actionsBreakdown = Object.entries(actionsByType).map(([label, n]) => `${label} ${n}`).join(" · ");
  const captures = l.sources.reduce((n, s) => n + (s.captureCount || 0), 0);
  const pendingSources = l.sources.filter((s) => (s.pendingCount || 0) > 0);
  const pendingTotal = pendingSources.reduce((n, s) => n + s.pendingCount, 0);

  const dashDelBtn = (s) => {
    const armed = l.delArm === `dash:${s.id}`;
    return `<button class="rm${armed ? " danger" : ""}" data-act="delsrcdash" data-id="${s.id}" aria-label="Delete">${armed ? "Confirm?" : "×"}</button>`;
  };
  const bookCard = (s) => {
    const pct = s.totalPages && s.lastPage ? Math.min(100, Math.round((parseInt(s.lastPage, 10) / s.totalPages) * 100)) : null;
    const n = s.openActionCount || 0;
    return `<div class="card book" data-act="open" data-id="${s.id}">
      <div class="row"><div><div class="book-title">${esc(s.title)}</div>
      <div class="meta">${esc(s.author || "")}${s.author ? " · " : ""}${s.captureCount || 0} notes${s.lastPage ? " · last p. " + esc(s.lastPage) : ""}${s.updatedAt ? " · " + fmtRelative(s.updatedAt) : ""}</div></div>
      <div style="display:flex;gap:8px;align-items:center">${n ? `<span class="badge">${n} action${n > 1 ? "s" : ""}</span>` : ""}${dashDelBtn(s)}</div></div>
      ${pct !== null && !isNaN(pct) ? `<div class="bar" aria-label="${pct}% read"><i style="width:${pct}%"></i></div>` : ""}
      <div class="btnrow">
        <button class="btn" data-act="cap" data-mode="page" data-id="${s.id}">Add page</button>
        <button class="btn" data-act="cap" data-mode="thought" data-id="${s.id}">Add thought</button>
      </div></div>`;
  };
  const rows = (arr) =>
    arr.length
      ? `<div class="list">${arr
          .map((s) => {
            const n = s.openActionCount || 0;
            return `<div class="li" data-act="open" data-id="${s.id}"><div><div class="li-title">${esc(s.title)}</div><div class="meta">${esc(s.author || SOURCE_TYPES[s.type])} · ${s.captureCount || 0} notes${s.updatedAt ? " · " + fmtRelative(s.updatedAt) : ""}</div></div><div style="display:flex;gap:8px;align-items:center">${n ? `<span class="badge">${n}</span>` : ""}${dashDelBtn(s)}</div></div>`;
          })
          .join("")}</div>`
      : "";

  return `<div class="top"><div><h1 class="serif">Learning</h1><div class="sub">${prettyDate(todayISO())}</div></div>
  <button class="btn ghost" data-act="settings" style="flex:0 1 auto">Settings</button></div>
  <div class="stats"><div class="stat"><div class="k">Captures</div><div class="v">${captures}</div></div>
  <button class="stat" data-act="actions" style="cursor:pointer;text-align:left"><div class="k">Actions pending</div><div class="v">${openActions}</div>${actionsBreakdown ? `<span style="display:block;margin-top:3px;font-size:11px;color:var(--muted);font-weight:600">${esc(actionsBreakdown)}</span>` : ""}</button></div>
  ${homeProcessHint(pendingTotal)}
  <h2>Books you're reading <span class="count">${books.length || ""}</span></h2>
  ${books.length ? books.map(bookCard).join("") : `<div class="empty">Start a book to capture pages, highlights and notes as you read.</div>`}
  <h2>Videos <span class="count">${vids.length || ""}</span></h2>${rows(vids) || `<div class="empty">Add a YouTube link and paste the transcript or your notes to capture learnings.</div>`}
  <h2>Articles and web <span class="count">${arts.length || ""}</span></h2>${rows(arts) || `<div class="empty">Add an article link and paste the text to get a summary.</div>`}
  ${done.length ? `<details style="margin-top:22px"><summary>Finished (${done.length})</summary><div style="margin-top:10px">${rows(done)}</div></details>` : ""}
  <div class="btnrow" style="margin-top:24px"><button class="btn pri" data-act="new" data-type="book">New book</button><button class="btn" data-act="new" data-type="video">Add link</button></div>`;
}

function homeProcessHint(pendingTotal) {
  const run = loadRun();
  if (run) {
    return `<p class="hint" style="margin-top:14px"><span class="live" style="margin-right:8px"></span><b>Processing ${run.keys.length} item${run.keys.length > 1 ? "s" : ""}</b> — usually 2–3 minutes. Everything updates on its own.</p>`;
  }
  if (!pendingTotal) return "";
  return `<p class="hint" style="margin-top:14px">${pendingTotal} item${pendingTotal > 1 ? "s" : ""} waiting for processing — open the book and tap <b>Process now</b> (one tap processes everything waiting).</p>`;
}

/* ---------- New source (FR-2) ---------- */
function vNew() {
  const f = L().form;
  const isBook = f.type === "book";
  return `<button class="btn ghost back" data-act="home">‹ Library</button><h1 class="serif">${isBook ? "New book" : "Add a video or article"}</h1>
  <label>Type</label><div class="typeseg">${Object.entries(SOURCE_TYPES).map(([k, v]) => `<button class="btn" aria-pressed="${f.type === k}" data-act="ftype" data-type="${k}">${v}</button>`).join("")}</div>
  <label for="f-title">Title</label><input id="f-title" type="text" data-f="title" value="${esc(f.title)}" placeholder="${isBook ? "The Culture Code" : "Why AI pilots stall"}">
  <label for="f-author">${isBook ? "Author" : "Creator or publication"}</label><input id="f-author" type="text" data-f="author" value="${esc(f.author)}" placeholder="${isBook ? "Daniel Coyle" : "Harvard Business Review"}">
  ${isBook
    ? `<label for="f-pages">Total pages (optional, for progress)</label><input id="f-pages" type="number" inputmode="numeric" data-f="totalPages" value="${esc(f.totalPages)}" placeholder="304">`
    : `<label for="f-url">Link</label><input id="f-url" type="url" inputmode="url" data-f="url" value="${esc(f.url)}" placeholder="https://youtube.com/watch?v=…">
  <label for="f-text">Transcript, article text or your notes (optional)</label><textarea id="f-text" data-f="text" style="min-height:140px" placeholder="Paste the transcript or article text — Process now will summarize the learnings.">${esc(f.text)}</textarea>`}
  ${f.err ? `<p class="err">${esc(f.err)}</p>` : ""}
  <div class="sticky"><button class="btn pri" style="width:100%" data-act="create" ${L().busy ? "disabled" : ""}>${isBook ? "Start book" : "Add"}</button></div>`;
}

async function createSource() {
  const l = L();
  const f = l.form;
  if (!f.title.trim()) {
    f.err = "Enter a title first.";
    return render();
  }
  l.busy = "create";
  render();
  const id = await learningStore.createSource({
    type: f.type,
    title: f.title.trim(),
    author: (f.author || "").trim(),
    url: (f.url || "").trim(),
    totalPages: parseInt(f.totalPages, 10) || undefined,
  });
  l.busy = "";
  if (!id) {
    render();
    return;
  }
  l.sources = [...l.sources, { id, type: f.type, title: f.title.trim(), author: (f.author || "").trim(), status: "active", captureCount: 0, pendingCount: 0, openActionCount: 0, updatedAt: new Date().toISOString() }];
  const text = (f.text || "").trim();
  const url = (f.url || "").trim();
  l.form = null;
  if (url) {
    await learningStore.addLinkCapture(id, { url, pastedText: text });
    flash("Added — waiting for processing.");
  }
  await openSource(id);
}

/* ---------- Source detail (FR-3) ---------- */
async function openSource(id) {
  const l = L();
  l.curId = id;
  l.view = "source";
  l.meta = null;
  l.fullCaptures = {};
  l.actionUI = {};
  l.briefForm = null;
  render();
  l.meta = await learningStore.getSource(id, true);
  if (!l.meta) {
    // Genuinely gone (deleted elsewhere, or a stale index row from before
    // this session's cache-refresh fix) — drop it from the in-memory list
    // so vSource()'s existing "This item was removed" branch shows instead
    // of hanging on a spinner forever, and Home stops offering it too.
    l.sources = l.sources.filter((r) => r.id !== id);
    render();
    return;
  }
  render();
  // meta.json's captures[] is a light projection (no transcript/insights/
  // suggestedActions) — fetch each ready capture's full file so capCard()
  // can actually show its content.
  const ready = (l.meta?.captures || []).filter((c) => c.status === CAPTURE_STATUS.READY || c.status === CAPTURE_STATUS.NEEDS_TEXT);
  await loadFullCaptures(id, ready);
  if (l.view === "source" && l.curId === id) render();
}

// Always a fresh read: the in-memory copy may be the pending version this
// session wrote at upload time, from before the routine filled it in.
async function loadFullCaptures(sourceId, rows) {
  const l = L();
  await Promise.all(
    rows.map(async (c) => {
      const full = await learningStore.getCapture(sourceId, c.id, true);
      if (full && l.curId === sourceId) l.fullCaptures[c.id] = full;
    })
  );
}

// Resolves a queue actionId to its human-readable text/pillar, for showing
// already-confirmed actions by content rather than just their id — cross-
// referencing l.queue (already loaded at app level), not a new fetch.
function queueAction(actionId) {
  for (const item of L().queue.items || []) {
    const a = (item.actionItems || []).find((x) => x.actionId === actionId);
    if (a) return a;
  }
  return null;
}

function pagesHTML(full, capId) {
  const set = new Set((full.highlights || []).map((h) => `${h.page}.${h.para}.${h.sentence}`));
  return (full.pages || [])
    .map((pg, pi) => {
      const pageLabel = pg.page ? `<div class="pgno">Page ${esc(pg.page)}</div>` : "";
      const paras = (pg.paragraphs || [])
        .map(
          (pa, ai) =>
            "<p>" +
            (pa.sentences || [])
              .map((s, si) => {
                const on = set.has(`${pi}.${ai}.${si}`);
                return `<span class="s${on ? " hl" : ""}" role="button" tabindex="0" aria-pressed="${on}" data-act="hl" data-cid="${capId}" data-pi="${pi}" data-ai="${ai}" data-si="${si}">${esc(s)}</span> `;
              })
              .join("") +
            "</p>"
        )
        .join("");
      return pageLabel + paras;
    })
    .join("");
}

function insightsHTML(full) {
  const ins = full.insights;
  if (!ins || (!(ins.points || []).length && !(ins.connections || []).length)) return "";
  return `<div class="block block-insights"><div class="block-label">Insights</div><ul class="ins">${(ins.points || [])
    .map((p) => `<li>${esc(p)}</li>`)
    .join("")}${(ins.connections || []).map((c) => `<li>Connects to: ${esc(c)}</li>`).join("")}</ul></div>`;
}

function actionsHTML(full, capId) {
  const confirmed = (full.confirmedActions || [])
    .map((id) => ({ id, a: queueAction(id) }))
    .filter(({ a }) => !a || a.status !== QUEUE_ACTION_STATUS.DISMISSED);
  const suggested = full.suggestedActions || [];
  const ui = actionUIFor(capId);
  if (!confirmed.length && !suggested.length && !ui.custom.length) return "";
  const pickedCount = ui.picks.size + ui.custom.length;

  let h = `<div class="block block-actions"><div class="block-label">Actions</div>`;
  if (confirmed.length) {
    h += confirmed
      .map(
        ({ id, a }) =>
          `<div class="confirmedrow"><span style="flex:1 1 auto">${esc(a ? a.action : id)}${a ? ` <span class="meta" style="margin:0">· ${esc(PILLARS[a.pillar] || a.pillar)}</span>` : ""}</span><button class="rm" data-act="dismissaction" data-id="${id}" aria-label="Delete task">×</button></div>`
      )
      .join("");
  }
  if (suggested.length || ui.custom.length) {
    h += `<p class="sub" style="margin:${confirmed.length ? "10px" : "0"} 0 6px">Tick or add actions, then tap Save to send them to Life OS.</p>
    <div class="acts-list">${suggested
      .map(
        (a, i) =>
          `<div class="actrow"><input type="checkbox" id="pk-${capId}-${i}" data-act="pick" data-cid="${capId}" data-i="${i}" ${ui.picks.has(i) ? "checked" : ""}><label for="pk-${capId}-${i}">${esc(a.action)}<small>${esc(PILLARS[a.pillar] || a.pillar)}</small></label></div>`
      )
      .join("")}${ui.custom
      .map(
        (c, i) =>
          `<div class="actrow"><input type="checkbox" checked disabled><label>${esc(c.action)}<small>${esc(PILLARS[c.pillar] || c.pillar)}</small></label><button class="rm" data-act="rmcustom" data-cid="${capId}" data-i="${i}" aria-label="Remove">×</button></div>`
      )
      .join("")}</div>`;
  }
  h += `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:10px">
    <input type="text" id="ca-${capId}" placeholder="Add your own action">
    <select id="cp-${capId}" aria-label="Pillar" style="width:auto">${Object.entries(PILLARS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
    <div class="btnrow" style="margin-top:8px">
      <button class="btn ghost" data-act="addcustom" data-cid="${capId}" style="flex:0 1 auto">+ Add</button>
      ${pickedCount ? `<button class="btn pri" data-act="saveactions" data-cid="${capId}" style="flex:1 1 auto" ${ui.saving ? "disabled" : ""}>${ui.saving ? "Saving…" : `Save ${pickedCount} action${pickedCount > 1 ? "s" : ""}`}</button>` : ""}
    </div></div>`;
  return h;
}

function capCard(c) {
  const l = L();
  const isBookSrc = l.sources.find((x) => x.id === l.curId)?.type === "book";
  // meta.json's light rows don't carry page numbers — take them from the full capture once loaded.
  const pageLabel = (cap) => ((cap && cap.pages) || []).map((p) => (p.page ? "p. " + p.page : isBookSrc ? "page" : "screenshot")).join(", ");
  const label = c.type === "page" ? pageLabel(c.pages ? c : l.fullCaptures[c.id]) || (isBookSrc ? "Page" : "Screenshot") : c.type === "link" ? "Summary" : "Thought" + (c.pageRef ? " · p. " + c.pageRef : "");
  const dupOf = c.duplicateOf || l.fullCaptures[c.id]?.duplicateOf;
  const armed = l.delArm === `cap:${c.id}`;
  const delBtn = `<button class="btn ghost danger" data-act="delcap" data-cid="${c.id}" style="min-height:30px">${armed ? "Confirm" : "Delete"}</button>`;
  const pending = [CAPTURE_STATUS.PENDING_TRANSCRIPTION, CAPTURE_STATUS.PENDING_SUMMARY].includes(c.status);
  if (pending) {
    const run = loadRun();
    const inRun = !!run && run.keys.includes(`${l.curId}/${c.id}`);
    const what = c.type === "link" ? "Summarizing" : "Transcribing";
    const pill = inRun ? `<span class="pill proc"><span class="live"></span>Processing</span>` : `<span class="pill">Pending</span>`;
    const text = inRun
      ? `${what} now — this updates on its own when it's done.`
      : run
        ? "Saved. Will be picked up by the next run, once the current one finishes."
        : "Saved to your library. Tap <b>Process now</b> above to transcribe/summarize it.";
    return `<div class="card" style="border-style:dashed">
      <div class="row"><div class="kicker">${esc(label)} · ${fmtRelative(c.createdAt)}</div><div style="display:flex;gap:6px;align-items:center">${pill}${delBtn}</div></div>
      <p class="sub" style="margin-top:8px">${text}</p></div>`;
  }
  if (dupOf) {
    const origLabel = pageLabel(l.fullCaptures[dupOf]) || "an earlier note";
    const dArmed = l.delArm === `cap:${c.id}`;
    return `<div class="card" style="border-style:dashed">
      <div class="row"><div class="kicker">${esc(label)} · ${fmtRelative(c.createdAt)}</div><span class="pill">Duplicate</span></div>
      <p class="sub" style="margin-top:8px">Same page as ${esc(origLabel)}, which is already in your notes.</p>
      <div class="btnrow" style="margin-top:8px"><button class="btn ${dArmed ? "danger" : ""}" data-act="delcap" data-cid="${c.id}" style="flex:0 1 auto">${dArmed ? "Tap again to remove" : "Remove duplicate"}</button></div></div>`;
  }
  if (c.status === CAPTURE_STATUS.NEEDS_RETAKE) {
    return `<div class="card"><div class="row"><div class="kicker">${esc(label)}</div><div style="display:flex;gap:6px;align-items:center"><span class="pill no">Couldn't read this</span>${delBtn}</div></div>
      <p class="sub" style="margin-top:8px">No usable text came back from this ${isBookSrc ? "photo. Retake it with better lighting." : "image. Try again with a clearer photo or screenshot."}</p></div>`;
  }
  if (c.status === CAPTURE_STATUS.NEEDS_TEXT) {
    const full = l.fullCaptures[c.id];
    const note = full?.fetchNote || c.fetchNote || "Couldn't fetch that link.";
    const saving = l.busy === `paste:${c.id}`;
    const prev = full?.pastedText || "";
    return `<div class="card"><div class="row"><div class="kicker">${esc(label)}</div><div style="display:flex;gap:6px;align-items:center"><span class="pill no">Needs text</span>${delBtn}</div></div>
      <p class="sub" style="margin-top:8px">${esc(note)}</p>
      <p class="sub" style="margin-top:6px">Open the link, select the article text (or transcript), copy it, and paste it here.</p>
      <textarea class="pastetext" data-cid="${c.id}" rows="6" placeholder="Paste the text here…" style="width:100%;margin-top:8px">${esc(prev.length >= 200 ? prev : "")}</textarea>
      <div class="btnrow" style="margin-top:8px"><button class="btn pri" data-act="pastetext" data-cid="${c.id}" ${saving ? "disabled" : ""} style="flex:0 1 auto">${saving ? "Saving…" : "Summarize this"}</button></div>
      <p class="sub pasteerr" data-cid="${c.id}" style="color:var(--danger,#c0392b)" hidden></p></div>`;
  }

  const full = l.fullCaptures[c.id];
  let body = "";
  if (!full) {
    // ready, but its full file hasn't loaded yet (openSource's fetch is
    // still in flight) — light row still has enough for a minimal card.
    if (c.type === "thought") body += `<p class="quote">${esc(c.thought)}</p>`;
    body += `<p class="sub" style="margin-top:8px">Loading…</p>`;
  } else {
    if (full.type === "page") body += `<div class="reader">${pagesHTML(full, c.id)}</div>`;
    if (full.type === "thought") body += `<p class="quote">${esc(full.thought)}</p>`;
    if (full.type === "link" && full.summary) {
      body += `<p style="margin-top:6px">${esc(full.summary.summary)}</p>`;
      if ((full.summary.learnings || []).length) {
        body += `<div class="kicker" style="margin-top:10px">Key learnings</div><ul class="ins">${full.summary.learnings.map((l2) => `<li>${esc(l2)}</li>`).join("")}</ul>`;
      }
    }
    if (full.note) body += `<div class="lnote"><b>My note</b>${esc(full.note)}</div>`;
    body += insightsHTML(full);
    body += actionsHTML(full, c.id);
  }
  return `<div class="card"><div class="row"><div class="kicker">${esc(label)} · ${fmtRelative(c.createdAt)}</div>${delBtn}</div>${body}</div>`;
}

// Builds an editable working copy of a routine-drafted brief the first
// time a source's brief block renders it — plain fields for Lokesh to
// tweak, never raw JSON.
function initBriefForm(draft, meta) {
  return {
    title: draft.title || meta.title || "",
    author: draft.author || meta.author || "",
    type: draft.type || meta.type,
    dateProcessed: draft.dateProcessed || todayISO(),
    topics: [...(draft.topics || [])],
    principles: (draft.principles || []).map((p) => ({ title: p.title || "", explanation: p.explanation || "" })),
    keyInsight: draft.keyInsight || "",
    framework: draft.framework ? { name: draft.framework.name || "", steps: (draft.framework.steps || []).map((s) => ({ step: s.step || "", desc: s.desc || "" })) } : null,
    connections: [...(draft.connections || [])],
    actionItems: draft.actionItems || [],
    retrievalQuestion: draft.retrievalQuestion || "",
    speakingReady: draft.speakingReady !== false,
  };
}

function briefBlock(meta) {
  const l = L();
  if (meta.briefId) {
    return `<div class="block block-brief"><div class="block-label">Learning Brief</div><p class="sub" style="margin:0">✓ Saved to your library.</p></div>`;
  }
  if (!meta.draftBrief) {
    // Blocked mid-run: a brief draft edits this same meta.json, so a
    // concurrent run's PR would collide with the processing run's PR.
    const running = !!loadRun();
    return `<div class="btnrow"><button class="btn" data-act="createbrief" data-id="${meta.id}" ${l.busy === "brief" || running ? "disabled" : ""}>${l.busy === "brief" ? "Drafting…" : running ? "Create learning brief (after processing)" : "Create learning brief"}</button></div>`;
  }
  if (!l.briefForm) l.briefForm = initBriefForm(meta.draftBrief, meta);
  const f = l.briefForm;
  const saving = l.busy === "savebrief";
  return `<div class="block block-brief">
  <div class="block-label">Learning Brief — Draft</div>
  <p class="sub" style="margin:0 0 10px">Review and tweak before saving to your library.</p>
  <label for="bf-title">Title</label><input id="bf-title" type="text" data-bf="title" value="${esc(f.title)}">
  <label for="bf-author">Author</label><input id="bf-author" type="text" data-bf="author" value="${esc(f.author)}">
  <label>Topics <small style="font-weight:400">(up to 3)</small></label>
  <div class="typeseg">${BRIEF_TOPICS.map((t) => `<button class="btn" type="button" aria-pressed="${f.topics.includes(t)}" data-act="brieftopic" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>
  <label>Principles</label>
  ${f.principles
    .map(
      (p, i) =>
        `<div class="reprow"><div><input type="text" data-bf="principle-title-${i}" value="${esc(p.title)}" placeholder="Principle"><textarea data-bf="principle-body-${i}" placeholder="Explanation" style="min-height:64px">${esc(p.explanation)}</textarea></div><button class="rm" data-act="rmprinciple" data-i="${i}" aria-label="Remove">×</button></div>`
    )
    .join("")}
  <div class="btnrow"><button class="btn ghost" data-act="addprinciple" style="flex:0 1 auto">+ Add principle</button></div>
  <label for="bf-ki">Key insight</label><textarea id="bf-ki" data-bf="keyInsight" style="min-height:80px">${esc(f.keyInsight)}</textarea>
  <label class="chk" style="border-top:0;padding-top:0"><input type="checkbox" data-act="togglefw" ${f.framework ? "checked" : ""}><span>This source has its own named framework or model</span></label>
  ${f.framework
    ? `<div style="margin-top:8px">
    <input type="text" data-bf="frameworkName" value="${esc(f.framework.name)}" placeholder="Framework name">
    ${f.framework.steps
      .map(
        (st, i) =>
          `<div class="reprow"><div><input type="text" data-bf="step-title-${i}" value="${esc(st.step)}" placeholder="Step"><textarea data-bf="step-desc-${i}" placeholder="What it means" style="min-height:56px">${esc(st.desc)}</textarea></div><button class="rm" data-act="rmstep" data-i="${i}" aria-label="Remove">×</button></div>`
      )
      .join("")}
    <div class="btnrow"><button class="btn ghost" data-act="addstep" style="flex:0 1 auto">+ Add step</button></div>
  </div>`
    : ""}
  <label>Connections</label>
  ${f.connections
    .map((c, i) => `<div class="reprow"><input type="text" data-bf="connection-${i}" value="${esc(c)}" placeholder="Links to another book, pillar, or idea"><button class="rm" data-act="rmconnection" data-i="${i}" aria-label="Remove">×</button></div>`)
    .join("")}
  <div class="btnrow"><button class="btn ghost" data-act="addconnection" style="flex:0 1 auto">+ Add connection</button></div>
  ${f.actionItems.length ? `<label>Confirmed actions</label><ul class="ins">${f.actionItems.map((a) => `<li>${esc(a.action)} <span class="meta" style="margin:0">· ${esc(PILLARS[a.pillar] || a.pillar)}</span></li>`).join("")}</ul>` : ""}
  <label for="bf-rq">Retrieval question</label><input id="bf-rq" type="text" data-bf="retrievalQuestion" value="${esc(f.retrievalQuestion)}">
  <label class="chk" style="border-top:0;padding-top:0"><input type="checkbox" data-bf="speakingReady" ${f.speakingReady ? "checked" : ""}><span>Ready to speak or write about this</span></label>
  <div class="btnrow" style="margin-top:14px">
    <button class="btn ghost" data-act="discardbrief" data-id="${meta.id}" style="flex:0 1 auto">Discard draft</button>
    <button class="btn pri" data-act="savebrief" data-id="${meta.id}" style="flex:1 1 auto" ${saving ? "disabled" : ""}>${saving ? "Saving…" : "Confirm & save to library"}</button>
  </div></div>`;
}

function vSource() {
  const l = L();
  const s = l.sources.find((x) => x.id === l.curId);
  const meta = l.meta;
  if (!s) return `<button class="btn ghost back" data-act="home">‹ Library</button><p class="empty">This item was removed.</p>`;
  if (!meta) return `<button class="btn ghost back" data-act="home">‹ Library</button><div class="busy"><span class="dot"></span>Loading…</div>`;
  const isBook = s.type === "book";
  const pendingHere = (meta.captures || []).filter(isPendingCapture);
  const run = loadRun();
  let processBlock = "";
  if (run) {
    const waitingNext = pendingHere.filter((c) => !run.keys.includes(`${s.id}/${c.id}`)).length;
    processBlock = `<div class="hint" style="margin-top:0"><span class="live" style="margin-right:8px"></span><b>Processing ${run.keys.length} item${run.keys.length > 1 ? "s" : ""}</b> — usually 2–3 minutes. You can leave this page; it updates on its own.${waitingNext ? ` ${waitingNext} item${waitingNext > 1 ? "s" : ""} added since will be picked up next — Process now comes back when this run finishes.` : ""}</div>
      <div class="btnrow"><button class="btn" data-act="checknow" style="flex:0 1 auto">Check now</button>${run.sessionUrl ? `<a class="btn ghost" href="${esc(run.sessionUrl)}" target="_blank" rel="noopener" style="flex:0 1 auto;text-decoration:none">View run</a>` : ""}</div>`;
  } else if (pendingHere.length) {
    processBlock = `<div class="btnrow"><button class="btn" data-act="processnow" ${l.busy === "process" ? "disabled" : ""}>${l.busy === "process" ? "Starting…" : "Process now"}</button></div>`;
  }
  return `<button class="btn ghost back" data-act="home">‹ Library</button>
  <div class="kicker">${SOURCE_TYPES[s.type]}${meta.status === "finished" ? " · finished" : ""}</div><h1 class="serif">${esc(meta.title)}</h1>
  <div class="sub">${esc(meta.author || "")}${meta.url ? ` · <a href="${esc(meta.url)}" target="_blank" rel="noopener">Open link</a>` : ""}</div>
  <div class="btnrow">
    <button class="btn pri" data-act="cap" data-mode="page" data-id="${s.id}">${isBook ? "Add page" : "Add screenshot"}</button>
    <button class="btn" data-act="cap" data-mode="thought" data-id="${s.id}">Add thought</button>
  </div>
  ${processBlock}
  <div class="btnrow">${meta.status === "finished" ? `<button class="btn" data-act="reopen" data-id="${s.id}">Mark reading</button>` : `<button class="btn" data-act="finish" data-id="${s.id}">${isBook ? "Finished book" : "Mark done"}</button>`}</div>
  ${(meta.captures || []).length ? briefBlock(meta) : ""}
  <h2>Notes <span class="count">${(meta.captures || []).length || ""}</span></h2>
  ${(meta.captures || []).length ? meta.captures.slice().reverse().map(capCard).join("") : `<div class="empty">${isBook ? "Photograph a page or jot a thought to make your first note." : "Add a screenshot, jot a thought, or paste text to capture what you learned."}</div>`}
  <div class="btnrow" style="margin-top:30px"><button class="btn ghost danger" data-act="delsrc" style="flex:0 1 auto">${l.delArm === "src" ? "Tap again to delete this and all its notes" : "Delete"}</button></div>`;
}

async function toggleHighlight(capId, pi, ai, si) {
  const l = L();
  const full = l.fullCaptures[capId];
  if (!full) return;
  const sentence = full.pages?.[pi]?.paragraphs?.[ai]?.sentences?.[si];
  if (sentence === undefined) return;
  const cur = full.highlights || [];
  const idx = cur.findIndex((h) => h.page === pi && h.para === ai && h.sentence === si);
  const next = idx >= 0 ? cur.filter((_, i) => i !== idx) : [...cur, { page: pi, para: ai, sentence: si, text: sentence }];
  l.fullCaptures[capId] = { ...full, highlights: next };
  render();
  await learningStore.saveHighlights(l.curId, capId, next);
}

function addCustomAction(capId) {
  const input = $(`#ca-${capId}`);
  const select = $(`#cp-${capId}`);
  const action = (input?.value || "").trim();
  if (!action) return;
  actionUIFor(capId).custom.push({ action, pillar: select?.value || Object.keys(PILLARS)[0] });
  render();
  const newInput = $(`#ca-${capId}`);
  if (newInput) newInput.value = "";
}

function removeCustomAction(capId, i) {
  actionUIFor(capId).custom.splice(i, 1);
  render();
}

async function saveActionsFor(capId) {
  const l = L();
  const full = l.fullCaptures[capId];
  if (!full) return;
  const ui = actionUIFor(capId);
  const picked = (full.suggestedActions || []).filter((_, i) => ui.picks.has(i));
  const actions = [...picked, ...ui.custom];
  if (!actions.length) return;
  ui.saving = true;
  render();
  const newIds = await learningStore.confirmCaptureActions(l.curId, capId, l.meta, actions);
  ui.saving = false;
  if (newIds.length) {
    flash(`${newIds.length} action${newIds.length > 1 ? "s" : ""} added.`);
    delete l.actionUI[capId];
    l.queue = await learningStore.getQueue();
    l.meta = await learningStore.getSource(l.curId);
    const full2 = await learningStore.getCapture(l.curId, capId);
    if (full2) l.fullCaptures[capId] = full2;
    const idx = await learningStore.getIndex();
    l.sources = idx.sources;
  }
  render();
}

// Removes a task from the Open list without deleting it — sets status
// "dismissed" (per learning/CLAUDE.md's rule: a dismissed action stays in
// the queue, it's never actually deleted), so it drops out of every open
// count/list but the record (and its id) is still there in queue.json.
async function dismissAction(actionId) {
  const l = L();
  const ok = await learningStore.dismissAction(actionId);
  if (!ok) {
    flash("Couldn't remove — try again.", true);
    return;
  }
  flash("Task removed.");
  l.queue = await learningStore.getQueue();
  render();
}

// One global poll while a run is in flight — not tied to which screen is
// open, so leaving a source and coming back never loses track of it. Each
// tick re-reads only the sources the run was given; the run is done once
// none of its captures is still pending.
function ensurePolling() {
  if (runExpired()) {
    clearRun();
    flash("The last processing run didn't finish — you can tap Process now to try again.", true);
    render();
  }
  if (pollTimer || !loadRun()) return;
  pollTimer = setInterval(runTick, POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

let ticking = false;
async function runTick(manual) {
  if (ticking) return;
  const run = loadRun();
  if (!run) {
    stopPolling();
    if (runExpired()) ensurePolling();
    return;
  }
  ticking = true;
  try {
    const l = L();
    const bySource = {};
    for (const k of run.keys) {
      const [sid, cid] = k.split("/");
      (bySource[sid] = bySource[sid] || []).push(cid);
    }
    let stillPending = 0;
    let changed = false;
    for (const [sid, cids] of Object.entries(bySource)) {
      const meta = await learningStore.getSource(sid, true);
      const rows = (meta && meta.captures) || [];
      stillPending += rows.filter((c) => cids.includes(c.id) && isPendingCapture(c)).length;
      if (meta && l.curId === sid) {
        const wasPending = new Set((l.meta?.captures || []).filter(isPendingCapture).map((c) => c.id));
        const nowDone = rows.filter((c) => wasPending.has(c.id) && !isPendingCapture(c));
        if (nowDone.length) {
          changed = true;
          l.meta = meta;
          await loadFullCaptures(sid, nowDone.filter((c) => c.status === CAPTURE_STATUS.READY || c.status === CAPTURE_STATUS.NEEDS_TEXT));
        }
      }
    }
    if (!stillPending) {
      changed = true;
      clearRun();
      stopPolling();
      flash("Processing finished.");
      const idx = await learningStore.getIndex(true);
      l.sources = idx.sources;
      l.index = idx;
    } else if (manual) {
      flash("Still working on it — this updates on its own.");
    }
    // Only redraw screens that show processing state, and only on a real
    // change — a redraw every tick would steal focus mid-typing.
    if (changed && S.view === "learning" && (l.view === "home" || l.view === "source")) render();
  } catch {
    /* a failed read just means we try again next tick */
  } finally {
    ticking = false;
  }
}

async function processNow() {
  const l = L();
  if (loadRun()) return;
  l.busy = "process";
  render();
  try {
    const keys = await learningStore.pendingCaptureKeys();
    if (!keys.length) {
      flash("Nothing waiting to process.");
    } else {
      const { sessionUrl } = await fireRoutine(`process ${keys.join(" ")}`);
      saveRun({ firedAt: new Date().toISOString(), keys, sessionUrl: sessionUrl || "" });
      flash("Processing started — usually 2–3 minutes. You can leave this page.");
      ensurePolling();
    }
  } catch (e) {
    flash(e instanceof RoutineError ? e.message : "Couldn't start processing.", true);
  }
  l.busy = "";
  render();
}

async function startBriefDraft(sourceId) {
  const l = L();
  if (loadRun()) return;
  l.busy = "brief";
  render();
  try {
    await fireRoutine(`draft brief ${sourceId}`);
    flash("Drafting your brief — usually a minute or two. Reopen this book to see it.");
  } catch (e) {
    flash(e instanceof RoutineError ? e.message : "Couldn't start drafting.", true);
  }
  l.busy = "";
  render();
}

async function discardBrief(sourceId) {
  const l = L();
  const ok = await learningStore.discardDraftBrief(sourceId);
  if (!ok) {
    flash("Couldn't discard — try again.", true);
    return;
  }
  l.briefForm = null;
  l.meta = await learningStore.getSource(sourceId);
  flash("Draft discarded.");
  render();
}

async function saveBrief(sourceId) {
  const l = L();
  const f = l.briefForm;
  if (!f.title.trim()) {
    flash("Add a title first.", true);
    return;
  }
  if (!f.principles.some((p) => p.title.trim())) {
    flash("Add at least one principle first.", true);
    return;
  }
  l.busy = "savebrief";
  render();
  const briefFields = {
    title: f.title.trim(),
    author: f.author.trim(),
    type: f.type,
    dateProcessed: f.dateProcessed,
    topics: f.topics,
    principles: f.principles.filter((p) => p.title.trim()).map((p) => ({ title: p.title.trim(), explanation: p.explanation.trim() })),
    keyInsight: f.keyInsight.trim(),
    ...(f.framework && f.framework.name.trim()
      ? { framework: { name: f.framework.name.trim(), steps: f.framework.steps.filter((st) => st.step.trim()).map((st) => ({ step: st.step.trim(), desc: st.desc.trim() })) } }
      : {}),
    connections: f.connections.map((c) => c.trim()).filter(Boolean),
    actionItems: f.actionItems,
    retrievalQuestion: f.retrievalQuestion.trim(),
    speakingReady: !!f.speakingReady,
    reviewHistory: [],
  };
  const ok = await learningStore.confirmBrief(sourceId, briefFields);
  l.busy = "";
  if (!ok) {
    flash("Couldn't save — try again.", true);
    render();
    return;
  }
  flash("Brief saved to your library.");
  l.briefForm = null;
  l.meta = await learningStore.getSource(sourceId);
  const idx = await learningStore.getIndex();
  l.sources = idx.sources;
  render();
}

/* ---------- Capture editor ---------- */
function vCapture() {
  const l = L();
  const d = l.draft;
  const s = l.sources.find((x) => x.id === d.srcId) || { title: "" };
  if (d.mode === "page") {
    const isBook = s.type === "book";
    return `<button class="btn ghost back" data-act="cancelcap">‹ ${esc(s.title)}</button><h1 class="serif">${isBook ? "Add page" : "Add screenshot"}</h1>
    <p class="sub" style="margin:10px 0 16px">${isBook ? "Take a photo of the page, or pick up to 4 pages from your photos. Up to 4 pages upload together and process as one note." : "Take a screenshot or photo, or pick up to 4 images from your photos. They upload together and process as one note."}</p>
    ${l.busy === "upload"
      ? `<div class="busy"><span class="dot"></span>Uploading…</div>`
      : `<label class="btn pri filebtn" style="width:100%;margin:0">Take a photo<input type="file" accept="image/*" capture="environment" data-act="photos" aria-label="Take a photo"></label>
    <label class="btn filebtn" style="width:100%;margin:10px 0 0">Choose from library<input type="file" accept="image/*" multiple data-act="photos" aria-label="Choose from library"></label>`}
    ${d.err ? `<p class="err">${esc(d.err)}</p>` : ""}`;
  }
  if (d.mode !== "thought") {
    return `<button class="btn ghost back" data-act="cancelcap">‹ ${esc(s.title)}</button><h1 class="serif">Coming soon</h1><p class="sub" style="margin-top:10px">This capture type lands in a later update — Add page and Add thought already work.</p>`;
  }
  return `<button class="btn ghost back" data-act="cancelcap">‹ ${esc(s.title)}</button><h1 class="serif">Add a thought</h1>
  <label for="c-thought">Your thought</label><textarea id="c-thought" data-f="thought" style="min-height:140px" placeholder="What struck you, and why it matters">${esc(d.thought)}</textarea>
  ${s.type === "book" ? `<label for="c-page">Page (optional)</label><input id="c-page" type="text" inputmode="numeric" data-f="pageRef" value="${esc(d.pageRef)}" placeholder="112">` : ""}
  <label for="c-note">Your note</label><textarea id="c-note" data-f="note" placeholder="Optional — anything to add">${esc(d.note)}</textarea>
  ${d.err ? `<p class="err">${esc(d.err)}</p>` : ""}
  <div class="sticky"><button class="btn pri" style="width:100%" data-act="savethought" ${l.busy ? "disabled" : ""}>Save note</button></div>`;
}

async function uploadPagePhotos(files) {
  const l = L();
  const d = l.draft;
  if (files.length > 4) {
    flash("Using the first 4 photos.");
    files = files.slice(0, 4);
  }
  l.busy = "upload";
  d.err = "";
  render();
  const result = await learningStore.uploadPagePhotos(d.srcId, files);
  l.busy = "";
  if (!result.ok) {
    d.err = result.error;
    return render();
  }
  flash(`${files.length} photo${files.length > 1 ? "s" : ""} saved — waiting for processing.`);
  l.draft = null;
  await openSource(d.srcId);
}

async function saveThought() {
  const l = L();
  const d = l.draft;
  if (!d.thought.trim()) {
    d.err = "Write your thought first.";
    return render();
  }
  l.busy = "save";
  render();
  const capId = await learningStore.addThoughtCapture(d.srcId, { thought: d.thought.trim(), pageRef: (d.pageRef || "").trim(), note: (d.note || "").trim() });
  l.busy = "";
  if (!capId) return render();
  flash("Note saved.");
  l.draft = null;
  await openSource(d.srcId);
}

/* ---------- Actions (FR-7) ---------- */
function vActions() {
  const l = L();
  const isOpen = (a) => a.status !== QUEUE_ACTION_STATUS.DONE && a.status !== QUEUE_ACTION_STATUS.DISMISSED;
  const open = (l.queue.items || []).flatMap((it) => (it.actionItems || []).filter(isOpen).map((a) => ({ ...a, srcTitle: it.title })));
  const done = (l.queue.items || []).flatMap((it) => (it.actionItems || []).filter((a) => a.status === QUEUE_ACTION_STATUS.DONE).map((a) => ({ ...a, srcTitle: it.title })));
  const statusLabel = (a) => (a.status === QUEUE_ACTION_STATUS.ACCEPTED ? "In Life OS" : a.status === QUEUE_ACTION_STATUS.DONE ? "Done" : "Waiting for /today");
  const openItem = (a) => `<div class="chk" style="cursor:default"><span>○</span><span style="flex:1 1 auto">${esc(a.action)}<small>${esc(PILLARS[a.pillar] || a.pillar)} · ${esc(a.srcTitle || "")} · ${statusLabel(a)}</small></span><button class="rm" data-act="dismissaction" data-id="${a.actionId}" aria-label="Delete task">×</button></div>`;
  const doneItem = (a) => `<div class="chk" style="cursor:default"><span>✓</span><span>${esc(a.action)}<small>${esc(PILLARS[a.pillar] || a.pillar)} · ${esc(a.srcTitle || "")} · ${statusLabel(a)}</small></span></div>`;
  return `<button class="btn ghost back" data-act="home">‹ Library</button><h1 class="serif">Actions</h1>
  <h2>Open <span class="count">${open.length || ""}</span></h2>${open.length ? `<div class="card">${open.map(openItem).join("")}</div>` : `<div class="empty">No open actions. Actions you tick when saving a note land here.</div>`}
  ${done.length ? `<h2>Recently done</h2><div class="card">${done.slice(-15).reverse().map(doneItem).join("")}</div>` : ""}`;
}

/* ---------- render dispatch ---------- */
function render() {
  const main = document.getElementById("main");
  const l = L();
  const views = { home: vHome, new: vNew, source: vSource, capture: vCapture, actions: vActions };
  main.innerHTML = `<div class="learning">${(views[l.view] || vHome)()}</div>`;
}

/* ---------- events (registered once at module load — harmless no-ops on
   every click/input/change that happens while a different top-level tab is
   showing, since those never carry a matching data-act/data-f/data-bf) ---------- */
document.addEventListener("input", (e) => {
  if (!S || !S.learning) return;
  const l = L();
  const f = e.target.dataset.f;
  if (f) {
    if (l.view === "new" && l.form) l.form[f] = e.target.value;
    else if (l.view === "capture" && l.draft) l.draft[f] = e.target.value;
    return;
  }
  const bf = e.target.dataset.bf;
  if (!bf || l.view !== "source" || !l.briefForm) return;
  const fw = l.briefForm.framework;
  if (bf === "title") l.briefForm.title = e.target.value;
  else if (bf === "author") l.briefForm.author = e.target.value;
  else if (bf === "keyInsight") l.briefForm.keyInsight = e.target.value;
  else if (bf === "retrievalQuestion") l.briefForm.retrievalQuestion = e.target.value;
  else if (bf === "frameworkName" && fw) fw.name = e.target.value;
  else if (bf.startsWith("principle-title-")) l.briefForm.principles[+bf.split("-")[2]].title = e.target.value;
  else if (bf.startsWith("principle-body-")) l.briefForm.principles[+bf.split("-")[2]].explanation = e.target.value;
  else if (bf.startsWith("connection-")) l.briefForm.connections[+bf.split("-")[1]] = e.target.value;
  else if (bf.startsWith("step-title-") && fw) fw.steps[+bf.split("-")[2]].step = e.target.value;
  else if (bf.startsWith("step-desc-") && fw) fw.steps[+bf.split("-")[2]].desc = e.target.value;
});

document.addEventListener("change", async (e) => {
  if (!S || !S.learning) return;
  const l = L();
  if (e.target.dataset.act === "photos" && e.target.files && e.target.files.length) {
    const files = Array.from(e.target.files);
    e.target.value = "";
    await uploadPagePhotos(files);
    return;
  }
  if (e.target.dataset.act === "pick") {
    const capId = e.target.dataset.cid;
    const i = parseInt(e.target.dataset.i, 10);
    const ui = actionUIFor(capId);
    if (e.target.checked) ui.picks.add(i);
    else ui.picks.delete(i);
    render();
    return;
  }
  if (l.view === "source" && l.briefForm) {
    if (e.target.dataset.act === "togglefw") {
      l.briefForm.framework = e.target.checked ? { name: "", steps: [{ step: "", desc: "" }] } : null;
      render();
    } else if (e.target.dataset.bf === "speakingReady") {
      l.briefForm.speakingReady = e.target.checked;
    }
  }
});

document.addEventListener("click", async (e) => {
  if (!S || !S.learning || S.view !== "learning") return;
  const l = L();
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act;
  if (b.tagName === "LABEL" && b.querySelector("input[type=file]")) return;
  if (a !== "delsrc" && a !== "delcap" && a !== "delsrcdash") l.delArm = null;
  switch (a) {
    case "settings":
      window.dispatchEvent(new CustomEvent("lifeos:open-settings"));
      break;
    case "actions":
      l.view = "actions";
      render();
      break;
    case "home":
      l.view = "home";
      l.form = null;
      render();
      await loadHome();
      break;
    case "new":
      l.form = { type: b.dataset.type, title: "", author: "", url: "", totalPages: "", text: "", err: "" };
      l.view = "new";
      render();
      break;
    case "ftype":
      l.form.type = b.dataset.type;
      render();
      break;
    case "create":
      await createSource();
      break;
    case "open":
      if (e.target.closest("button") && e.target.closest("button") !== b) return;
      await openSource(b.dataset.id);
      break;
    case "cap":
      l.draft = { srcId: b.dataset.id, mode: b.dataset.mode, thought: "", pageRef: "", note: "" };
      l.view = "capture";
      render();
      break;
    case "cancelcap":
      l.draft = null;
      l.view = "source";
      render();
      break;
    case "savethought":
      await saveThought();
      break;
    case "processnow":
      await processNow();
      break;
    case "checknow":
      await runTick(true);
      break;
    case "createbrief":
      await startBriefDraft(b.dataset.id);
      break;
    case "brieftopic": {
      const t = b.dataset.t;
      const topics = l.briefForm.topics;
      const i = topics.indexOf(t);
      if (i >= 0) topics.splice(i, 1);
      else if (topics.length < 3) topics.push(t);
      else {
        flash("Up to 3 topics.", true);
        break;
      }
      render();
      break;
    }
    case "addprinciple":
      l.briefForm.principles.push({ title: "", explanation: "" });
      render();
      break;
    case "rmprinciple":
      l.briefForm.principles.splice(parseInt(b.dataset.i, 10), 1);
      render();
      break;
    case "addconnection":
      l.briefForm.connections.push("");
      render();
      break;
    case "rmconnection":
      l.briefForm.connections.splice(parseInt(b.dataset.i, 10), 1);
      render();
      break;
    case "addstep":
      l.briefForm.framework.steps.push({ step: "", desc: "" });
      render();
      break;
    case "rmstep":
      l.briefForm.framework.steps.splice(parseInt(b.dataset.i, 10), 1);
      render();
      break;
    case "discardbrief":
      await discardBrief(b.dataset.id);
      break;
    case "savebrief":
      await saveBrief(b.dataset.id);
      break;
    case "finish":
    case "reopen": {
      const newMeta = await learningStore.setSourceStatus(b.dataset.id, a === "finish" ? "finished" : "active");
      if (newMeta) {
        l.meta = newMeta;
        l.sources = l.sources.map((r) => (r.id === b.dataset.id ? { ...r, status: newMeta.status } : r));
      }
      render();
      break;
    }
    case "delsrcdash": {
      const key = `dash:${b.dataset.id}`;
      if (l.delArm !== key) {
        l.delArm = key;
        return render();
      }
      l.delArm = null;
      const dashOk = await learningStore.deleteSource(b.dataset.id);
      flash(dashOk ? "Deleted." : "Deleted — but couldn't update your library list. Reopen Library in a moment and it should catch up.", !dashOk);
      await loadHome();
      break;
    }
    case "delsrc": {
      if (l.delArm !== "src") {
        l.delArm = "src";
        return render();
      }
      l.delArm = null;
      const srcOk = await learningStore.deleteSource(l.curId);
      flash(srcOk ? "Deleted." : "Deleted — but couldn't update your library list. Reopen Library in a moment and it should catch up.", !srcOk);
      l.view = "home";
      render();
      await loadHome();
      break;
    }
    case "hl":
      await toggleHighlight(b.dataset.cid, parseInt(b.dataset.pi, 10), parseInt(b.dataset.ai, 10), parseInt(b.dataset.si, 10));
      break;
    case "addcustom":
      addCustomAction(b.dataset.cid);
      break;
    case "rmcustom":
      removeCustomAction(b.dataset.cid, parseInt(b.dataset.i, 10));
      break;
    case "saveactions":
      await saveActionsFor(b.dataset.cid);
      break;
    case "dismissaction":
      await dismissAction(b.dataset.id);
      break;
    case "pastetext": {
      const cid = b.dataset.cid;
      const box = document.querySelector(`.pastetext[data-cid="${cid}"]`);
      const err = document.querySelector(`.pasteerr[data-cid="${cid}"]`);
      const text = (box?.value || "").trim();
      const showErr = (m) => {
        if (err) {
          err.textContent = m;
          err.hidden = false;
        }
      };
      if (text.length < 40) return showErr("Paste a bit more — a paragraph or two at least.");
      if (loadRun()) return showErr("A run is already in progress — wait for it to finish, then tap again.");
      l.busy = `paste:${cid}`;
      b.disabled = true;
      b.textContent = "Saving…";
      const ok = await learningStore.resubmitLinkText(l.curId, cid, text);
      l.busy = "";
      if (!ok) {
        b.disabled = false;
        b.textContent = "Summarize this";
        return showErr("Couldn't save — your text is still here. Tap again to retry.");
      }
      l.meta = await learningStore.getSource(l.curId, true);
      delete l.fullCaptures[cid];
      await processNow();
      break;
    }
    case "delcap": {
      const cid = b.dataset.cid;
      const key = `cap:${cid}`;
      if (l.delArm !== key) {
        l.delArm = key;
        return render();
      }
      l.delArm = null;
      const capOk = await learningStore.deleteCapture(l.curId, cid);
      flash(capOk ? "Note deleted." : "Deleted — but couldn't update your library list. Reopen Library in a moment and it should catch up.", !capOk);
      l.meta = await learningStore.getSource(l.curId);
      const idx = await learningStore.getIndex();
      l.sources = idx.sources;
      render();
      break;
    }
  }
});
