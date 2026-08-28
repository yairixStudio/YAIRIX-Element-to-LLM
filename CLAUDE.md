# CLAUDE.md — YAIRIX - Element to LLM

## Repo
- **GitHub:** https://github.com/yairixStudio/YAIRIX-Element-to-LLM (public, branch `main`, MIT)
- **Extension name:** `YAIRIX - Element to LLM` — keep this prefix in `manifest.json` and HTML titles.
- **Current version:** 1.2 (`manifest.json`)

## What it is
Developer tool (MV3): toggle a picker, click any page element, and copy LLM-ready context (valid escaped CSS selector chain, DOM path, position, truncated HTML) to the clipboard. UI lives in Chrome's **side panel** (not a popup) — it stays open across tab switches. Permissions: `scripting`, `storage`, `sidePanel`; `host_permissions: ["<all_urls>"]` (swapped in for `activeTab` when the popup became a side panel — see below).

## SECURITY — signing key in parent folder
`element-to-llm.pem` (private signing key) and `element-to-llm.crx` live in the PARENT directory (`../`). **Never move, copy, read, or commit them.** The `.gitignore` blocks `*.pem`/`*.crx` as a safety net.

## Key files
- `content/content.js` — picker engine. Invariants to keep: selectors use `CSS.escape` + `.`-joined classes + 1-based `:nth-of-type`; attribute values escaped and capped at 200 chars; `truncate` pre-slices before regex (multi-MB text froze clicks); clipboard fallback focuses the textarea; highlight repositions on capture-phase scroll/resize; message listener responds synchronously (`return false`), one `sendResponse` per message; in-memory `active` flag is the single source of truth (no storage-based picker state). `activate()`/`deactivate()` also push `{type:"etl-state", active}` to the runtime (swallowed if no receiver) — the side panel's only way to notice an Esc/keyboard-triggered state change, since it has no "on open" moment to re-query at.
- `sidepanel/sidepanel.js` — restricted-page detection (disables toggle with status line), re-queries content script for authoritative state via `refreshForActiveTab()`, CSS-before-JS injection fallback. The panel is **global** (one instance per browser window, not per-tab) and stays open across tab switches — it re-syncs on `chrome.tabs.onActivated` / `onUpdated` / `chrome.windows.onFocusChanged` and on the `etl-state` push from content.js, so never assume the panel reloads when the user changes tabs. `refreshForActiveTab()` is guarded by a `refreshToken` (same pattern as `clock-ext/sidepanel.js`'s `probeToken`) — its fallback path (inject-then-send) is far slower than the direct-send path, so a fast tab switch can otherwise let a stale run resolve last and clobber a correct result; never drop that guard, and re-check the token after every `await` inside it. `host_permissions: ["<all_urls>"]` (swapped in for `activeTab`, which a plain tab switch doesn't re-grant) makes `tab.url` readable on http/https/file tabs and keeps the `executeScript` fallback working on tabs that predate load. It does **not** cover `chrome://` / `about:` / `devtools://` — `<all_urls>` doesn't match those schemes, so `tab.url` is undefined there and `isRestricted()` returns false. Detection for those pages rests entirely on `send()` returning `null` (chrome:// refuses script injection outright, regardless of permissions). Both branches are load-bearing; don't delete either.
- `background.js` — `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})` at top level (must re-register on every service-worker start — keep at top level, not inside a listener) so the toolbar icon opens the side panel; also routes the keyboard command with restricted-URL guard.

## Rules for agents
1. After any change: bump `"version"` in `manifest.json`, update `README.md` if behavior changed, then `git add -A && git commit -m "..." && git push` (remote `origin` configured).
2. Verify: `manifest.json` parses, referenced files exist, `node --check` on all three JS files.
3. Never commit `*.pem`, `*.crx`, `*.zip`, `.DS_Store` (see `.gitignore`).
