// Shared defaults + storage helpers. Loaded by content scripts, popup, options and the service worker.
// Limits are approximations: chatbots don't publish exact quotas, so users should tune these to their plan.

const DEFAULT_SETTINGS = {
  warnAt: 0.8, // fraction of a limit at which to warn
  sites: {
    claude:     { limit: 45,  windowHours: 5,  contextTokens: 200000 },
    chatgpt:    { limit: 80,  windowHours: 3,  contextTokens: 128000 },
    gemini:     { limit: 100, windowHours: 24, contextTokens: 1000000 },
    perplexity: { limit: 300, windowHours: 24, contextTokens: 128000 },
    copilot:    { limit: 100, windowHours: 24, contextTokens: 128000 },
    deepseek:   { limit: 100, windowHours: 24, contextTokens: 128000 },
    grok:       { limit: 50,  windowHours: 2,  contextTokens: 128000 }
  },
  optimizer: {
    mode: "local", // "local" (rule-based, offline) or "claude" (uses your Anthropic API key)
    apiKey: "",
    model: "claude-opus-5-5"
  },
  showOverlay: true
};

const USAGE_RETENTION_MS = 7 * 24 * 3600 * 1000;

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] ? deepMerge(base[k], v) : v;
  }
  return out;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return deepMerge(DEFAULT_SETTINGS, settings);
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

// usage: { [siteId]: number[] }  — timestamps (ms) of sent prompts
async function getUsage() {
  const { usage } = await chrome.storage.local.get("usage");
  return usage || {};
}

async function recordSend(siteId) {
  const usage = await getUsage();
  const cutoff = Date.now() - USAGE_RETENTION_MS;
  usage[siteId] = (usage[siteId] || []).filter((t) => t > cutoff);
  usage[siteId].push(Date.now());
  await chrome.storage.local.set({ usage });
  return usage[siteId];
}

function countInWindow(timestamps, windowHours) {
  const since = Date.now() - windowHours * 3600 * 1000;
  return (timestamps || []).filter((t) => t > since).length;
}

// When the oldest message in the window drops out, one slot frees up.
function nextSlotAt(timestamps, windowHours) {
  const since = Date.now() - windowHours * 3600 * 1000;
  const inWindow = (timestamps || []).filter((t) => t > since).sort((a, b) => a - b);
  return inWindow.length ? inWindow[0] + windowHours * 3600 * 1000 : null;
}

// Rough heuristic: ~4 characters per token for English text.
function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

function formatTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
