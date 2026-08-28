/* Element to LLM — side panel controller.
 * The panel is global (not per-tab): it stays open across tab switches, so
 * unlike the old popup it must actively track which tab is active.
 */

const toggleBtn = document.getElementById("toggle");
const toggleLabel = document.getElementById("toggle-label");
const computedCss = document.getElementById("computedCss");
const fullHtml = document.getElementById("fullHtml");
const includeUrl = document.getElementById("includeUrl");
const keepPicking = document.getElementById("keepPicking");
const modeWrap = document.getElementById("mode");
const segBtns = Array.from(document.querySelectorAll(".seg-btn"));
const pkgPanel = document.getElementById("package");
const pkgCount = document.getElementById("pkg-count");
const promptTextEl = document.getElementById("prompt-text");
const copyAllBtn = document.getElementById("copy-all");
const saveTxtBtn = document.getElementById("save-txt");
const clearBtn = document.getElementById("clear");
const changeShortcutBtn = document.getElementById("change-shortcut");
const shortcutLabelEl = document.getElementById("shortcut-label");

const statusLine = document.getElementById("status");

let mode = "collect";

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Pages where content scripts can never run.
function isRestricted(tab) {
  const url = tab?.url;
  if (!url) return false; // unknown — attempt, send() handles failure
  if (!/^(https?|file):/.test(url)) return true; // chrome://, edge://, about:, view-source:, …
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url)) return true;
  return false;
}

function showStatus(text) {
  statusLine.textContent = text || "";
  statusLine.classList.toggle("show", !!text);
}

// Send a message, injecting the content script first if it isn't loaded yet
// (e.g. the tab was open before the extension was installed). Rejected
// sendMessage promises are the MV3 equivalent of chrome.runtime.lastError.
async function send(message) {
  const tab = await activeTab();
  if (!tab?.id || isRestricted(tab)) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (_) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content/content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content.js"]
      });
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (e) {
      return null;
    }
  }
}

function renderActive(active) {
  toggleBtn.classList.toggle("on", !!active);
  if (active) {
    toggleLabel.textContent =
      mode === "collect" ? "Picking… (click to note)" : "Picking… (click to copy)";
  } else {
    toggleLabel.textContent = "Start picking";
  }
}

function renderMode() {
  segBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  pkgPanel.classList.toggle("show", mode === "collect");
}

function itemToBlock(it, i) {
  let s = `## Element ${i + 1}: ${it.descriptor || ""}\n`;
  if (it.url) s += `URL: ${it.url}\n`;
  s +=
    `DOM Path: ${it.path}\n` +
    `Position: ${it.position}\n` +
    `HTML Element: ${it.html}`;
  if (it.css) s += `\nComputed CSS: {\n${it.css}\n}`;
  if (it.note) s += `\nRequested change: ${it.note}`;
  return s;
}

function renderPackage(arr) {
  const n = arr.length;
  pkgCount.textContent = n === 1 ? "1 element" : `${n} elements`;
}

// The prompt textarea, not the picked-element count, decides whether there's
// anything to copy/save/clear — the user can type into it directly without
// picking anything.
function updatePackageButtons() {
  const has = !!promptTextEl.value.trim();
  copyAllBtn.disabled = !has;
  saveTxtBtn.disabled = !has;
  clearBtn.disabled = !has;
}

// `promptSyncedCount` is how many of `collection`'s items have already been
// appended into `promptText`. The panel's storage.onChanged listener only
// runs while the panel document is alive, so items picked while it was
// closed (or, on the very first load after this feature shipped, every item
// already in `collection`) never reached the textarea — catch those up here.
async function loadPackage() {
  const v = await chrome.storage.local.get(["collection", "promptText", "promptSyncedCount"]);
  const arr = Array.isArray(v.collection) ? v.collection : [];
  renderPackage(arr);

  let text = typeof v.promptText === "string" ? v.promptText : "";
  const syncedCount = typeof v.promptSyncedCount === "number" ? v.promptSyncedCount : 0;
  if (arr.length > syncedCount) {
    const added = arr.slice(syncedCount);
    const blocks = added.map((it, idx) => itemToBlock(it, syncedCount + idx)).join("\n\n");
    text = text.trim() ? `${text}\n\n${blocks}` : blocks;
    await chrome.storage.local.set({ promptText: text, promptSyncedCount: arr.length });
  }
  promptTextEl.value = text;
  updatePackageButtons();
}

// --- Listeners ----------------------------------------------------------
toggleBtn.addEventListener("click", async () => {
  const res = await send({ type: "etl-toggle" });
  if (res) {
    renderActive(res.active);
  } else {
    showStatus("Can't pick on this page — try a regular website tab.");
  }
});

segBtns.forEach((b) =>
  b.addEventListener("click", () => {
    mode = b.dataset.mode;
    chrome.storage.local.set({ mode });
    send({ type: "etl-set-options", options: { mode } });
    renderMode();
  })
);

// Robust copy: navigator.clipboard rejects if the document loses focus, so
// fall back to a focused hidden textarea + execCommand.
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }
}

copyAllBtn.addEventListener("click", async () => {
  const text = promptTextEl.value;
  if (!text.trim()) return;
  const ok = await copyToClipboard(text);
  copyAllBtn.textContent = ok ? "✓ Copied!" : "Copy failed";
  setTimeout(() => (copyAllBtn.textContent = "Copy all"), 1200);
});

saveTxtBtn.addEventListener("click", () => {
  const text = promptTextEl.value;
  if (!text.trim()) return;
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "element-requests.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

clearBtn.addEventListener("click", async () => {
  promptTextEl.value = "";
  updatePackageButtons();
  await chrome.storage.local.set({ collection: [], promptText: "", promptSyncedCount: 0 });
});

function pushOptions() {
  const options = {
    computedCss: computedCss.checked,
    fullHtml: fullHtml.checked,
    includeUrl: includeUrl.checked,
    keepPicking: keepPicking.checked
  };
  chrome.storage.local.set(options);
  send({ type: "etl-set-options", options });
}
computedCss.addEventListener("change", pushOptions);
fullHtml.addEventListener("change", pushOptions);
includeUrl.addEventListener("change", pushOptions);
keepPicking.addEventListener("change", pushOptions);

// Persist prompt-text edits, debounced so every keystroke doesn't hit
// storage. Debounced rather than on-blur so a crash/reload mid-edit doesn't
// lose more than a moment of typing.
let promptSaveTimer = null;
promptTextEl.addEventListener("input", () => {
  updatePackageButtons();
  clearTimeout(promptSaveTimer);
  promptSaveTimer = setTimeout(() => {
    chrome.storage.local.set({ promptText: promptTextEl.value });
  }, 300);
});

// Live-sync across every window showing this global panel: the picked-
// element count, newly captured items appended into the prompt text (without
// clobbering whatever the user has already typed/edited), and edits made to
// the prompt itself in another window.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.collection) {
    const oldArr = Array.isArray(changes.collection.oldValue) ? changes.collection.oldValue : [];
    const newArr = Array.isArray(changes.collection.newValue) ? changes.collection.newValue : [];
    renderPackage(newArr);
    if (newArr.length > oldArr.length) {
      const added = newArr.slice(oldArr.length);
      const blocks = added.map((it, idx) => itemToBlock(it, oldArr.length + idx)).join("\n\n");
      const current = promptTextEl.value;
      const next = current.trim() ? `${current}\n\n${blocks}` : blocks;
      promptTextEl.value = next;
      updatePackageButtons();
      chrome.storage.local.set({ promptText: next, promptSyncedCount: newArr.length });
    }
  }

  // Don't yank the textarea out from under the user while they're typing in
  // it; reconcile once they're no longer focused on it.
  if (changes.promptText && document.activeElement !== promptTextEl) {
    const next = changes.promptText.newValue || "";
    if (next !== promptTextEl.value) {
      promptTextEl.value = next;
      updatePackageButtons();
    }
  }
});

// --- Track the active tab ------------------------------------------------
// The panel stays open (that's the point) while the user switches tabs or
// windows, so — unlike the old popup, which was re-created fresh on every
// open — it has to re-sync itself to whichever tab becomes active.
// Guards against overlapping runs: the direct-sendMessage path is near-
// instant while the inject-then-send fallback takes far longer, so a fast
// tab switch can let a slow, now-stale run resolve last and clobber a
// correct result with a wrong one. Only the freshest call may render.
let refreshToken = 0;

async function refreshForActiveTab() {
  const token = ++refreshToken;
  const tab = await activeTab();
  if (!tab || token !== refreshToken) return;

  if (isRestricted(tab)) {
    toggleBtn.disabled = true;
    toggleBtn.classList.add("disabled");
    showStatus("Pickers can't run on browser pages. Open a regular website.");
    renderActive(false);
    return;
  }

  // Ask the content script for the authoritative picker state so the panel
  // never shows a stale toggle after Esc / keyboard-shortcut changes.
  const res = await send({ type: "etl-status" });
  if (token !== refreshToken) return; // a newer refresh superseded this one
  if (res) {
    toggleBtn.disabled = false;
    toggleBtn.classList.remove("disabled");
    showStatus("");
    renderActive(res.active);
  } else {
    toggleBtn.disabled = true;
    toggleBtn.classList.add("disabled");
    showStatus("Pickers can't run on browser pages. Open a regular website.");
    renderActive(false);
  }
}

chrome.tabs.onActivated.addListener(refreshForActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) refreshForActiveTab();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshForActiveTab();
});

// The content script pushes its own activate/deactivate (Esc, keyboard
// shortcut) since the panel has no "on open" moment to catch up at.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "etl-state") refreshForActiveTab();
});

// --- Keyboard shortcut ----------------------------------------------------
// There's no API to set a command's shortcut from the extension itself —
// chrome://extensions/shortcuts is the only place a user can rebind it, so
// the button just opens that page instead of trying to build a picker here.
changeShortcutBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

async function refreshShortcutLabel() {
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === "toggle-picker");
    shortcutLabelEl.textContent = cmd?.shortcut || "Not set";
  } catch (_) {
    // chrome.commands unavailable — leave the default label.
  }
}
// Re-read it whenever the user could plausibly be coming back from the
// shortcuts page (there's no change event to listen for).
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshShortcutLabel();
});

// --- Init ---------------------------------------------------------------
(async () => {
  const v = await chrome.storage.local.get([
    "mode",
    "computedCss",
    "fullHtml",
    "includeUrl",
    "keepPicking"
  ]);
  mode = v.mode === "copy" ? "copy" : "collect";
  computedCss.checked = !!v.computedCss;
  fullHtml.checked = !!v.fullHtml;
  includeUrl.checked = !!v.includeUrl;
  keepPicking.checked = v.keepPicking !== false;
  renderMode();
  await loadPackage();
  await refreshForActiveTab();
  await refreshShortcutLabel();
})();
