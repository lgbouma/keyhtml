/* keyhtml editor — keep the open deck in step with changes made to the file outside the editor
   (a script, or an AI assistant working on other slides), without ever silently dropping work.

   Three versions of the deck take part:
     base  the file as of the last load / save / merge
     mine  the live editor DOM (possibly with unsaved edits)
     disk  the file as it is now
   They are compared unit by unit: every slide (matched by its data-kh-id), the slide order, and
   the deck-level settings (title, deck attributes/theme, custom CSS, custom JS, macros, external
   scripts, hidden extras). For each unit:
     only disk changed  -> take the disk version
     only mine changed  -> keep mine
     both changed       -> keep mine; for a slide, also insert the disk version right after it,
                           marked data-kh-conflict, so nothing is lost
   The merge runs (a) when polling sees the file change on disk and the editor is idle, and
   (b) when a save is refused because the file changed (HTTP 409), after which the save is retried.
   The server keeps the previous file as <deck>.bak on every save. */
KH.sync = (function () {
  var S = { base: null, busy: false, pollMs: 1000 };
  var M = KH.model, h = KH.h;
  var pending = null, declined = null, statMissing = false, pointerDown = false, idleWaiters = [], ticks = 0;

  // ---------------------------------------------------------------- fingerprints
  var SLIDE_TRANSIENT = ['kh-current', 'kh-leaving', 'kh-enter', 'kh-drop-target'];
  var EL_TRANSIENT = ['kh-editing', 'kh-hidden', 'kh-build-in', 'kh-build-preview-hidden', 'kh-empty'];
  var META_UNITS = ['title', 'deck', 'customCss', 'customJs', 'macros', 'scripts', 'extras'];

  function openTag(el) { return el.cloneNode(false).outerHTML.replace(/<\/[a-z0-9]+>$/i, ''); }
  function stripEmpty(root) {
    KH.$$('[style=""]', root).forEach(function (e) { e.removeAttribute('style'); });
    KH.$$('[class=""]', root).forEach(function (e) { e.removeAttribute('class'); });
    if (root.getAttribute('style') === '') root.removeAttribute('style');
    if (root.getAttribute('class') === '') root.removeAttribute('class');
  }
  /* Editor/player state that is never part of the document. Works on a clone. */
  function cleanSlide(c) {
    SLIDE_TRANSIENT.forEach(function (k) { c.classList.remove(k); });
    KH.$$('.kh-el', c).forEach(function (e) { EL_TRANSIENT.forEach(function (k) { e.classList.remove(k); }); });
    KH.$$('.kh-hidden, .kh-build-in', c).forEach(function (e) { e.classList.remove('kh-hidden', 'kh-build-in'); });
    KH.$$('[contenteditable]', c).forEach(function (e) { e.removeAttribute('contenteditable'); });
    stripEmpty(c);
    return c;
  }
  /* Canonical text of one slide (same layout the editor writes), without its id. */
  function slideKey(s) {
    var c = cleanSlide(s.cloneNode(true));
    c.removeAttribute('data-kh-id');
    var out = [openTag(c)];
    Array.prototype.forEach.call(c.childNodes, function (n) {
      if (n.nodeType === 1) out.push(n.outerHTML);
      else if (n.nodeType === 3 && n.nodeValue.trim()) out.push(n.nodeValue.trim());
    });
    return out.join('\n');
  }
  function deckTag(deck) {
    var d = deck.cloneNode(false);
    d.classList.remove('kh-back'); d.removeAttribute('data-kh-trans');
    ['transform', 'left', 'top'].forEach(function (p) { d.style[p] = ''; });
    d.style.width = (parseInt(d.getAttribute('data-width'), 10) || 1920) + 'px';
    d.style.height = (parseInt(d.getAttribute('data-height'), 10) || 1080) + 'px';
    stripEmpty(d);
    return openTag(d);
  }
  function extrasOf(deck) {
    return KH.$$(':scope > :not(.kh-slide)', deck).filter(function (e) { return e.id !== 'kh-num'; });
  }
  function extrasKey(deck) { return extrasOf(deck).map(function (e) { return e.outerHTML; }).join('\n'); }
  function unesc(s) { return (s || '').replace(/<\\\/(script|style)/gi, '</$1'); }
  function fallbackTitle() { return M.file ? M.file.replace(/^.*\//, '').replace(/\.html?$/i, '') : 'Untitled'; }
  /* Deck-level settings as model.loadHtml would read them from a parsed file. */
  function docMeta(doc, deck) {
    var mac = doc.getElementById('kh-macros'), cssSrc = doc.getElementById('kh-custom-css-src');
    var css = doc.getElementById('kh-custom-css'), js = doc.getElementById('kh-custom-js');
    return {
      title: doc.title || fallbackTitle(),
      deck: deckTag(deck),
      customCss: cssSrc ? unesc(cssSrc.textContent).trim() : (css ? css.textContent.trim() : ''),
      customJs: js ? unesc(js.textContent).trim() : '',
      macros: mac ? unesc(mac.textContent) : '',
      scripts: KH.$$('script.kh-ext[src]', doc).map(function (s) { return s.getAttribute('src'); }).join('\n'),
      extras: extrasKey(deck),
    };
  }
  function liveMeta() {
    return {
      title: M.title, deck: deckTag(M.deck), customCss: M.customCss || '', customJs: (M.customJs || '').trim(),
      macros: M.macros || '', scripts: (M.scripts || []).join('\n'), extras: extrasKey(M.deck),
    };
  }
  function slidesOf(deck) { return KH.$$(':scope > .kh-slide', deck); }
  function keysOf(deck) {
    var keys = new Map();
    slidesOf(deck).forEach(function (s) { var id = s.getAttribute('data-kh-id'); if (id && !keys.has(id)) keys.set(id, slideKey(s)); });
    return keys;
  }

  // ---------------------------------------------------------------- base bookkeeping
  /* Snapshot of the live deck taken synchronously when a save is built (or right after a load). */
  S.capture = function () {
    return { clone: M.deck.cloneNode(true), order: slidesOf(M.deck).map(M.slideId), meta: liveMeta() };
  };
  S.setBase = function (text, mtime, snap) {
    snap = snap || S.capture();
    S.base = { text: text, mtime: mtime, order: snap.order, meta: snap.meta, clone: snap.clone, liveKeys: null, parsed: null };
    pending = null;
  };
  function baseLiveKeys() {
    if (!S.base.liveKeys) { S.base.liveKeys = keysOf(S.base.clone); S.base.clone = null; }
    return S.base.liveKeys;
  }

  // ---------------------------------------------------------------- parsing files
  /* Parse a deck file. Returns null for an incomplete write or a file that is not a keyhtml deck. */
  function parseDeck(text) {
    if (!text || !/<\/html>\s*$/i.test(text)) return null;
    var doc = new DOMParser().parseFromString(text, 'text/html');
    var deck = doc.querySelector('.kh-deck');
    if (!deck) return null;
    var slides = slidesOf(deck);
    if (!slides.length) return null;
    return { doc: doc, deck: deck, slides: slides, meta: docMeta(doc, deck) };
  }
  /* Ids, keys and nodes of a parsed deck. Slides without an id (a file never saved by an editor
     that assigns ids) are matched by position to `positional` when the counts agree. */
  function index(parsed, positional) {
    var order = [], keys = new Map(), nodes = new Map(), used = new Set(), anyId = false;
    parsed.slides.forEach(function (s) { if (s.getAttribute('data-kh-id')) anyId = true; });
    var usePos = !anyId && positional && positional.length === parsed.slides.length;
    parsed.slides.forEach(function (s, i) {
      var id = s.getAttribute('data-kh-id');
      if (!id && usePos) id = positional[i];
      if (!id || used.has(id)) id = M.newSlideId(used);
      used.add(id);
      s.setAttribute('data-kh-id', id);
      order.push(id); keys.set(id, slideKey(s)); nodes.set(id, s);
    });
    return { order: order, keys: keys, nodes: nodes, idless: !anyId };
  }
  function baseIndexed() {
    if (!S.base.parsed) {
      var p = parseDeck(S.base.text);
      S.base.parsed = p ? { p: p, ix: index(p, S.base.order) } : false;
    }
    return S.base.parsed || null;
  }
  /* Bring a slide from a parsed file into the editor document, normalised as model.loadHtml does. */
  function importSlide(node) {
    var n = document.importNode(node, true);
    cleanSlide(n);
    KH.$$('video,audio', n).forEach(function (v) { v.muted = true; v.removeAttribute('autoplay'); });
    return n;
  }

  // ---------------------------------------------------------------- planning
  function sameSeq(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
  function mergeOrder(baseOrder, liveOrder, diskOrder, keep) {
    var inAll = function (id) { return liveOrder.indexOf(id) >= 0 && diskOrder.indexOf(id) >= 0; };
    var common = baseOrder.filter(inAll);
    var proj = function (o) { return o.filter(function (id) { return common.indexOf(id) >= 0; }); };
    var diskMoved = !sameSeq(proj(diskOrder), common), liveMoved = !sameSeq(proj(liveOrder), common);
    var primary = diskMoved && !liveMoved ? diskOrder : liveOrder;
    var secondary = primary === diskOrder ? liveOrder : diskOrder;
    var out = primary.filter(function (id) { return keep.has(id); });
    secondary.forEach(function (id, i) {
      if (!keep.has(id) || out.indexOf(id) >= 0) return;
      var j = i - 1; while (j >= 0 && out.indexOf(secondary[j]) < 0) j--;
      out.splice(j < 0 ? 0 : out.indexOf(secondary[j]) + 1, 0, id);
    });
    keep.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
    return { order: out, diskMoved: diskMoved, liveMoved: liveMoved, orderConflict: diskMoved && liveMoved };
  }

  function plan(bx, dx, disk) {
    var live = { order: M.slides().map(M.slideId), nodes: new Map() };
    M.slides().forEach(function (s) { live.nodes.set(M.slideId(s), s); });
    var liveKey = function (id) { return slideKey(live.nodes.get(id)); };
    var bLive = baseLiveKeys();
    var P = { take: new Set(), add: new Set(), remove: new Set(), restore: new Set(), copies: [], keptDeleted: [], keep: new Set(), diskVersion: new Map(), meta: {}, metaConflicts: [] };
    var all = new Set([].concat(S.base.order, live.order, dx.order));
    all.forEach(function (id) {
      var inB = S.base.order.indexOf(id) >= 0, inD = dx.keys.has(id), inL = live.nodes.has(id);
      var dCh = inD && (!bx || !bx.keys.has(id) || bx.keys.get(id) !== dx.keys.get(id));
      var lCh = inL && (!bLive.has(id) || bLive.get(id) !== liveKey(id));
      var diskLiveKey = function () { if (!P.diskVersion.has(id)) P.diskVersion.set(id, slideKey(importSlide(dx.nodes.get(id)))); return P.diskVersion.get(id); };
      if (inB && inD && inL) {
        P.keep.add(id);
        if (!dCh) return;
        if (!lCh) { P.take.add(id); return; }
        if (diskLiveKey() !== liveKey(id)) P.copies.push({ id: id, copyId: M.newSlideId() });
      } else if (inB && inL && !inD) {          // deleted on disk
        if (lCh) { P.keep.add(id); P.keptDeleted.push(id); } else P.remove.add(id);
      } else if (inB && inD && !inL) {          // deleted here
        if (dCh) { P.keep.add(id); P.restore.add(id); }
      } else if (!inB && inD && !inL) {         // new on disk
        P.keep.add(id); P.add.add(id);
      } else if (!inB && inL && !inD) {         // new here
        P.keep.add(id);
      } else if (!inB && inD && inL) {          // same new id on both sides (unusual)
        P.keep.add(id);
        if (diskLiveKey() !== liveKey(id)) P.copies.push({ id: id, copyId: M.newSlideId() });
      }
    });
    var mo = mergeOrder(S.base.order, live.order, dx.order, P.keep);
    P.order = mo.order; P.orderConflict = mo.orderConflict;
    P.copies.forEach(function (c) { P.order.splice(P.order.indexOf(c.id) + 1, 0, c.copyId); });
    var lm = liveMeta();
    META_UNITS.forEach(function (u) {
      var b = S.base.meta[u], d = disk.meta[u], l = lm[u];
      if (d === b || d === l) P.meta[u] = 'mine';
      else if (l === b) P.meta[u] = 'disk';
      else { P.meta[u] = 'mine'; P.metaConflicts.push(u); }
    });
    P.live = live;
    P.changesLive = P.take.size || P.add.size || P.remove.size || P.restore.size || P.copies.length ||
      !sameSeq(P.order, live.order) || META_UNITS.some(function (u) { return P.meta[u] === 'disk'; });
    return P;
  }

  // ---------------------------------------------------------------- applying
  function markConflict(slide, text) {
    slide.setAttribute('data-kh-conflict', '1');
    var notes = KH.$(':scope > .kh-notes', slide);
    if (!notes) { notes = h('aside', { class: 'kh-notes' }); slide.appendChild(notes); }
    notes.insertBefore(document.createTextNode(text + (notes.textContent ? '\n\n' : '')), notes.firstChild); // keeps formatting
  }
  function applyMeta(P, disk) {
    if (P.meta.title === 'disk') M.title = disk.meta.title;
    if (P.meta.customCss === 'disk') { M.customCss = disk.meta.customCss; KH.io.applyCustomCss(); }
    if (P.meta.customJs === 'disk') M.customJs = disk.meta.customJs;
    if (P.meta.macros === 'disk') M.macros = disk.meta.macros;
    if (P.meta.scripts === 'disk') M.scripts = disk.meta.scripts ? disk.meta.scripts.split('\n') : [];
    if (P.meta.deck === 'disk') {
      Array.prototype.slice.call(M.deck.attributes).forEach(function (a) { M.deck.removeAttribute(a.name); });
      Array.prototype.forEach.call(disk.deck.attributes, function (a) { M.deck.setAttribute(a.name, a.value); });
      M.deck.classList.remove('kh-back'); M.deck.removeAttribute('data-kh-trans');
      ['transform', 'left', 'top'].forEach(function (p) { M.deck.style[p] = ''; });
      M.setSize(parseInt(M.deck.getAttribute('data-width'), 10) || 1920, parseInt(M.deck.getAttribute('data-height'), 10) || 1080);
      KH.emit('theme');
    }
    if (P.meta.extras === 'disk') {
      extrasOf(M.deck).forEach(function (e) { e.remove(); });
      extrasOf(disk.deck).forEach(function (e) { M.deck.appendChild(document.importNode(e, true)); });
    }
  }
  function applySlides(P, dx) {
    var nodes = new Map(), copyOf = new Map();
    P.copies.forEach(function (c) { copyOf.set(c.copyId, c.id); });
    P.order.forEach(function (id) {
      if (copyOf.has(id)) {
        var c = importSlide(dx.nodes.get(copyOf.get(id)));
        c.setAttribute('data-kh-id', id);
        markConflict(c, '⚠ Disk version: this slide was changed outside the editor while you were editing it here. The slide before this one is your version. Keep one and delete the other.');
        nodes.set(id, c);
      } else if (P.take.has(id) || P.add.has(id) || P.restore.has(id)) {
        var n = importSlide(dx.nodes.get(id));
        if (P.restore.has(id)) markConflict(n, '⚠ Restored: you deleted this slide, but it was changed outside the editor meanwhile. Delete it again if you do not need it.');
        nodes.set(id, n);
      } else nodes.set(id, P.live.nodes.get(id));
    });
    // replace in place, drop removed slides, then put everything in the merged order
    P.live.nodes.forEach(function (el, id) {
      if (!nodes.has(id)) el.remove();
      else if (nodes.get(id) !== el) el.replaceWith(nodes.get(id));
    });
    var prev = null;
    P.order.forEach(function (id) {
      var n = nodes.get(id);
      var want = prev ? prev.nextElementSibling : M.deck.firstElementChild;
      if (n !== want) M.deck.insertBefore(n, want);
      prev = n;
    });
    return nodes;
  }
  /* Patch every undo/redo snapshot with the slides that came from disk, so ⌘Z undoes only your
     own edits instead of reverting the outside change. */
  function rebaseHistory(P, nodes) {
    var hist = M.history, html = new Map();
    var fromDisk = function (id) { return P.take.has(id) || P.add.has(id) || P.restore.has(id); };
    P.order.forEach(function (id) { if (fromDisk(id)) html.set(id, cleanSlide(nodes.get(id).cloneNode(true)).outerHTML); });
    hist.stack.forEach(function (snap, k) {
      if (k === hist.index) return;
      var box = document.createElement('div'); box.innerHTML = snap.html;
      var byId = new Map(); slidesOf(box).forEach(function (s) { byId.set(s.getAttribute('data-kh-id'), s); });
      var curEl = slidesOf(box)[snap.cur], curId = curEl ? curEl.getAttribute('data-kh-id') : null;
      var touchedCur = false;
      var make = function (id) { var t = document.createElement('div'); t.innerHTML = html.get(id); return t.firstElementChild; };
      P.remove.forEach(function (id) { if (byId.has(id)) { byId.get(id).remove(); byId.delete(id); if (id === curId) touchedCur = true; } });
      P.take.forEach(function (id) { if (byId.has(id)) { var n = make(id); byId.get(id).replaceWith(n); byId.set(id, n); if (id === curId) touchedCur = true; } });
      P.order.forEach(function (id, i) {
        if (!(P.add.has(id) || P.restore.has(id)) || byId.has(id)) return;
        var j = i - 1; while (j >= 0 && !byId.has(P.order[j])) j--;
        var n = make(id);
        if (j >= 0) byId.get(P.order[j]).after(n);
        else { var first = slidesOf(box)[0]; if (first) box.insertBefore(n, first); else box.appendChild(n); }
        byId.set(id, n);
      });
      var slides = slidesOf(box);
      var ci = curId && byId.has(curId) ? slides.indexOf(byId.get(curId)) : Math.min(snap.cur, slides.length - 1);
      hist.stack[k] = { html: box.innerHTML, cur: Math.max(0, ci), sel: touchedCur ? [] : snap.sel };
    });
    hist.stack[hist.index] = { html: M.deck.innerHTML, cur: M.cur, sel: KH.canvas.selIndices() };
  }

  function describe(P) {
    var num = function (id) { return P.order.indexOf(id) + 1; };
    var list = function (ids) { return ids.map(num).sort(function (a, b) { return a - b; }).join(', '); };
    var msgs = [];
    if (P.take.size) msgs.push('updated slide ' + list(Array.from(P.take)));
    if (P.add.size) msgs.push('added slide ' + list(Array.from(P.add)));
    if (P.remove.size) msgs.push('removed ' + P.remove.size + ' slide' + (P.remove.size > 1 ? 's' : ''));
    var info = msgs.length ? 'From disk: ' + msgs.join('; ') + '.' : '';
    var warn = [];
    P.copies.forEach(function (c) { warn.push('Slide ' + num(c.id) + ' was changed both here and on disk: kept yours, the disk version is slide ' + num(c.copyId) + '.'); });
    if (P.restore.size) warn.push('Restored slide ' + list(Array.from(P.restore)) + ': deleted here but changed on disk.');
    if (P.keptDeleted.length) warn.push('Kept slide ' + list(P.keptDeleted) + ': deleted on disk but you had edited it.');
    if (P.metaConflicts.length) warn.push('Deck settings changed both here and on disk (' + P.metaConflicts.join(', ') + '): kept yours.');
    if (P.orderConflict) warn.push('Slides were reordered both here and on disk: kept your order.');
    return { info: info, warn: warn.join(' ') };
  }

  /* Merge a file's text into the live deck. Resolves true when the editor is now based on it. */
  function mergeText(text, mtime) {
    var disk = parseDeck(text), base = S.base && baseIndexed();
    if (!disk || !S.base || !base) return Promise.resolve(false);
    var dx = index(disk, base.ix.idless ? S.base.order : null);
    var P = plan(base.ix, dx, disk);
    var go = Promise.resolve(true);
    if (P.remove.size >= 3 && P.remove.size > 0.4 * P.live.order.length) {
      go = KH.ui.confirm('Slides deleted on disk', P.remove.size + ' of ' + P.live.order.length + ' slides were deleted from ' + M.file +
        ' outside the editor. Remove them here too? (Cancel keeps the editor version; the next save will then ask before overwriting the file.)', 'Remove them');
    }
    return go.then(function (ok) {
      if (!ok) { declined = { mtime: mtime }; return false; }
      var wasDirty = KH.io.dirty;
      var curId = M.slideId(M.slide());
      if (P.changesLive) {
        if (KH.text.editing) KH.text.exit(true);
        applyMeta(P, disk);
        var nodes = applySlides(P, dx);
        var ids = M.slides().map(M.slideId), ci = ids.indexOf(curId);
        M.setCurrent(ci >= 0 ? ci : Math.min(M.cur, ids.length - 1));
        if (KH.canvas.sel.some(function (e) { return !e.isConnected; })) KH.canvas.clearSelection(true);
        rebaseHistory(P, nodes);
      }
      // the file on disk is the new base; slides nobody changed keep their old fingerprint
      var oldLive = baseLiveKeys(), liveKeys = new Map();
      dx.order.forEach(function (id) {
        var changedOnDisk = !base.ix.keys.has(id) || base.ix.keys.get(id) !== dx.keys.get(id);
        liveKeys.set(id, !changedOnDisk && oldLive.has(id) ? oldLive.get(id) : (P.diskVersion.get(id) || slideKey(importSlide(dx.nodes.get(id)))));
      });
      S.base = { text: text, mtime: mtime, order: dx.order, meta: disk.meta, clone: null, liveKeys: liveKeys, parsed: { p: disk, ix: dx } };
      M.mtime = mtime;
      var d = describe(P);
      if (d.warn) KH.toast(d.warn, 'error', 12000); else if (d.info) KH.toast(d.info, 'ok', 3500);
      if (P.changesLive) { KH.nav.refresh(); KH.inspector.refresh(); KH.canvas.renderSelection(); KH.emit('merged', P); }
      var needSave = wasDirty || P.copies.length || P.restore.size || P.keptDeleted.length || P.metaConflicts.length || P.orderConflict || dx.idless;
      if (needSave) KH.io.markDirty(); else KH.io.status();
      return true;
    });
  }

  // ---------------------------------------------------------------- driving it
  function idle() {
    S.busy = false;
    var w = idleWaiters; idleWaiters = [];
    w.forEach(function (fn) { fn(); });
  }
  S.whenIdle = function () { return S.busy ? new Promise(function (r) { idleWaiters.push(r); }) : Promise.resolve(); };
  function loadComplete(tries) {
    return KH.io.api('/api/load?file=' + encodeURIComponent(M.file)).then(function (res) {
      if (!res.exists || /<\/html>\s*$/i.test(res.html) || tries <= 0) return res;
      return new Promise(function (r) { setTimeout(r, 300); }).then(function () { return loadComplete(tries - 1); });
    });
  }
  /* Fetch the file and merge it. Resolves true if the editor is now based on the current file. */
  S.pull = function (preloaded) {
    if (S.busy) return S.whenIdle().then(function () { return S.pull(); });
    if (!M.file || !S.base) return Promise.resolve(false);
    S.busy = true;
    return (preloaded ? Promise.resolve(preloaded) : loadComplete(6)).then(function (res) {
      if (!res || !res.exists) return false;
      if (Math.abs(res.mtime - M.mtime) < 1e-3) return true;
      return mergeText(res.html, res.mtime);
    }).catch(function (e) {
      console.error('keyhtml sync', e);
      KH.toast('Could not merge the changes made on disk: ' + e.message, 'error', 8000);
      return false;
    }).then(function (r) { idle(); return r; }, function (e) { idle(); throw e; });
  };
  /* Called by io.save after a 409. */
  S.resolveConflict = function () { declined = null; return S.pull(); };

  function blocked() {
    return KH.io.saving || KH.text.editing || pointerDown || (KH.ui && KH.ui.modalOpen && KH.ui.modalOpen());
  }
  function stat() {
    var url = '/api/' + (statMissing ? 'load' : 'stat') + '?file=' + encodeURIComponent(M.file);
    return KH.io.api(url).catch(function (e) {
      if (e.status === 404 && !statMissing) { statMissing = true; return null; } // older server: fall back to /api/load
      return null;
    });
  }
  function tick() {
    if (!M.file || !M.exists || !S.base || S.busy || KH.io.saving) return;
    if (statMissing && (ticks++ % 3)) return; // full loads: poll less often
    var file = M.file;
    stat().then(function (st) {
      if (!st || !st.exists || file !== M.file || S.busy) return;
      if (Math.abs(st.mtime - M.mtime) < 1e-3) { pending = null; return; }
      if (declined && Math.abs(declined.mtime - st.mtime) < 1e-3) return;
      var size = st.size != null ? st.size : (st.html || '').length;
      // wait until two polls agree, so a write in progress is not read half-way
      if (!pending || Math.abs(pending.mtime - st.mtime) > 1e-3 || pending.size !== size) { pending = { mtime: st.mtime, size: size }; return; }
      if (blocked()) return;
      pending = null;
      S.pull(st.html != null ? st : null);
    });
  }

  S.init = function () {
    var down = function () { pointerDown = true; }, up = function () { pointerDown = false; };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    // editing a slide that was inserted as a conflict copy counts as resolving it
    KH.on('change', function (ev) {
      if (!ev || ev.restored || ev.nochange) return;
      var s = M.slide(); if (s && s.hasAttribute('data-kh-conflict')) s.removeAttribute('data-kh-conflict');
    });
    setInterval(tick, S.pollMs);
  };
  S._test = { slideKey: slideKey, mergeOrder: mergeOrder, parseDeck: parseDeck, tick: tick };
  return S;
})();
