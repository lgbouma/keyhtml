# Notes for coding agents

## Rules

1. Never commit or push to git without Luke's explicit permission.
2. Never push to S3 without Luke's explicit permission.
3. Never co-author commits, and never tag them with agent sessions
   (no "Co-Authored-By", "Generated with", or session trailers).
4. Commit messages are title-only by default: one line of fewer than nine
   words. Add a body only when Luke asks for one; then it is at most two
   plain sentences saying what the commit does, wrapped at 72 characters.
   No trailers (rule 3).

## Working on keyhtml

- The README's "Layout of this repository" section maps the code. The
  editor is plain JS in `keyhtml/static/js/` (no build step); the player
  that ships inside every deck is `keyhtml/static/player.js` and
  `player.css`.
- Decks embed a copy of the player JS/CSS. A player change reaches a deck
  only after the deck is saved again in the editor; the editor loads
  `/static/*` at page load, so hard-refresh open editor tabs.
- Static files need no server restart; Python changes (`server.py`) do.
- Unit tests (server side, no browser): `python -m unittest discover tests`.
  Check JS syntax with `node --check <file>`. Test UI changes in headless
  Chrome (e.g. Playwright with `channel="chrome"`) against a scratch copy
  of a deck, served with `keyhtml --root DIR --port N --no-browser`.
- Never test against a deck Luke has open: the editor autosaves and merges
  outside changes into it.
