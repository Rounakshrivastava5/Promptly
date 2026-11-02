importScripts("settings.js", "optimizer.js");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "optimize") {
    optimize(msg.text).then(sendResponse, (err) => sendResponse({ error: String(err.message || err) }));
    return true; // async response
  }
  if (msg.type === "handoff") {
    // Stash the handoff so the target tab's content script can paste it once loaded.
    chrome.storage.local
      .set({ pendingHandoff: { text: msg.text, targetSite: msg.targetSite, createdAt: Date.now() } })
      .then(() => chrome.tabs.create({ url: msg.url }))
      .then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function optimize(text) {
  const settings = await getSettings();
  const { mode, apiKey, model } = settings.optimizer;
  if (mode !== "claude" || !apiKey) {
    return { text: optimizePromptLocal(text), source: "local" };
  }
  try {
    return { text: await optimizeWithClaude(text, apiKey, model), source: "claude" };
  } catch (err) {
    // Never leave the user empty-handed: fall back to the offline optimizer.
    return { text: optimizePromptLocal(text), source: "local", warning: `Claude API failed (${err.message}); used offline optimizer.` };
  }
}

async function optimizeWithClaude(text, apiKey, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      output_config: { effort: "low" }, // simple rewrite: keep it fast and cheap
      fallbacks: "default",
      system: OPTIMIZER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Rewrite this prompt:\n\n<prompt>\n${text}\n</prompt>` }]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  if (data.stop_reason === "refusal") throw new Error("request was declined");
  const out = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!out) throw new Error("empty response");
  return out;
}
