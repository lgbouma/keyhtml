/* keyhtml editor — live preview of scripted HTML blocks.
   An HTML block whose content is drawn by the deck's JavaScript (canvas demos, data-demo sections…)
   is blank in the editor, because custom JS runs only when presenting. For such blocks the editor
   renders the whole deck with the real player inside an isolated <iframe> (mode 'preview': one slide,
   all builds shown, no input handling) and lays the result over the block. The block underneath stays
   the editable DOM: the overlay ignores the mouse and is hidden while the block is edited in place.
   A badge marks the block so the picture is not mistaken for editable content. */
(function () {
  'use strict';
  var M = KH.model, h = KH.h;
  var P = { enabled: true, blocks: [], dirty: true, loading: false };
  var layer = h('div', { id: 'live', hidden: true }), clip = h('div', { class: 'kh-live-clip' }), frame = null;
  layer.appendChild(clip);
  P.layer = layer;

  P.init = function () {
    try { P.enabled = localStorage.getItem('keyhtml.livePreview') !== '0'; } catch (e) {}
    var soon = KH.debounce(P.sync, 350);
    KH.on('slide', function () { soon.cancel(); P.sync(); });
    KH.on('change', function () { P.dirty = true; soon(); });
    KH.on('theme', function () { P.dirty = true; soon(); });
    KH.on('load', function () { P.dirty = true; P.sync(); });
    KH.on('edit-start', function (el) { if (P.blocks.indexOf(el) >= 0) P.sync(); });
    KH.on('edit-end', function () { P.dirty = true; soon.cancel(); P.sync(); });
  };
  P.setEnabled = function (on) {
    P.enabled = !!on;
    try { localStorage.setItem('keyhtml.livePreview', on ? '1' : '0'); } catch (e) {}
    P.sync(); KH.emit('select', KH.canvas.sel);
  };

  // ---- which blocks get a preview ---------------------------------------------
  P.hasScripts = function () { return !!((M.customJs && M.customJs.trim()) || (M.scripts && M.scripts.length)); };
  P.state = function (el) { var v = el.getAttribute('data-live'); return v === '1' ? 'on' : v === '0' ? 'off' : 'auto'; };
  P.setState = function (el, state) { if (state === 'auto') el.removeAttribute('data-live'); else el.setAttribute('data-live', state === 'on' ? '1' : '0'); };
  P.scripted = function (el) { return P.hasScripts() && !!el.querySelector('canvas,[data-demo],script,svg:empty'); };
  /* true when the block's content comes from scripts (explicitly, or detected) — regardless of the global switch */
  P.wants = function (el) { var s = P.state(el); return s === 'on' || (s === 'auto' && P.scripted(el)); };
  P.isLive = function (el) { return P.enabled && P.wants(el); };
  P.blocksOf = function (slide) { slide = slide || M.slide(); return slide ? KH.$$('.kh-html', slide).filter(P.wants) : []; };

  // ---- overlay ----------------------------------------------------------------
  function aabb(el) {
    var g = M.absGeom(el);
    if (!g.r) return { x: g.x, y: g.y, w: g.w, h: g.h };
    var th = g.r * Math.PI / 180, c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
    var w = g.w * c + g.h * s, hh = g.w * s + g.h * c;
    return { x: g.x + g.w / 2 - w / 2, y: g.y + g.h / 2 - hh / 2, w: w, h: hh };
  }
  function tagText(live) {
    if (!P.enabled) return 'Scripted HTML block · live preview off';
    return live ? 'Live preview · scripted HTML block' : 'Scripted HTML block';
  }
  P.sync = function () {
    if (!M.deck || !layer.isConnected) { layer.hidden = true; return; }
    var blocks = P.blocksOf(), editing = KH.text && KH.text.editing;
    KH.$$('.kh-live-tag,.kh-live-frame', layer).forEach(function (e) { layer.removeChild(e); });
    if (!blocks.length) { P.blocks = []; layer.hidden = true; return; }
    // the rendered picture: over the union of the live blocks, unless one of them is being edited in place
    var live = P.enabled && !(editing && blocks.indexOf(editing) >= 0);
    P.blocks = live ? blocks : [];
    var u = null;
    blocks.forEach(function (el) {
      var b = aabb(el);
      layer.appendChild(h('div', { class: 'kh-live-frame' + (live ? '' : ' off'), style: { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' } }));
      layer.appendChild(h('div', { class: 'kh-live-tag' + (live ? '' : ' off'), style: { left: b.x + 'px', top: b.y + 'px' },
        text: editing === el ? 'Editing in place · live preview paused' : tagText(live) }));
      if (!u) u = b;
      else {
        var x2 = Math.max(u.x + u.w, b.x + b.w), y2 = Math.max(u.y + u.h, b.y + b.h);
        u = { x: Math.min(u.x, b.x), y: Math.min(u.y, b.y) }; u.w = x2 - u.x; u.h = y2 - u.y;
      }
    });
    clip.hidden = !live;
    if (live) {
      Object.assign(clip.style, { left: u.x + 'px', top: u.y + 'px', width: u.w + 'px', height: u.h + 'px' });
      if (!frame || P.dirty) load(u); else { position(u); goTo(); }
    }
    layer.hidden = false;
  };
  function position(u) {
    if (!frame) return;
    Object.assign(frame.style, { left: -u.x + 'px', top: -u.y + 'px', width: M.W + 'px', height: M.H + 'px' });
  }
  function load(u) {
    if (!KH.assets) return;
    P.dirty = false;
    var html = M.buildHtml();
    var base = document.querySelector('base');
    var inject = '<base href="' + KH.escapeHtml(base ? base.href : location.origin + '/files/') + '">\n' +
      '<script>window.__khPreview={slide:' + M.cur + '};</script>\n';
    html = html.replace('<head>\n', '<head>\n' + inject);
    if (!frame) {
      frame = h('iframe', { class: 'kh-live-iframe', sandbox: 'allow-scripts allow-same-origin', title: 'Live preview' });
      frame.addEventListener('load', function () { P.loading = false; layer.classList.remove('loading'); goTo(); });
      clip.appendChild(frame);
    }
    position(u);
    P.loading = true; layer.classList.add('loading');
    frame.srcdoc = html;
  }
  function goTo() {
    if (!frame || P.loading) return;
    var pl = frame.contentWindow && frame.contentWindow.khPlayer;
    if (!pl) { P.dirty = true; return; }
    if (pl.current().index !== M.cur) pl.show(M.cur, 9999, 0);
  }
  P.reload = function () { P.dirty = true; P.sync(); };
  P.frame = function () { return frame; };

  KH.preview = P;
})();
