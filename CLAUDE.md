# CLAUDE.md — YAIRIX - Element to LLM

## Repo
- **GitHub:** https://github.com/yairixStudio/YAIRIX-Element-to-LLM (public, branch `main`, MIT)
- **Extension name:** `YAIRIX - Element to LLM` — keep this prefix in `manifest.json` and HTML titles.
- **Current version:** 1.1 (`manifest.json`)

## What it is
Developer tool (MV3): toggle a picker, click any page element, and copy LLM-ready context (valid escaped CSS selector chain, DOM path, position, truncated HTML) to the clipboard. Permissions: `activeTab`, `scripting`, `storage`.

## SECURITY — signing key in parent folder
`element-to-llm.pem` (private signing key) and `element-to-llm.crx` live in the PARENT directory (`../`). **Never move, copy, read, or commit them.** The `.gitignore` blocks `*.pem`/`*.crx` as a safety net.

## Key files
- `content/content.js` — picker engine. Invariants to keep: selectors use `CSS.escape` + `.`-joined classes + 1-based `:nth-of-type`; attribute values escaped and capped at 200 chars; `truncate` pre-slices before regex (multi-MB text froze clicks); clipboard fallback focuses the textarea; highlight repositions on capture-phase scroll/resize; message listener responds synchronously (`return false`), one `sendResponse` per message; in-memory `active` flag is the single source of truth (no storage-based picker state).
- `popup/popup.js` — restricted-page detection (disables toggle with status line), re-queries content script for authoritative state on open, CSS-before-JS injection fallback.
- `background.js` — keyboard command with restricted-URL guard.

## Rules for agents
1. After any change: bump `"version"` in `manifest.json`, update `README.md` if behavior changed, then `git add -A && git commit -m "..." && git push` (remote `origin` configured).
2. Verify: `manifest.json` parses, referenced files exist, `node --check` on all three JS files.
3. Never commit `*.pem`, `*.crx`, `*.zip`, `.DS_Store` (see `.gitignore`).
