/* Element to LLM — side panel controller.
 * The panel is global (not per-tab): it stays open across tab switches, so
 * unlike the old popup it must actively track which tab is active.
 */

const toggleBtn = document.getElementById("toggle");
const toggleLabel = document.getElementById("toggle-label");
const computedCss = document.getElementById("computedCss");
const fullHtml = document.getElementById("fullHtml");
const modeWrap = document.getElementById("mode");
const segBtns = Array.from(document.querySelectorAll(".seg-btn"));
const pkgPanel = document.getElementById("package");
const pkgCount = document.getElementById("pkg-count");
const copyAllBtn = document.getElementById("copy-all");
const saveTxtBtn = document.getElementById("save-txt");
const clearBtn = document.getElementById("clear");

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
  let s =
    `## Element ${i + 1}: ${it.descriptor || ""}\n` +
    `DOM Path: ${it.path}\n` +
    `Position: ${it.position}\n` +
    `HTML Element: ${it.html}`;
  if (it.css) s += `\nComputed CSS: {\n${it.css}\n}`;
  if (it.note) s += `\nRequested change: ${it.note}`;
  return s;
}

function assemble(arr) {
  return arr.map(itemToBlock).join("\n\n");
}

function renderPackage(arr) {
  const n = arr.length;
  pkgCount.textContent = n === 1 ? "1 element" : `${n} elements`;
  copyAllBtn.disabled = n === 0;
  saveTxtBtn.disabled = n === 0;
  clearBtn.disabled = n === 0;
}

async function loadPackage() {
  const v = await chrome.storage.local.get(["collection"]);
  renderPackage(Array.isArray(v.collection) ? v.collection : []);
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
  const v = await chrome.storage.local.get(["collection"]);
  const arr = Array.isArray(v.collection) ? v.collection : [];
  if (!arr.length) return;
  const ok = await copyToClipboard(assemble(arr));
  copyAllBtn.textContent = ok ? "✓ Copied!" : "Copy failed";
  setTimeout(() => (copyAllBtn.textContent = "Copy all"), 1200);
});

saveTxtBtn.addEventListener("click", async () => {
  const v = await chrome.storage.local.get(["collection"]);
  const arr = Array.isArray(v.collection) ? v.collection : [];
  if (!arr.length) return;
  const header =
    "# Element change requests\n" +
    `# ${arr.length} element(s) collected with Element to LLM\n\n`;
  const blob = new Blob([header + assemble(arr)], { type: "text/plain" });
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
  await chrome.storage.local.set({ collection: [] });
  loadPackage();
});

function pushOptions() {
  const options = { computedCss: computedCss.checked, fullHtml: fullHtml.checked };
  chrome.storage.local.set(options);
  send({ type: "etl-set-options", options });
}
computedCss.addEventListener("change", pushOptions);
fullHtml.addEventListener("change", pushOptions);

// Live-update the package count while the panel is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.collection) {
    renderPackage(changes.collection.newValue || []);
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

// --- Init ---------------------------------------------------------------
(async () => {
  const v = await chrome.storage.local.get(["mode", "computedCss", "fullHtml"]);
  mode = v.mode === "copy" ? "copy" : "collect";
  computedCss.checked = !!v.computedCss;
  fullHtml.checked = !!v.fullHtml;
  renderMode();
  await loadPackage();
  await refreshForActiveTab();
})();
