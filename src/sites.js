// Per-site adapters. Chatbot UIs change often — when something stops being detected,
// this is the only file that should need updating. Each selector list is tried in order.

const SITES = {
  claude: {
    name: "Claude",
    hosts: ["claude.ai"],
    newChatUrl: "https://claude.ai/new",
    composer: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
    sendButton: ['button[aria-label="Send message"]', 'button[aria-label*="Send"]'],
    model: ['[data-testid="model-selector-dropdown"]', 'button[aria-haspopup="menu"] .font-claude-response', 'button[aria-label*="model" i]'],
    userMessages: ['[data-testid="user-message"]'],
    assistantMessages: ['.font-claude-response', '[data-is-streaming]']
  },
  chatgpt: {
    name: "ChatGPT",
    hosts: ["chatgpt.com", "chat.openai.com"],
    newChatUrl: "https://chatgpt.com/",
    composer: ["#prompt-textarea", 'div[contenteditable="true"]', "textarea"],
    sendButton: ['button[data-testid="send-button"]', 'button[aria-label*="Send"]'],
    model: ['[data-testid="model-switcher-dropdown-button"]', 'button[aria-label*="Model selector"]'],
    userMessages: ['[data-message-author-role="user"]'],
    assistantMessages: ['[data-message-author-role="assistant"]']
  },
  gemini: {
    name: "Gemini",
    hosts: ["gemini.google.com"],
    newChatUrl: "https://gemini.google.com/app",
    composer: ['rich-textarea .ql-editor[contenteditable="true"]', 'div[contenteditable="true"]'],
    sendButton: ['button[aria-label*="Send"]', "button.send-button"],
    model: ['[data-test-id="bard-mode-menu-button"]', ".current-mode-title", 'button[aria-label*="mode" i]'],
    userMessages: ["user-query", ".query-text"],
    assistantMessages: ["model-response", "message-content"]
  },
  perplexity: {
    name: "Perplexity",
    hosts: ["www.perplexity.ai", "perplexity.ai"],
    newChatUrl: "https://www.perplexity.ai/",
    composer: ["textarea", 'div[contenteditable="true"]'],
    sendButton: ['button[aria-label="Submit"]', 'button[aria-label*="Submit"]'],
    model: ['button[aria-label*="model" i]'],
    userMessages: ["h1.group\\/query", '[class*="query"] h1'],
    assistantMessages: ['[class*="prose"]']
  },
  copilot: {
    name: "Copilot",
    hosts: ["copilot.microsoft.com"],
    newChatUrl: "https://copilot.microsoft.com/",
    composer: ["textarea#userInput", "textarea"],
    sendButton: ['button[aria-label*="Submit"]', 'button[title*="Submit"]'],
    model: ['button[aria-label*="mode" i]'],
    userMessages: ['[data-content="user-message"]'],
    assistantMessages: ['[data-content="ai-message"]']
  },
  deepseek: {
    name: "DeepSeek",
    hosts: ["chat.deepseek.com"],
    newChatUrl: "https://chat.deepseek.com/",
    composer: ["textarea#chat-input", "textarea"],
    sendButton: ['div[role="button"][aria-disabled="false"]'],
    model: [],
    userMessages: ['[class*="fbb737a4"]'],
    assistantMessages: [".ds-markdown"]
  },
  grok: {
    name: "Grok",
    hosts: ["grok.com"],
    newChatUrl: "https://grok.com/",
    composer: ["textarea", 'div[contenteditable="true"]'],
    sendButton: ['button[type="submit"]', 'button[aria-label*="Submit"]'],
    model: ['button[aria-label*="Model select" i]', "#model-select-trigger"],
    userMessages: ['[class*="items-end"] .message-bubble'],
    assistantMessages: ['[class*="items-start"] .message-bubble']
  }
};

// Phrases chatbots show when you're close to or past a quota.
const LIMIT_PATTERNS = [
  /(\d+)\s+messages?\s+remaining/i,
  /you(?:'|’)?ve\s+(?:reached|hit)\s+(?:your|the)\s+.*limit/i,
  /usage\s+limit/i,
  /limit\s+resets?\s+(?:at|in)/i,
  /out of (?:free )?messages/i,
  /approaching (?:your|the) (?:usage )?limit/i
];

function detectSite(hostname = location.hostname) {
  for (const [id, site] of Object.entries(SITES)) {
    if (site.hosts.includes(hostname)) return { id, ...site };
  }
  return null;
}

function queryFirst(selectors, root = document) {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch (_) { /* invalid selector on this page; skip */ }
  }
  return null;
}

function queryAll(selectors, root = document) {
  for (const sel of selectors) {
    try {
      const els = root.querySelectorAll(sel);
      if (els.length) return [...els];
    } catch (_) {}
  }
  return [];
}
