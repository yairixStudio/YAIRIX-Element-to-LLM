/* Element to LLM — content script
 * Two modes:
 *   "copy"    — click an element to copy its description immediately.
 *   "collect" — click an element, write a note, add it to a package.
 *               The package is copied as one block from the popup.
 */
(() => {
  "use strict";

  if (window.__elemToLlmLoaded) return;
  window.__elemToLlmLoaded = true;

  const MAX_TEXT = 300;
  const MAX_OUTER_HTML = 4000;

  let active = false;
  let options = { mode: "collect", computedCss: false, fullHtml: false };
  let noteOpen = false;
  let pendingItem = null;

  // --- UI elements --------------------------------------------------------
  let highlightBox = null;
  let label = null;
  let toast = null;
  let hint = null;
  let noteBox = null;
  let noteTextarea = null;
  let noteTitle = null;

  function mkUi(id) {
    const el = document.createElement("div");
    el.id = id;
    el.setAttribute("data-etl-ui", "");
    el.style.display = "none";
    document.documentElement.appendChild(el);
    return el;
  }

  function ensureUi() {
    if (highlightBox) return;

    highlightBox = mkUi("__etl-highlight");
    label = mkUi("__etl-label");

    hint = mkUi("__etl-hint");
    // hint text is set on activation (depends on mode)

    // Note box (collect mode).
    noteBox = mkUi("__etl-note");
    noteTitle = document.createElement("div");
    noteTitle.id = "__etl-note-title";
    noteTextarea = document.createElement("textarea");
    noteTextarea.id = "__etl-note-input";
    noteTextarea.placeholder =
      "What should change about this element? (Ctrl/⌘+Enter to add)";
    const row = document.createElement("div");
    row.id = "__etl-note-row";
    const addBtn = document.createElement("button");
    addBtn.id = "__etl-note-add";
    addBtn.textContent = "Add to package";
    const skipBtn = document.createElement("button");
    skipBtn.id = "__etl-note-skip";
    skipBtn.textContent = "Cancel";
    row.appendChild(skipBtn);
    row.appendChild(addBtn);
    noteBox.appendChild(noteTitle);
    noteBox.appendChild(noteTextarea);
    noteBox.appendChild(row);

    addBtn.addEventListener("click", commitNote);
    skipBtn.addEventListener("click", closeNote);
    noteTextarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commitNote();
      }
    });
  }

  function showToast(message, ok = true) {
    if (!toast) toast = mkUi("__etl-toast");
    toast.textContent = message;
    toast.classList.toggle("__etl-toast-err", !ok);
    toast.classList.add("__etl-toast-show");
    clearTimeout(toast.__t);
    toast.__t = setTimeout(() => toast.classList.remove("__etl-toast-show"), 1600);
  }

  // --- DOM path -----------------------------------------------------------
  const cssEscape = (s) =>
    window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&");

  function describeNode(el) {
    let part = el.tagName.toLowerCase();
    if (el.id) part += "#" + cssEscape(el.id);
    if (el.classList.length) {
      part += "." + Array.from(el.classList, cssEscape).join(".");
    }
    const parent = el.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === el.tagName
      );
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
      }
    }
    return part;
  }

  function domPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      parts.unshift(describeNode(node));
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  // --- HTML line ----------------------------------------------------------
  const MAX_ATTR = 200;

  function escapeAttr(v) {
    return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  function openingTag(el) {
    let s = "<" + el.tagName.toLowerCase();
    for (const attr of el.attributes) {
      s += ` ${attr.name}="${escapeAttr(truncate(attr.value, MAX_ATTR))}"`;
    }
    return s + ">";
  }

  function truncate(str, n) {
    str = str || "";
    // Pre-slice so we never regex over multi-megabyte strings.
    if (str.length > n * 4) str = str.slice(0, n * 4);
    str = str.replace(/\s+/g, " ").trim();
    return str.length > n ? str.slice(0, n) + "…" : str;
  }

  function htmlLine(el) {
    if (options.fullHtml) return truncate(el.outerHTML, MAX_OUTER_HTML);
    const tag = el.tagName.toLowerCase();
    return `${openingTag(el)}${truncate(el.textContent, MAX_TEXT)}</${tag}>`;
  }

  // --- Computed CSS -------------------------------------------------------
  const CSS_PROPS = [
    "display", "position", "box-sizing",
    "width", "height", "margin", "padding",
    "color", "background-color", "background",
    "font-family", "font-size", "font-weight", "line-height", "text-align",
    "border", "border-radius", "box-shadow", "opacity",
    "flex-direction", "justify-content", "align-items", "gap",
    "grid-template-columns", "z-index", "transform"
  ];

  function computedCss(el) {
    const cs = getComputedStyle(el);
    const lines = [];
    for (const prop of CSS_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px") {
        lines.push(`  ${prop}: ${v};`);
      }
    }
    return lines.join("\n");
  }

  // --- Item model + formatting -------------------------------------------
  function buildItem(el) {
    const r = el.getBoundingClientRect();
    return {
      descriptor: describeNode(el),
      path: domPath(el),
      position:
        `top=${Math.round(r.top)}px, left=${Math.round(r.left)}px, ` +
        `width=${Math.round(r.width)}px, height=${Math.round(r.height)}px`,
      html: htmlLine(el),
      css: options.computedCss ? computedCss(el) : null
    };
  }

  function itemToText(item) {
    let out =
      `DOM Path: ${item.path}\n` +
      `Position: ${item.position}\n` +
      `HTML Element: ${item.html}`;
    if (item.css) out += `\nComputed CSS: {\n${item.css}\n}`;
    return out;
  }

  // --- Clipboard ----------------------------------------------------------
  // navigator.clipboard.writeText rejects when the document isn't focused
  // (e.g. DevTools has focus); fall back to a focused hidden textarea.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const prevFocus = document.activeElement;
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.opacity = "0";
        document.documentElement.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        return ok;
      } catch (_) {
        return false;
      }
    }
  }

  // --- Note box (collect mode) -------------------------------------------
  function openNote(el) {
    pendingItem = buildItem(el);
    noteOpen = true;
    noteTitle.textContent = pendingItem.descriptor;
    noteTextarea.value = "";
    noteBox.style.display = "block";
    setTimeout(() => noteTextarea.focus(), 0);
  }

  function closeNote() {
    noteOpen = false;
    pendingItem = null;
    if (noteBox) noteBox.style.display = "none";
    if (highlightBox) highlightBox.style.display = "none";
    if (label) label.style.display = "none";
  }

  function commitNote() {
    if (!pendingItem) return;
    const item = { ...pendingItem, note: noteTextarea.value.trim() };
    chrome.storage.local.get(["collection"], (v) => {
      const arr = Array.isArray(v.collection) ? v.collection : [];
      arr.push(item);
      chrome.storage.local.set({ collection: arr }, () => {
        showToast(`✓ Added — ${arr.length} in package`);
      });
    });
    closeNote();
  }

  // --- Event handlers -----------------------------------------------------
  function isOwnUi(el) {
    return el && el.closest && el.closest("[data-etl-ui]");
  }

  let lastEl = null;

  function positionOverlay(el) {
    const r = el.getBoundingClientRect();

    highlightBox.style.display = "block";
    highlightBox.style.top = r.top + "px";
    highlightBox.style.left = r.left + "px";
    highlightBox.style.width = r.width + "px";
    highlightBox.style.height = r.height + "px";

    label.style.display = "block";
    label.textContent = describeNode(el);
    const top = r.top > 24 ? r.top - 22 : r.bottom + 4;
    label.style.top = top + "px";
    label.style.left = Math.max(0, r.left) + "px";
  }

  function onMove(e) {
    if (noteOpen) return; // freeze highlight while writing a note
    const el = e.target;
    if (!el || el.nodeType !== 1 || isOwnUi(el)) return;
    lastEl = el;
    positionOverlay(el);
  }

  // Keep the (position: fixed) overlay glued to the element while scrolling
  // or resizing; hide it if the element left the DOM.
  function onReflow() {
    if (!active || noteOpen) return;
    if (lastEl && lastEl.isConnected) {
      positionOverlay(lastEl);
    } else {
      lastEl = null;
      if (highlightBox) highlightBox.style.display = "none";
      if (label) label.style.display = "none";
    }
  }

  async function onClick(e) {
    if (noteOpen) return;
    const el = e.target;
    if (!el || el.nodeType !== 1 || isOwnUi(el)) return;
    e.preventDefault();
    e.stopPropagation();

    if (options.mode === "collect") {
      openNote(el);
    } else {
      const ok = await copyText(itemToText(buildItem(el)));
      showToast(ok ? "✓ Copied to clipboard" : "✗ Copy failed", ok);
    }
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (noteOpen) closeNote();
      else deactivate();
    }
  }

  function swallow(e) {
    if (isOwnUi(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  // --- Activation ---------------------------------------------------------
  function updateHint() {
    if (!hint) return;
    hint.textContent =
      options.mode === "collect"
        ? "Click an element to note it  •  Esc to exit"
        : "Click an element to copy  •  Esc to exit";
  }

  // Tell the side panel the state changed on its own (Esc, keyboard shortcut)
  // — unlike the old popup, the panel isn't re-created on every open, so it
  // can't just re-query when it "opens". No receiver when the panel is
  // closed, hence the swallowed rejection.
  function notifyStateChange() {
    chrome.runtime.sendMessage({ type: "etl-state", active }).catch(() => {});
  }

  function activate() {
    if (active) return;
    active = true;
    ensureUi();
    updateHint();
    hint.style.display = "block";
    document.documentElement.classList.add("__etl-active");
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", swallow, true);
    document.addEventListener("mouseup", swallow, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow, true);
    notifyStateChange();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    closeNote();
    lastEl = null;
    document.documentElement.classList.remove("__etl-active");
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", swallow, true);
    document.removeEventListener("mouseup", swallow, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onReflow, true);
    window.removeEventListener("resize", onReflow, true);
    if (highlightBox) highlightBox.style.display = "none";
    if (label) label.style.display = "none";
    if (hint) hint.style.display = "none";
    if (toast) {
      clearTimeout(toast.__t);
      toast.classList.remove("__etl-toast-show");
    }
    notifyStateChange();
  }

  function toggle() {
    active ? deactivate() : activate();
  }

  // --- Messaging ----------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "etl-set-options":
        options = { ...options, ...msg.options };
        updateHint();
        break;
      case "etl-toggle":
        toggle();
        break;
      case "etl-activate":
        activate();
        break;
      case "etl-deactivate":
        deactivate();
        break;
      case "etl-status":
        break;
    }
    // Always answer synchronously with the authoritative picker state so the
    // popup can never drift out of sync with this tab.
    sendResponse({ active });
    return false;
  });

  // Restore saved options on load.
  chrome.storage?.local.get(["mode", "computedCss", "fullHtml"], (v) => {
    options.mode = v.mode === "copy" ? "copy" : "collect";
    options.computedCss = !!v.computedCss;
    options.fullHtml = !!v.fullHtml;
    updateHint();
  });
})();
