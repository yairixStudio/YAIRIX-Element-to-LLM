# YAIRIX - Element to LLM

**Click any element on a page and get LLM-ready context in your clipboard: CSS selector, DOM path, position, and HTML.**

A lightweight Chrome extension for developers who work with AI coding assistants. Instead of screenshotting your page or hand-copying markup, toggle the picker, click the element you want changed, and paste a clean, structured description straight into ChatGPT, Claude, Cursor, or any other LLM.

## Features

- **One-click element capture** — hover to highlight, click to copy. A live label shows the element's selector as you move.
- **LLM-ready output** — every capture includes the DOM path (valid CSS selector chain), viewport position and size, and the element's HTML.
- **Two modes**
  - *Click = Copy*: each click copies that element's description immediately.
  - *Collect package*: click several elements, attach a "requested change" note to each, then copy the whole package as one prompt-ready block (or save it as a `.txt` file).
- **Optional computed CSS** — include the key computed styles (layout, typography, colors, flex/grid) for pixel-accurate change requests.
- **Full or truncated HTML** — compact opening-tag + text summary by default, or full `outerHTML` (safely truncated) when you need it.
- **Keyboard friendly** — toggle the picker with `Alt+Shift+E`, exit with `Esc`.
- **Safe on huge pages** — attribute values and text are escaped and truncated, so a click on a giant element never floods your clipboard.

## Installation

### From source (load unpacked)

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `element-to-llm` folder (the one containing `manifest.json`).
5. Pin the extension from the puzzle-piece menu for one-click access.

### Chrome Web Store

*Coming soon — a Web Store listing link will be added here.*

## Usage

1. Open the page you're working on and click the extension icon (or press `Alt+Shift+E`).
2. Choose a mode: **Click = Copy** or **Collect package**.
3. Click **Start picking**, then click any element on the page.
4. Paste the result into your LLM chat.

Example output for a clicked button:

```
DOM Path: main > section.pricing > div.card:nth-of-type(2) > button.btn.btn-primary
Position: top=412px, left=684px, width=180px, height=44px
HTML Element: <button class="btn btn-primary" type="submit">Start free trial</button>
Computed CSS: {
  display: flex;
  width: 180px;
  height: 44px;
  color: rgb(255, 255, 255);
  background-color: rgb(79, 70, 229);
  font-size: 15px;
  font-weight: 600;
  border-radius: 8px;
}
```

In **Collect package** mode, each element also carries your note, so a multi-element prompt looks like:

```
## Element 1: button.btn.btn-primary
DOM Path: ...
Position: ...
HTML Element: ...
Requested change: make this button green and full-width on mobile
```

## Privacy

Everything happens locally in your browser. The extension makes **no network requests**, collects **no analytics**, and sends nothing anywhere — captured element data only goes to your clipboard (or a local `.txt` file you save). Collected packages are stored in Chrome's local extension storage on your machine until you clear them.

## Keywords

chrome extension, llm, ai coding, dom inspector, css selector, element picker, prompt engineering, claude, chatgpt, developer tools

## Author

Made by [Yairix Studio](https://yairix.com).

## License

[MIT](LICENSE) © 2026 Yairix Studio
