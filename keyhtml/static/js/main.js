/* keyhtml editor — bootstrap */
(function () {
  var M = KH.model;
  function initNotes() {
    // Rich-text notes: bold, italic and relative sizes (em) so the presenter window can scale them.
    var box = KH.$('#kh-notes-edit'), pane = KH.$('#notes-pane');
    var push = KH.debounce(function () { M.history.push(); }, 800);
    var save = function () { var s = M.slide(); if (s) { M.notesHtml(s, box.innerHTML); push(); } };
    var show = function () {
      var s = M.slide(), html = s ? M.notesHtml(s) : '';
      if (box.innerHTML !== html) box.innerHTML = html;
    };
    box.addEventListener('input', save);
    KH.on('slide', show);
    KH.on('load', show);
    KH.on('change', function (ev) { if (ev && ev.restored) show(); });

    var STEPS = [0.7, 0.85, 1, 1.25, 1.5, 2];
    var scaleOf = function (node) { // size relative to the notes text, from em-sized ancestors
      var f = 1;
      for (var n = node && node.nodeType === 1 ? node : node && node.parentNode; n && n !== box; n = n.parentNode) {
        var fs = n.style && n.style.fontSize; if (fs && /em$/.test(fs)) f *= parseFloat(fs);
      }
      return f;
    };
    var inBox = function () { var s = window.getSelection(); return s && s.rangeCount && box.contains(s.getRangeAt(0).commonAncestorContainer) ? s : null; };
    var texts = function (root, range) { // text nodes under root (inside range, if given)
      var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (var t = w.nextNode(); t; t = w.nextNode()) if (t.nodeValue.trim() && (!range || range.intersectsNode(t))) out.push(t);
      return out;
    };
    var tidy = function () { // drop empty style attributes and bare spans left by execCommand
      KH.$$('[style=""]', box).forEach(function (e) { e.removeAttribute('style'); });
      KH.$$('span:not([style]):not([class])', box).forEach(function (s) { while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s); s.remove(); });
    };
    function resize(dir) {
      var sel = inBox(); if (!sel || sel.isCollapsed) return;
      var first = texts(box, sel.getRangeAt(0))[0];
      var cur = scaleOf(first || sel.anchorNode);
      var next = dir > 0 ? (STEPS.filter(function (v) { return v > cur + 1e-3; })[0] || STEPS[STEPS.length - 1])
                         : (STEPS.filter(function (v) { return v < cur - 1e-3; }).pop() || STEPS[0]);
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      var spans = KH.$$('font[size="7"]', box).map(function (f) {
        KH.$$('[style*="font-size"]', f).forEach(function (x) { x.style.fontSize = ''; if (!x.getAttribute('style')) x.removeAttribute('style'); });
        var sp = document.createElement('span'), rel = next / scaleOf(f.parentNode);
        if (Math.abs(rel - 1) > 1e-3) sp.style.fontSize = KH.round(rel, 3) + 'em';
        while (f.firstChild) sp.appendChild(f.firstChild);
        f.replaceWith(sp);
        return sp;
      });
      var inner = [].concat.apply([], spans.map(function (sp) { return texts(sp); }));
      tidy();
      if (inner.length) { // reselect the text itself, so the next step reads the new size
        var last = inner[inner.length - 1], r = document.createRange();
        r.setStart(inner[0], 0); r.setEnd(last, last.nodeValue.length);
        sel.removeAllRanges(); sel.addRange(r);
      }
      save();
    }
    function fmt(cmd) {
      if (!inBox()) return;
      if (cmd === 'bigger') return resize(1);
      if (cmd === 'smaller') return resize(-1);
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(cmd === 'plain' ? 'removeFormat' : cmd);
      KH.$$('[style=""]', box).forEach(function (e) { e.removeAttribute('style'); }); // keeps the selection intact
      save();
    }
    KH.$$('#notes-fmt button').forEach(function (b) {
      b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the text selection
      b.addEventListener('click', function () { fmt(b.getAttribute('data-cmd')); });
    });
    box.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Enter' && !mod) { e.preventDefault(); document.execCommand('insertLineBreak'); return; }
      if (!mod) return;
      var k = e.key.toLowerCase();
      if (k === 'b' || k === 'i' || k === 'u') { e.preventDefault(); fmt(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline'); }
      else if (k === '=' || k === '+' || k === '>' || (e.shiftKey && k === '.')) { e.preventDefault(); resize(1); }
      else if (k === '-' || k === '_' || k === '<' || (e.shiftKey && k === ',')) { e.preventDefault(); resize(-1); }
    });
    box.addEventListener('paste', function (e) { // plain text only
      var t = e.clipboardData && e.clipboardData.getData('text/plain');
      if (t == null) return;
      e.preventDefault(); e.stopPropagation();
      document.execCommand('insertText', false, t);
    });
    // Drag the top edge of the notes pane to make it taller or shorter; the height is remembered.
    var grip = KH.$('#notes-grip'), DEFAULT_H = 90, MIN_H = 40;
    var maxH = function () { return Math.max(MIN_H, KH.$('#stage').clientHeight - KH.$('#notes-head').offsetHeight - 120); };
    var setH = function (px) { box.style.height = Math.round(Math.min(maxH(), Math.max(MIN_H, px))) + 'px'; };
    var refit = function () { if (KH.canvas.fitMode) KH.canvas.fit(); };
    try { var hs = parseFloat(localStorage.getItem('keyhtml.notesHeight')); if (hs > 0) setH(hs); } catch (e) {}
    var storeH = function () { try { localStorage.setItem('keyhtml.notesHeight', String(box.offsetHeight)); } catch (e) {} };
    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var y0 = e.clientY, h0 = box.offsetHeight;
      grip.setPointerCapture(e.pointerId);
      document.body.classList.add('notes-resizing');
      var move = function (ev) { setH(h0 + (y0 - ev.clientY)); refit(); };
      var up = function () {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        document.body.classList.remove('notes-resizing');
        storeH(); refit();
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', function () { setH(DEFAULT_H); storeH(); refit(); });
    window.addEventListener('resize', function () { if (box.offsetHeight > maxH()) { setH(maxH()); refit(); } });
    var collapsed = false;
    try { collapsed = localStorage.getItem('keyhtml.notes') === '0'; } catch (e) {}
    pane.classList.toggle('collapsed', collapsed);
    KH.$('#notes-toggle').addEventListener('click', function () {
      collapsed = !collapsed; pane.classList.toggle('collapsed', collapsed);
      try { localStorage.setItem('keyhtml.notes', collapsed ? '0' : '1'); } catch (e) {}
      if (KH.canvas.fitMode) setTimeout(KH.canvas.fit, 0);
    });
  }
  function boot() {
    KH.ui.init(); KH.canvas.init(); KH.nav.init(); KH.inspector.init(); KH.toolbar.init(); KH.io.init(); KH.sync.init();
    initNotes();
    KH.io.loadAssets().then(function () {
      return KH.io.api('/api/info');
    }).then(function (info) {
      KH.info = info;
      var sb = KH.$('#sb-right');
      sb.textContent = 'keyhtml ' + info.version + ' · root ' + info.root + ' · PDF: ' + (info.pdf_backend || 'none (pip install pymupdf)');
      if (!info.pdf_backend) KH.toast('No PDF converter found. Run: pip install pymupdf', 'error', 8000);
      var params = new URLSearchParams(location.search);
      var file = params.get('file');
      if (file) return KH.io.openFile(file).catch(function () { KH.ui.openDialog({ cancelable: false }); });
      KH.ui.openDialog({ cancelable: false });
    }).catch(function (e) {
      KH.toast('Could not reach the keyhtml server: ' + e.message, 'error', 10000);
    });
    KH.math.ready().then(function (ok) {
      if (!ok) KH.toast('MathJax failed to load; equations cannot be rendered', 'error');
      KH.mathReady = ok;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
