function level(ratio, warnAt) {
  if (ratio >= 1 || ratio >= warnAt + (1 - warnAt) / 2) return "crit";
  if (ratio >= warnAt) return "warn";
  return "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function renderSites() {
  const settings = await getSettings();
  const usage = await getUsage();
  const { lastSeen = {}, widget = {} } = await chrome.storage.local.get(["lastSeen", "widget"]);
  const ids = Object.keys(SITES).filter((id) => usage[id]?.length || lastSeen[id] || widget[id]);
  const el = document.getElementById("sites");
  if (!ids.length) {
    el.innerHTML = `<div class="empty">No activity yet. Open Claude, ChatGPT, Gemini, Perplexity, Copilot, DeepSeek or Grok and send a message.</div>`;
    return;
  }
  el.innerHTML = ids.map((id) => {
    const cfg = settings.sites[id];
    const seen = lastSeen[id] || {};
    const used = countInWindow(usage[id], cfg.windowHours);
    const ratio = used / cfg.limit;
    const ctxRatio = (seen.contextTokens || 0) / cfg.contextTokens;
    return `
      <div class="site">
        <div class="top"><span class="name">${SITES[id].name}</span><span class="model">${escapeHtml(seen.model || "—")}</span></div>
        <div class="bar"><div class="fill ${level(ratio, settings.warnAt)}" style="width:${Math.min(100, ratio * 100)}%"></div></div>
        <div class="meta"><span>${used} / ${cfg.limit} msgs · last ${cfg.windowHours}h</span>
          <span>ctx ~${formatTokens(seen.contextTokens || 0)} (${Math.round(ctxRatio * 100)}%)</span></div>
        ${seen.limitBanner ? `<div class="alert">⚠ “${escapeHtml(seen.limitBanner)}”</div>` : ""}
        ${widget[id] === "hidden" ? `<div class="hidden-note">On-page widget closed · <a href="#" data-show="${id}">Show widget</a></div>` : ""}
      </div>`;
  }).join("");
  el.querySelectorAll("[data-show]").forEach((a) => {
    a.onclick = async (e) => {
      e.preventDefault();
      const { widget = {} } = await chrome.storage.local.get("widget");
      widget[a.dataset.show] = "pill";
      await chrome.storage.local.set({ widget });
      renderSites();
    };
  });
}

document.getElementById("options").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

document.getElementById("optimize").onclick = async () => {
  const raw = document.getElementById("raw");
  const note = document.getElementById("note");
  if (!raw.value.trim()) return;
  note.textContent = "Optimizing…";
  const res = await chrome.runtime.sendMessage({ type: "optimize", text: raw.value });
  raw.value = res.error ? optimizePromptLocal(raw.value) : res.text;
  note.textContent = res.warning || (res.source === "claude" ? "Optimized with Claude." : "Optimized offline — fill in or delete the [brackets].");
};

document.getElementById("copy").onclick = async () => {
  await navigator.clipboard.writeText(document.getElementById("raw").value);
  document.getElementById("note").textContent = "Copied.";
};

renderSites();
