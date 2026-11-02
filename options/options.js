const $ = (id) => document.getElementById(id);

function flash(text) {
  $("status").textContent = text;
  setTimeout(() => ($("status").textContent = ""), 2000);
}

async function load() {
  const s = await getSettings();
  $("limits").innerHTML = Object.entries(SITES).map(([id, site]) => `
    <tr data-id="${id}">
      <td>${site.name}</td>
      <td><input type="number" min="1" data-k="limit" value="${s.sites[id].limit}"></td>
      <td><input type="number" min="0.5" step="0.5" data-k="windowHours" value="${s.sites[id].windowHours}"></td>
      <td><input type="number" min="1000" step="1000" data-k="contextTokens" value="${s.sites[id].contextTokens}"></td>
    </tr>`).join("");
  $("warnAt").value = Math.round(s.warnAt * 100);
  $("showOverlay").checked = s.showOverlay;
  $("mode").value = s.optimizer.mode;
  $("apiKey").value = s.optimizer.apiKey;
  $("model").value = s.optimizer.model;
}

$("save").onclick = async () => {
  const s = await getSettings();
  document.querySelectorAll("#limits tr").forEach((tr) => {
    tr.querySelectorAll("input").forEach((inp) => {
      const v = Number(inp.value);
      if (v > 0) s.sites[tr.dataset.id][inp.dataset.k] = v;
    });
  });
  s.warnAt = Math.min(1, Math.max(0.1, Number($("warnAt").value) / 100 || 0.8));
  s.showOverlay = $("showOverlay").checked;
  s.optimizer = { mode: $("mode").value, apiKey: $("apiKey").value.trim(), model: $("model").value.trim() || DEFAULT_SETTINGS.optimizer.model };
  await saveSettings(s);
  flash("Saved.");
};

$("reset").onclick = async () => {
  if (!confirm("Reset all locally tracked usage counts?")) return;
  await chrome.storage.local.remove(["usage", "lastSeen"]);
  flash("Usage reset.");
};

load();
