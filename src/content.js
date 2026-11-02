// In-page overlay: shows model, usage in the current window and estimated context size,
// warns as limits approach, and offers prompt optimization and conversation handoff.

(async function main() {
  const site = detectSite();
  if (!site || window.__promptlyLoaded) return;
  window.__promptlyLoaded = true;

  let settings = await getSettings();
  let usage = await getUsage();
  const state = { model: "Detecting…", contextTokens: 0, limitBanner: null, expanded: false, mode: "pill" };

  // Widget mode per site: "pill" (default), "icon" (minimized) or "hidden" (closed; restore from the popup).
  const { widget = {} } = await chrome.storage.local.get("widget");
  state.mode = widget[site.id] || "pill";

  async function setMode(mode) {
    state.mode = mode;
    if (mode !== "pill") state.expanded = false;
    const { widget = {} } = await chrome.storage.local.get("widget");
    widget[site.id] = mode;
    await chrome.storage.local.set({ widget });
    render();
  }

  // ---------- Composer helpers ----------

  const getComposer = () => queryFirst(site.composer);

  function getComposerText(el = getComposer()) {
    if (!el) return "";
    return ("value" in el && typeof el.value === "string" ? el.value : el.innerText || "").trim();
  }

  function setComposerText(text, el = getComposer()) {
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      // React-controlled inputs ignore direct .value writes; use the native setter + input event.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    // Rich editors (ProseMirror, Quill): clear, then simulate a paste so newlines are preserved.
    document.execCommand("selectAll", false);
    document.execCommand("delete", false);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    setTimeout(() => {
      if (!getComposerText(el).startsWith(text.slice(0, 20).trim())) {
        document.execCommand("insertText", false, text);
      }
    }, 50);
    return true;
  }

  // ---------- Send tracking ----------

  let lastSendAt = 0;
  async function onSend() {
    if (Date.now() - lastSendAt < 1500) return; // Enter + button click for the same message
    lastSendAt = Date.now();
    usage[site.id] = await recordSend(site.id);
    render();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const composer = getComposer();
    if (composer && composer.contains(e.target) && getComposerText(composer)) onSend();
  }, true);

  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(site.sendButton.join(","));
    if (btn && !btn.disabled && getComposerText()) onSend();
  }, true);

  // ---------- Page inspection ----------

  function getTranscript() {
    const users = queryAll(site.userMessages).map((el) => ({ el, role: "User" }));
    const bots = queryAll(site.assistantMessages).map((el) => ({ el, role: "Assistant" }));
    return [...users, ...bots]
      .filter(({ el }) => !el.closest("#promptly-host"))
      .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map(({ el, role }) => ({ role, text: (el.innerText || el.textContent || "").trim() }))
      .filter((m) => m.text);
  }

  function detectModel() {
    const el = queryFirst(site.model);
    const text = el && (el.innerText || el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 40) : "Unknown";
  }

  function detectLimitBanner() {
    const regions = [...document.querySelectorAll('[role="alert"], [role="status"], [role="dialog"]')];
    let near = getComposer();
    for (let i = 0; near && i < 4; i++) near = near.parentElement;
    if (near) regions.push(near);
    for (const r of regions) {
      if (r.closest("#promptly-host")) continue;
      const text = (r.innerText || "").slice(0, 2000);
      for (const re of LIMIT_PATTERNS) {
        const m = text.match(re);
        if (m) return m[0].slice(0, 80);
      }
    }
    return null;
  }

  function inspect() {
    state.model = detectModel();
    state.contextTokens = getTranscript().reduce((sum, m) => sum + estimateTokens(m.text), 0);
    state.limitBanner = detectLimitBanner();
    render();
    saveLastSeen();
  }

  // Persist the latest snapshot so the toolbar popup can show it for every site.
  let lastSaved = "";
  async function saveLastSeen() {
    const snap = { model: state.model, contextTokens: state.contextTokens, limitBanner: state.limitBanner };
    const key = JSON.stringify(snap);
    if (key === lastSaved) return;
    lastSaved = key;
    const { lastSeen = {} } = await chrome.storage.local.get("lastSeen");
    lastSeen[site.id] = { ...snap, ts: Date.now() };
    await chrome.storage.local.set({ lastSeen });
  }

  // ---------- Overlay UI (shadow DOM so the host page's CSS can't interfere) ----------

  const host = document.createElement("div");
  host.id = "promptly-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      .wrap { position: fixed; right: 16px; bottom: 96px; z-index: 2147483646; color: #e8e8ea; font-size: 12px; }
      .pill { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; cursor: pointer;
        background: #1d1e22; border: 1px solid #34353b; box-shadow: 0 4px 16px rgba(0,0,0,.25); user-select: none; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; flex: none; }
      .warn .dot { background: #d29922; } .crit .dot { background: #f85149; }
      .panel { width: 290px; margin-bottom: 8px; padding: 12px; border-radius: 12px; background: #1d1e22;
        border: 1px solid #34353b; box-shadow: 0 8px 28px rgba(0,0,0,.35); }
      .row { display: flex; justify-content: space-between; gap: 8px; margin: 6px 0; }
      .label { color: #9a9ba3; } .val { font-weight: 600; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bar { height: 6px; border-radius: 3px; background: #2c2d33; overflow: hidden; margin: 2px 0 8px; }
      .fill { height: 100%; background: #3fb950; transition: width .3s; }
      .fill.warn { background: #d29922; } .fill.crit { background: #f85149; }
      .alert { margin: 8px 0; padding: 8px; border-radius: 8px; background: #3a2a10; color: #f0c674; line-height: 1.4; }
      .btns { display: flex; gap: 6px; margin-top: 10px; }
      button { flex: 1; padding: 7px 8px; border-radius: 8px; border: 1px solid #44454c; background: #2a2b31; color: #e8e8ea;
        cursor: pointer; font-size: 12px; }
      button:hover { background: #34353c; } button.primary { background: #4c6ef5; border-color: #4c6ef5; }
      button.primary:hover { background: #5c7cfa; }
      .muted { color: #9a9ba3; font-size: 11px; margin-top: 8px; }
      .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 2147483647; display: flex;
        align-items: center; justify-content: center; padding: 16px; }
      .modal { width: min(640px, 100%); max-height: 90vh; overflow: auto; background: #1d1e22; border: 1px solid #34353b;
        border-radius: 14px; padding: 16px; color: #e8e8ea; font-size: 13px; }
      .modal h3 { margin: 0 0 10px; font-size: 15px; }
      textarea { width: 100%; min-height: 240px; resize: vertical; padding: 10px; border-radius: 8px; border: 1px solid #44454c;
        background: #121316; color: #e8e8ea; font: 12px/1.5 ui-monospace, Consolas, monospace; }
      .targets { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; margin: 10px 0; }
      .wrap { display: flex; flex-direction: column; align-items: flex-end; }
      [hidden] { display: none !important; }
      .head { display: flex; justify-content: space-between; align-items: center; margin: -2px 0 8px; }
      .head strong { font-size: 12px; }
      .ctls { display: flex; gap: 4px; }
      button.ctl, button.mini { flex: none; width: 22px; height: 22px; padding: 0; border-radius: 6px; line-height: 1;
        font-size: 14px; color: #9a9ba3; background: transparent; border: 1px solid transparent; }
      button.ctl:hover, button.mini:hover { color: #e8e8ea; background: #34353c; border-color: #44454c; }
      button.mini { width: 18px; height: 18px; margin-left: 2px; }
      .icon { position: relative; width: 44px; height: 44px; cursor: pointer; border-radius: 12px;
        box-shadow: 0 4px 16px rgba(0,0,0,.35); transition: transform .15s; }
      .icon:hover { transform: scale(1.06); }
      .icon img { width: 44px; height: 44px; display: block; border-radius: 12px; }
      .icon .badge { position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; border-radius: 50%;
        border: 2px solid #1d1e22; background: #3fb950; }
      .icon.warn .badge { background: #d29922; } .icon.crit .badge { background: #f85149; }
      .icon button.x { position: absolute; top: -7px; right: -7px; width: 18px; height: 18px; padding: 0; border-radius: 50%;
        font-size: 12px; line-height: 1; background: #2a2b31; display: none; }
      .icon:hover button.x { display: block; }
      .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: #2a2b31; color: #e8e8ea;
        padding: 8px 14px; border-radius: 8px; border: 1px solid #44454c; z-index: 2147483647; font-size: 13px; }
    </style>
    <div class="wrap">
      <div class="panel" hidden></div>
      <div class="pill"></div>
      <div class="icon" data-act="restore" title="Promptly — click to expand" hidden>
        <img src="${chrome.runtime.getURL("icons/icon48.png")}" alt="">
        <span class="badge"></span>
        <button class="x" data-act="close" title="Close widget">×</button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const wrap = root.querySelector(".wrap");
  const pill = root.querySelector(".pill");
  const panel = root.querySelector(".panel");
  const iconEl = root.querySelector(".icon");

  wrap.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "minimize") return setMode("icon");
    if (act === "restore") return setMode("pill");
    if (act === "close") {
      setMode("hidden");
      return toast(`Widget closed on ${site.name}. Bring it back from the extension's toolbar popup.`, 5000);
    }
    if (!act && e.target.closest(".pill")) { state.expanded = !state.expanded; render(); }
  });

  function level(ratio) {
    if (ratio >= 1 || ratio >= settings.warnAt + (1 - settings.warnAt) / 2) return "crit";
    if (ratio >= settings.warnAt) return "warn";
    return "";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function render() {
    wrap.style.display = settings.showOverlay && state.mode !== "hidden" ? "" : "none";
    const cfg = settings.sites[site.id];
    const used = countInWindow(usage[site.id], cfg.windowHours);
    const usageRatio = used / cfg.limit;
    const ctxRatio = state.contextTokens / cfg.contextTokens;
    const worst = Math.max(usageRatio, ctxRatio, state.limitBanner ? 1 : 0);
    const lvl = level(worst);

    const minimized = state.mode === "icon";
    iconEl.hidden = !minimized;
    iconEl.className = "icon " + lvl;
    pill.hidden = minimized;
    if (minimized) { panel.hidden = true; return; }

    pill.className = "pill " + lvl;
    pill.innerHTML = `<span class="dot"></span><span>${escapeHtml(site.name)} · ${escapeHtml(state.model)} · ${used}/${cfg.limit}</span>` +
      `<button class="mini" data-act="minimize" title="Minimize to icon">–</button>`;

    panel.hidden = !state.expanded;
    if (!state.expanded) return;

    const slot = nextSlotAt(usage[site.id], cfg.windowHours);
    const alerts = [];
    if (state.limitBanner) alerts.push(`${escapeHtml(site.name)} says: “${escapeHtml(state.limitBanner)}”`);
    if (usageRatio >= settings.warnAt) alerts.push(`You've used ${Math.round(usageRatio * 100)}% of your estimated message limit.`);
    if (ctxRatio >= settings.warnAt) alerts.push(`This conversation is ~${Math.round(ctxRatio * 100)}% of the context window — answers may degrade. Start a fresh chat with a handoff.`);

    panel.innerHTML = `
      <div class="head"><strong>Promptly</strong>
        <span class="ctls">
          <button class="ctl" data-act="minimize" title="Minimize to icon">–</button>
          <button class="ctl" data-act="close" title="Close widget">×</button>
        </span>
      </div>
      <div class="row"><span class="label">Site</span><span class="val">${escapeHtml(site.name)}</span></div>
      <div class="row"><span class="label">Model</span><span class="val" title="${escapeHtml(state.model)}">${escapeHtml(state.model)}</span></div>
      <div class="row"><span class="label">Messages (last ${cfg.windowHours}h)</span><span class="val">${used} / ${cfg.limit}</span></div>
      <div class="bar"><div class="fill ${level(usageRatio)}" style="width:${Math.min(100, usageRatio * 100)}%"></div></div>
      <div class="row"><span class="label">Context (est.)</span><span class="val">${formatTokens(state.contextTokens)} / ${formatTokens(cfg.contextTokens)} tokens</span></div>
      <div class="bar"><div class="fill ${level(ctxRatio)}" style="width:${Math.min(100, ctxRatio * 100)}%"></div></div>
      ${slot && used >= cfg.limit ? `<div class="row"><span class="label">Next slot frees</span><span class="val">${new Date(slot).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>` : ""}
      ${alerts.map((a) => `<div class="alert">⚠ ${a}</div>`).join("")}
      <div class="btns">
        <button class="primary" data-act="optimize" title="Alt+Shift+O">✨ Optimize prompt</button>
        <button class="${alerts.length ? "primary" : ""}" data-act="switch">⇄ Switch / handoff</button>
      </div>
      <div class="muted">Counts are tracked locally from messages you send in this browser. Tune limits in Options.</div>`;
    panel.querySelector('[data-act="optimize"]').onclick = openOptimizer;
    panel.querySelector('[data-act="switch"]').onclick = openSwitcher;
  }

  function toast(text, ms = 3500) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    root.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function modal(innerHtml) {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal">${innerHtml}</div>`;
    bg.addEventListener("click", (e) => { if (e.target === bg) bg.remove(); });
    bg.addEventListener("keydown", (e) => { if (e.key === "Escape") bg.remove(); });
    root.appendChild(bg);
    return bg;
  }

  // ---------- Prompt optimizer ----------

  async function openOptimizer() {
    const original = getComposerText();
    if (!original) return toast("Type a prompt in the chat box first, then optimize it.");
    const m = modal(`
      <h3>✨ Optimized prompt</h3>
      <textarea disabled>Optimizing…</textarea>
      <div class="muted source"></div>
      <div class="btns">
        <button class="primary" data-act="use">Replace in chat box</button>
        <button data-act="copy">Copy</button>
        <button data-act="cancel">Cancel</button>
      </div>`);
    const ta = m.querySelector("textarea");
    m.querySelector('[data-act="cancel"]').onclick = () => m.remove();
    m.querySelector('[data-act="copy"]').onclick = async () => { await navigator.clipboard.writeText(ta.value); toast("Copied."); };
    m.querySelector('[data-act="use"]').onclick = () => { setComposerText(ta.value); m.remove(); toast("Prompt replaced — review and send."); };

    const res = await chrome.runtime.sendMessage({ type: "optimize", text: original });
    ta.disabled = false;
    ta.value = res.error ? optimizePromptLocal(original) : res.text;
    m.querySelector(".source").textContent =
      (res.warning || res.error || "") + (res.source === "claude" ? " Optimized with Claude." : " Optimized offline — fill in the [brackets] or delete them. Enable Claude mode in Options for smarter rewrites.");
    ta.focus();
  }

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyO") { e.preventDefault(); openOptimizer(); }
  }, true);

  // ---------- Context switch / handoff ----------

  function buildHandoff(maxChars = 12000) {
    const lines = getTranscript().map((m) => `${m.role}: ${m.text}`);
    let body = lines.join("\n\n");
    let truncated = false;
    if (body.length > maxChars) { body = body.slice(-maxChars); truncated = true; }
    return [
      `I'm continuing a conversation I started on ${site.name}${state.model !== "Unknown" ? ` (${state.model})` : ""}.`,
      `Here is the transcript${truncated ? " (earlier parts truncated)" : ""}:`,
      "",
      "<transcript>",
      body || "[empty]",
      "</transcript>",
      "",
      "First, summarize in 2-3 bullet points what we were working on and where we left off. Then continue from there."
    ].join("\n");
  }

  function openSwitcher() {
    const others = Object.entries(SITES).filter(([id]) => id !== site.id);
    const m = modal(`
      <h3>⇄ Continue this conversation elsewhere</h3>
      <div class="muted">A handoff prompt with the recent transcript will be pasted into the new chat (not sent). Review it before sending.</div>
      <div class="targets">
        <button class="primary" data-target="${site.id}">New ${escapeHtml(site.name)} chat</button>
        ${others.map(([id, s]) => `<button data-target="${id}">${escapeHtml(s.name)}</button>`).join("")}
      </div>
      <textarea>${escapeHtml(buildHandoff())}</textarea>
      <div class="btns"><button data-act="copy">Copy handoff only</button><button data-act="cancel">Cancel</button></div>`);
    const ta = m.querySelector("textarea");
    m.querySelector('[data-act="cancel"]').onclick = () => m.remove();
    m.querySelector('[data-act="copy"]').onclick = async () => { await navigator.clipboard.writeText(ta.value); toast("Handoff copied."); };
    m.querySelectorAll("[data-target]").forEach((btn) => {
      btn.onclick = async () => {
        const target = btn.dataset.target;
        await navigator.clipboard.writeText(ta.value).catch(() => {});
        await chrome.runtime.sendMessage({ type: "handoff", text: ta.value, targetSite: target, url: SITES[target].newChatUrl });
        m.remove();
      };
    });
  }

  async function consumePendingHandoff() {
    const { pendingHandoff: h } = await chrome.storage.local.get("pendingHandoff");
    if (!h || h.targetSite !== site.id || Date.now() - h.createdAt > 3 * 60 * 1000) return;
    await chrome.storage.local.remove("pendingHandoff");
    for (let i = 0; i < 30; i++) { // wait up to ~15s for the composer to render
      if (getComposer()) {
        setComposerText(h.text);
        toast("Handoff pasted — review it, then send. (Also on your clipboard.)", 6000);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    toast("Couldn't find the chat box — the handoff is on your clipboard, paste it with Ctrl+V.", 6000);
  }

  // ---------- Wiring ----------

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.widget) {
      const mode = (changes.widget.newValue || {})[site.id] || "pill";
      if (mode !== state.mode) { state.mode = mode; state.expanded = false; render(); }
    }
    if (changes.usage) usage = changes.usage.newValue || {};
    if (changes.settings) getSettings().then((s) => { settings = s; render(); });
    else if (changes.usage) render();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "getStatus") {
      sendResponse({ site: site.id, model: state.model, contextTokens: state.contextTokens, limitBanner: state.limitBanner });
    }
  });

  inspect();
  setInterval(inspect, 3000);
  consumePendingHandoff();
})();
