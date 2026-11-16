# keyhtml

A Keynote-style slide editor whose documents are plain, self-contained `.html` files.

* **Edit in a GUI** — click, drag, resize, rotate; text boxes with rich text; shapes, lines, tables;
  slide navigator with drag-reorder; inspector panel; undo/redo; alignment guides that snap like Keynote.
* **PDF figures stay vector** — drop a PDF (e.g. a matplotlib figure) onto a slide and it is converted
  to SVG with text as outlines. It is sharp at any projector resolution. Multi-page PDFs: pick the page.
* **LaTeX** — type `$E = mc^2$` inside any text box, `$$…$$` for display math, or insert a standalone
  equation. Rendered with MathJax at edit time into inline SVG, so the saved deck needs no JavaScript
  libraries and no network.
* **Movies** — drop an `.mp4`/`.webm`/`.mov`; set autoplay / loop / muted / controls; start offset.
* **Present from the file itself** — open the `.html` in any browser. Arrow keys, builds (appear on click),
  transitions, overview grid, black screen, a presenter window with notes + timer, print-to-PDF.
* **Imports hand-written HTML decks** — a file made of `<section class="slide">`s becomes a keyhtml deck:
  each section is a full-slide block you can edit in place, `<aside>` becomes presenter notes, the deck's
  CSS and JS are preserved.

The on-disk format is readable HTML: absolutely positioned elements inside `<section class="kh-slide">`,
and you can hand-edit it in a text editor. Assets (images, SVGs made from PDFs, movies) live in a sibling
folder `<deck>_assets/`.

## Install and run

Requirements: Python ≥ 3.9 and a Chromium or WebKit browser (Chrome, Safari, Edge, Arc…). PDF conversion
needs **PyMuPDF** (`pip install pymupdf`); alternatively `pdftocairo` (poppler), `mutool`, `inkscape` or
`pdf2svg` on the PATH.

```bash
cd keyhtml
uv pip install -e .            # or: pip install -e .   (installs the `keyhtml` command)
keyhtml talk.html              # creates talk.html if it does not exist, opens the editor in your browser
# equivalently, without installing:
python -m keyhtml talk.html
```

Options: `--root DIR` (directory the editor may see; default: the deck's directory), `--port N`
(default 8765), `--no-browser`. Everything runs on `127.0.0.1` only. The server process is the editor's
file backend; leave it running while you edit, Ctrl-C to stop. Saving is automatic (toggle in the
Document tab); a `.bak` of the previous version is kept next to the deck.

To present, you do not need the server: open `talk.html` directly (double-click, or `open talk.html`).
`File ▸ Export Standalone HTML` writes `talk_standalone.html` with every asset embedded as a data URI, for
carrying a single file to another machine.

## Editing

| Toolbar | |
|---|---|
| **Add Slide ▾** | layouts: Title, Title & Bullets, Two Column, Section, Image & Caption, Quote, Blank |
| **Text** | new text box (also the `T` key) — double-click any text to edit it |
| **Shape ▾** | rectangles, ellipses, polygons, arrows, lines; shapes can hold text |
| **Media ▾** | image / PDF / movie from a file picker or a path. Or **drag files onto the slide**, or **paste** a screenshot |
| **Equation** | LaTeX equation block (MathJax, display mode) |
| **Table** | 3×3 table inside a text box (+/- rows and columns in the inspector) |
| **HTML** | an arbitrary HTML block (iframes, custom markup) |
| **Play** | saves and opens the deck in a new tab at the current slide |

The inspector (right) has three tabs: **Format** (properties of the selection, or the slide background
when nothing is selected), **Animate** (build order and effect; slide transitions) and **Document**
(title, slide size, theme presets incl. Dark, fonts, LaTeX macros, custom CSS/JS, export).

Shortcuts (also under `File ▸ Keyboard Shortcuts`, `⌘/`): `⌘S` save · `⌘Z/⇧⌘Z` undo/redo · `⌘D` duplicate
· `⌘C ⌘X ⌘V` · `⌫` delete · arrows nudge (`⇧` ×10) · `⌘] ⌘[` reorder · `⌘L` lock · `⌘G/⇧⌘G` group/ungroup ·
`⌘K` crop image · `⇧⌘N` new slide · `⌘= ⌘- ⌘0` zoom · `⌥-drag` duplicate · `⇧-drag` constrain ·
`Esc` stop editing / step out of a group · `⌘⏎` finish editing.

### Groups

Select two or more objects and press `⌘G` (or right-click ▸ Group). A group moves, rotates, resizes,
builds and locks as one object; resizing scales everything inside, including text sizes when the
aspect ratio is kept. Double-click a group to select the object under the cursor inside it (then
double-click again to edit text, drag it, or crop it); `Esc` steps back out to the group. Groups nest.
`⇧⌘G` ungroups; a group whose children are deleted down to one dissolves by itself.

### Cropping images

Double-click an image (or press `⌘K` / `⏎`, or use Format ▸ Crop…) to edit its mask the way Keynote
does: the whole image shows as a ghost, the box is the visible window. Drag the image to pan it, drag
the handles to change the window (they snap to the image's edges), use the slider to scale the image,
`Reset` to show the whole image again, `Done`/`⏎`/`Esc` to finish. Once cropped, resizing the box
scales the crop with it. Works for PDF-derived figures too.

### Text and LaTeX

While editing text, formatting in the inspector applies to the selection (bold, italic, size, color,
lists, super/subscript, alignment). With the box selected (not editing), it applies to the whole box.
Inline math: `$\sigma_A = 1/\sqrt{s^T C^{-1} s}$` renders when you leave the box; double-click to see
the source again. `$$ … $$` makes a centered display equation inside the text flow. The **Equation**
button makes a resizable standalone equation. Macros for the whole deck go in `Document ▸ LaTeX`.

### PDFs

A dropped PDF is copied to `<deck>_assets/` and page 1 is converted to `name.p1.svg`. The image's
inspector has a page stepper; each page is converted on demand. Text in the PDF becomes outlines, so the
SVG is self-contained. Raster images embedded in the PDF stay raster.

### Builds, transitions, notes

Select objects, open **Animate**, set an order (1, 2, 3…) — the object appears on the n-th click. Effects:
fade, appear, rise, pop, slide. Transitions (fade, push, zoom) per deck or per slide. Presenter notes
are typed in the pane under the canvas and shown in the presenter window (`n` while presenting).

## Presenting

Open the `.html`. Keys: `→ ↓ space PgDn` next · `← ↑ PgUp` previous · `Home/End` · digits + `⏎` jump ·
`f` fullscreen · `o`/`Esc` overview · `b` black · `n` presenter window (current, next, notes, timer) ·
`?` help. `talk.html#7` opens slide 7. `talk.html?print` lays out one slide per page for the browser's
Print → Save as PDF. Movies with *Autoplay* start when their slide (or build step) appears.

## Importing existing HTML decks

Open any `.html` file with `keyhtml file.html`. If it is not a keyhtml deck, every leaf `<section>`
(or `.slide`) becomes a slide holding one full-slide HTML block, `<aside>` elements become notes,
`vh`/`vw` units are converted to pixels of the 1920×1080 slide, `<style>`s become the deck's custom CSS
(scoped under `.kh-deck` so they cannot restyle the editor), inline scripts become the deck's custom JS
and `<script src>` tags are kept as external scripts. Double-click a block to edit its text in place, or
add keyhtml objects on top. Save under a new name to keep the original.

Custom JS runs only when presenting. The player exposes hooks so interactive demos keep working:

```js
document.addEventListener('kh:ready', e => { /* e.detail.slides */ });
document.addEventListener('kh:slide', e => { /* e.detail.index, .step, .slide (the <section>), .keep (same slide, build step) */ });
document.addEventListener('kh:next',  e => { if (myDemoHandledIt()) e.preventDefault(); }); // also kh:prev
window.khPlayer.current()  // {index, step, slide};  khPlayer.show(i), .next(), .prev()
```

Decks with their own keyboard navigation: the player stops handled key events from reaching later
listeners, so replace the old navigation block with a few lines using the hooks above (see
`examples/legacy-nav-shim.js`).

## File format (for hand editing)

```html
<div class="kh-deck" data-width="1920" data-height="1080" data-transition="fade" style="--kh-bg:#fff; --kh-color:#1d1d1f; …">
  <section class="kh-slide" style="background:#000">
    <div class="kh-el kh-text kh-heading" style="left:110px; top:70px; width:1700px; height:auto; font-size:72px"><div class="kh-body">Title</div></div>
    <div class="kh-el kh-image" style="left:…"><img src="talk_assets/fig.p1.svg" data-pdf="talk_assets/fig.pdf" data-page="1" data-pages="3"></div>
    <div class="kh-el kh-video" style="…"><video src="talk_assets/movie.mp4" controls data-autoplay="1"></video></div>
    <div class="kh-el kh-math" data-tex="E=mc^2" data-fs="60" style="…"><svg …></svg></div>
    <div class="kh-el kh-shape kh-shape-rect" data-build="1" style="background:#4a90d9; …"><div class="kh-body">text in a shape</div></div>
    <div class="kh-el kh-image kh-cropped" style="…"><img src="photo.png" style="left:-25%; top:0%; width:150%; height:150%"></div>
    <div class="kh-el kh-group" style="left:100px; top:100px; width:600px; height:400px; transform:rotate(10deg)">
      <div class="kh-el kh-text" style="left:0; top:0; …">children are positioned relative to the group box</div>
      …
    </div>
    <aside class="kh-notes">presenter notes</aside>
  </section>
</div>
```

Element types: `kh-text`, `kh-image`, `kh-video`, `kh-shape` (+ `kh-shape-rect|ellipse|triangle|…|line`),
`kh-math`, `kh-html`, `kh-group` (children are `kh-el`s with geometry relative to the group box; nestable).
Geometry is inline CSS in slide pixels; rotation is `transform: rotate(…)`. A cropped image has class
`kh-cropped` and its `<img>` positioned in percent of the box, so the crop survives resizing.
Per-element attributes: `data-build`, `data-build-effect`, `data-locked`, `data-lock-aspect`.
Per-slide: `data-transition`, `data-skip`. The `<head>` carries the deck CSS, the player CSS/JS, your
custom CSS (`#kh-custom-css`), LaTeX macros (`#kh-macros`) and custom JS (`#kh-custom-js`), all of
which keyhtml rewrites on save.

## Layout of this repository

```
keyhtml/__main__.py     CLI
keyhtml/server.py       local HTTP server + file/asset API
keyhtml/pdfconvert.py   PDF → SVG backends
keyhtml/static/         editor (editor.html, editor.css, js/*) and the runtime embedded in decks
                        (deck.css, player.css, player.js); vendor/mathjax
examples/               a sample deck and the legacy-navigation shim
tests/                  python unit tests for the server (python -m unittest discover tests)
```

## Known limitations of this first pass

Non-rectangular masks, gradient fills, animation timing and build-out effects are not
implemented. Rich-text editing uses the browser's contenteditable, so pasted text is inserted as plain
text. The editor is developed against Chrome; Safari works but has had less testing.
