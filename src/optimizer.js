// Offline, rule-based prompt optimizer. Turns a short request into a structured prompt
// with role, task, context, requirements and output format. The Claude-powered mode lives in background.js.

const TASK_TYPES = [
  { id: "code", re: /\b(code|function|bug|error|script|api|regex|sql|python|javascript|typescript|java|react|css|html|debug|refactor|implement|compile)\b/i,
    role: "a senior software engineer",
    reqs: ["Write correct, idiomatic, production-quality code.", "Explain key decisions briefly.", "Point out edge cases and how they're handled."],
    format: "A short explanation, then the code in fenced code blocks, then usage notes." },
  { id: "write", re: /\b(write|draft|email|essay|blog|post|letter|story|caption|article|rewrite|tone)\b/i,
    role: "an experienced professional writer and editor",
    reqs: ["Match the tone to the audience.", "Keep it clear, concise and free of filler.", "Use strong, specific wording."],
    format: "The finished text, ready to use, followed by one alternative variation." },
  { id: "analyze", re: /\b(analy[sz]e|compare|evaluate|pros|cons|review|assess|which is better|trade-?offs?|data)\b/i,
    role: "a rigorous analyst",
    reqs: ["Consider multiple perspectives.", "Back claims with reasoning or evidence.", "State assumptions explicitly."],
    format: "A one-line verdict, then a structured comparison (table if useful), then a recommendation." },
  { id: "explain", re: /\b(explain|what is|what are|how does|how do|why|teach|understand|meaning|eli5)\b/i,
    role: "a patient expert teacher",
    reqs: ["Start simple, then add depth.", "Use one concrete example or analogy.", "Avoid unexplained jargon."],
    format: "A short direct answer first, then a step-by-step explanation, then a quick summary." },
  { id: "plan", re: /\b(plan|steps|roadmap|strategy|schedule|itinerary|how to|guide|checklist)\b/i,
    role: "a pragmatic planner and strategist",
    reqs: ["Break the work into clear, ordered steps.", "Flag risks and dependencies.", "Keep steps actionable."],
    format: "A numbered step-by-step plan with brief notes for each step." }
];

const GENERIC = {
  id: "general",
  role: "a knowledgeable, precise assistant",
  reqs: ["Be accurate and specific.", "Keep the answer focused on what was asked."],
  format: "A clear, well-structured answer using headings or bullets where helpful."
};

function detectTaskType(text) {
  return TASK_TYPES.find((t) => t.re.test(text)) || GENERIC;
}

function cleanPrompt(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/^(hey|hi|hello|yo)[,!.\s]+/i, "")
    .replace(/^(can|could|would) you (please )?/i, "")
    .replace(/^please\s+/i, "")
    .replace(/\?+$/, "")
    .trim();
}

function optimizePromptLocal(raw) {
  const text = (raw || "").trim();
  if (!text) return "";
  // Already long and structured? Don't bloat it — just append the clarification nudge.
  if (text.length > 600 || /^#+\s|^\s*(role|task|context)\s*:/im.test(text)) {
    return text + "\n\nIf anything above is ambiguous, ask me clarifying questions before answering.";
  }
  const task = detectTaskType(text);
  const goal = cleanPrompt(text);
  const goalSentence = goal.charAt(0).toUpperCase() + goal.slice(1) + (/[.!]$/.test(goal) ? "" : ".");

  return [
    `You are ${task.role}.`,
    "",
    "## Task",
    goalSentence,
    "",
    "## Context",
    "- Audience / purpose: [add who this is for and why, if relevant]",
    "- Constraints: [add any limits, e.g. length, tools, versions, deadline]",
    "",
    "## Requirements",
    ...task.reqs.map((r) => `- ${r}`),
    "- If key information is missing, state your assumptions (or ask up to 3 clarifying questions) before answering.",
    "",
    "## Output format",
    task.format
  ].join("\n");
}

const OPTIMIZER_SYSTEM_PROMPT = `You rewrite a user's rough prompt for an AI chatbot into a clearer, more effective prompt.
Keep the user's intent, language and any specifics exactly; do not invent facts, names or numbers.
Add only what helps: the goal, relevant context the user implied, constraints, and the desired output format.
Where essential details are missing, add short bracketed placeholders like [target audience] rather than guessing.
Keep it proportionate: a one-line question should become a few lines, not a page.
Return only the rewritten prompt, with no preamble or commentary.`;
