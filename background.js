/* Element to LLM — service worker.
 * Routes the keyboard command to the active tab's content script.
 */

// Pages where content scripts can never run.
function isRestrictedUrl(url) {
  if (!url) return false; // unknown — attempt, the catch below handles failure
  if (!/^(https?|file):/.test(url)) return true; // chrome://, about:, …
  if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url)) {
    return true;
  }
  return false;
}

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || isRestrictedUrl(tab.url)) return;
  try {
    // A rejected promise here is the MV3 equivalent of chrome.runtime.lastError
    // ("Could not establish connection. Receiving end does not exist.").
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (_) {
    // Content script not present (e.g. tab predates install) — inject it.
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content/content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (e) {
      // Injection refused (policy-blocked page, etc.) — nothing we can do.
    }
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-picker") {
    sendToActiveTab({ type: "etl-toggle" });
  }
});
