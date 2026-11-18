/* keyhtml editor — canvas: zoom, selection, move/resize/rotate with alignment guides,
   marquee selection, groups, image cropping, keyboard shortcuts, clipboard, and drag-and-drop. */
KH.canvas = (function () {
  var C = { zoom: 1, fitMode: true, sel: [], guides: [], clipboard: null, clipboardText: null, crop: null };
  var M = KH.model, h = KH.h;
  var wrap, sizer, canvas, overlay, cropBar;
  var drag = null;
  var SNAP = 7; // screen px
  var ZOOMS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
  var HPOS = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };

  function inInput(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.isContentEditable && !t.closest('#canvas'))); }
  function rot(dx, dy, deg) { var th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th); return { x: dx * c + dy * s, y: -dx * s + dy * c }; } // rotate a slide-space delta into a frame rotated by deg

  C.init = function () {
    wrap = KH.$('#canvas-wrap'); sizer = KH.$('#canvas-sizer'); canvas = KH.$('#canvas');
    overlay = h('div', { id: 'overlay' });
    wrap.appendChild(h('div', { class: 'drop-hint', text: 'Drop images, PDFs or movies to insert' }));
    wrap.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    wrap.addEventListener('dblclick', onDblClick);
    // A link in a text box must not navigate the editor; ⌘-click opens it in a new tab.
    wrap.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || !canvas.contains(a)) return;
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) window.open(a.href, '_blank', 'noopener');
    });
    wrap.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('resize', function () { if (C.fitMode) C.fit(); });
    document.addEventListener('keydown', onKeyDown);
    wrap.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; wrap.classList.add('dragging'); });
    wrap.addEventListener('dragleave', function (e) { if (!e.relatedTarget || !wrap.contains(e.relatedTarget)) wrap.classList.remove('dragging'); });
    wrap.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    KH.on('slide', function () { if (C.crop) C.exitCrop(true); C.sel = []; C.renderSelection(); KH.emit('select', C.sel); });
    KH.on('change', function () { C.renderSelection(); });
  };
  C.mount = function (deck) {
    canvas.innerHTML = '';
    canvas.appendChild(deck);
    if (KH.preview) canvas.appendChild(KH.preview.layer); // live preview of scripted HTML blocks, under the selection overlay
    canvas.appendChild(overlay);
    C.sel = []; if (C.crop) C.exitCrop(true);
    C.fit();
  };
  C.setZoom = function (z, fit) {
    C.zoom = z; C.fitMode = !!fit;
    canvas.style.setProperty('--z', z);
    canvas.style.width = M.W + 'px'; canvas.style.height = M.H + 'px';
    overlay.style.width = M.W + 'px'; overlay.style.height = M.H + 'px';
    if (KH.preview) { KH.preview.layer.style.width = M.W + 'px'; KH.preview.layer.style.height = M.H + 'px'; }
    sizer.style.width = (M.W * z) + 'px'; sizer.style.height = (M.H * z) + 'px';
    C.renderSelection();
    KH.emit('zoom', z);
  };
  C.fit = function () {
    var z = Math.min((wrap.clientWidth - 40) / M.W, (wrap.clientHeight - 40) / M.H);
    C.setZoom(Math.max(0.05, z), true);
  };
  C.zoomStep = function (dir) {
    var z = C.zoom, next = z;
    if (dir > 0) next = ZOOMS.filter(function (v) { return v > z + 1e-6; })[0] || z;
    else { var arr = ZOOMS.filter(function (v) { return v < z - 1e-6; }); next = arr.length ? arr[arr.length - 1] : z; }
    C.setZoom(next, false);
  };
  C.toSlide = function (e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / C.zoom, y: (e.clientY - r.top) / C.zoom };
  };

  // ------------------------------------------------------------------ selection
  C.select = function (els, additive) {
    if (!additive) C.sel = [];
    els.forEach(function (el) { if (C.sel.indexOf(el) < 0) C.sel.push(el); });
    C.renderSelection(); KH.emit('select', C.sel);
  };
  C.toggle = function (el) {
    var i = C.sel.indexOf(el); if (i >= 0) C.sel.splice(i, 1); else C.sel.push(el);
    C.renderSelection(); KH.emit('select', C.sel);
  };
  C.clearSelection = function (silent) {
    if (KH.text.editing) KH.text.exit();
    if (C.crop) C.exitCrop(silent);
    C.sel = []; C.renderSelection();
    if (!silent) KH.emit('select', C.sel);
  };
  C.selIndices = function () { return C.sel.map(M.elPath).filter(function (p) { return p.length && p.indexOf(-1) < 0; }); };
  C.selectIndices = function (paths) {
    C.sel = (paths || []).map(function (p) { return Array.isArray(p) ? M.elAtPath(p) : M.elements()[p]; }).filter(Boolean);
    C.renderSelection(); KH.emit('select', C.sel);
  };
  C.selectAll = function () { C.select(M.elements().filter(function (e) { return !M.isLocked(e); })); };
  C.single = function () { return C.sel.length === 1 ? C.sel[0] : null; };
  /* The container whose children are being edited: a group when the selection lives inside one, else the slide. */
  C.container = function () {
    if (C.sel.length) { var p = C.sel[0].parentNode; if (p && p.classList.contains('kh-group') && C.sel.every(function (e) { return e.parentNode === p; })) return p; }
    return M.slide();
  };
  /* chain of .kh-el ancestors of an event target, innermost first, ending at the slide's direct child */
  function chainOf(t) {
    var out = [], el = t && t.closest ? t.closest('.kh-el') : null, slide = M.slide();
    while (el && el.closest('.kh-slide') === slide) { out.push(el); el = el.parentNode.classList.contains('kh-el') ? el.parentNode : null; }
    return out.length && out[out.length - 1].parentNode === slide ? out : [];
  }
  /* Keynote rule: clicks pick top-level objects, except inside the group that is currently "open" (selection inside it). */
  function pick(t) {
    var chain = chainOf(t); if (!chain.length) return null;
    var cont = C.container();
    if (cont !== M.slide()) for (var i = 0; i < chain.length; i++) if (chain[i].parentNode === cont) return chain[i];
    return chain[chain.length - 1];
  }
  function childUnder(group, t) { var chain = chainOf(t); for (var i = 0; i < chain.length; i++) if (chain[i].parentNode === group) return chain[i]; return null; }

  C.renderSelection = function () {
    if (!overlay) return;
    overlay.innerHTML = '';
    var slide = M.slide(); if (!slide) return;
    if (C.crop && (!C.crop.el.isConnected || C.crop.el.closest('.kh-slide') !== slide)) { C.crop = null; removeCropBar(); }
    KH.$$('.kh-el[data-build]', slide).forEach(function (el) {
      var b = parseInt(el.getAttribute('data-build'), 10);
      if (b > 0) { var g = M.absGeom(el); overlay.appendChild(h('div', { class: 'kh-badge', style: { left: g.x + 'px', top: g.y + 'px' }, text: String(b) })); }
    });
    C.sel = C.sel.filter(function (el) { return el.isConnected && el.closest('.kh-slide') === slide; });
    var sel = C.sel, z = C.zoom;
    sel.forEach(function (el) {
      if (C.crop && C.crop.el === el) { renderCrop(el); return; }
      var g = M.absGeom(el), locked = M.isLocked(el), type = M.type(el);
      var box = h('div', { class: 'kh-selbox' + (sel.length > 1 ? ' multi' : '') + (locked ? ' locked' : '') + (type === 'group' ? ' group' : ''),
        style: { left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px', transform: g.r ? 'rotate(' + g.r + 'deg)' : '' } });
      if (M.isNested(el)) { // outline the enclosing group faintly
        var pg = M.absGeom(el.parentNode);
        overlay.appendChild(h('div', { class: 'kh-selbox parent', style: { left: pg.x + 'px', top: pg.y + 'px', width: pg.w + 'px', height: pg.h + 'px', transform: pg.r ? 'rotate(' + pg.r + 'deg)' : '' } }));
      }
      if (sel.length === 1 && !locked && KH.text.editing !== el) {
        var handles;
        if (type === 'line') handles = ['w', 'e'];
        else if (M.isAspectLocked(el)) handles = ['nw', 'ne', 'sw', 'se'];
        else handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        handles.forEach(function (hh) {
          box.appendChild(h('div', { class: 'kh-handle', 'data-h': hh, style: { left: HPOS[hh][0] + '%', top: HPOS[hh][1] + '%' } }));
        });
        if (type !== 'line') {
          var d = 26 / z;
          box.appendChild(h('div', { class: 'kh-rotline', style: { left: '50%', top: (-d) + 'px', height: d + 'px' } }));
          box.appendChild(h('div', { class: 'kh-handle rot', title: 'Rotate (⇧ snaps to 45°)', style: { left: '50%', top: (-d) + 'px' } }));
        }
      }
      overlay.appendChild(box);
    });
    C.guides.forEach(function (gd) {
      overlay.appendChild(h('div', { class: 'kh-guide ' + gd.axis, style: gd.axis === 'v' ? { left: gd.pos + 'px' } : { top: gd.pos + 'px' } }));
    });
    if (drag && drag.type === 'marquee') {
      var r = normRect(drag);
      overlay.appendChild(h('div', { class: 'kh-marquee', style: { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' } }));
    }
    if (drag && drag.measure) {
      overlay.appendChild(h('div', { class: 'kh-measure', style: { left: drag.measure.x + 'px', top: drag.measure.y + 'px' }, text: drag.measure.text }));
    }
  };
  function normRect(d) {
    return { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
  }
  function intersects(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  // ------------------------------------------------------------------ snapping
  function snapTargets(others) {
    var xs = [0, M.W / 2, M.W], ys = [0, M.H / 2, M.H];
    others.forEach(function (el) {
      var g = M.visualBox(el);
      xs.push(g.x, g.x + g.w / 2, g.x + g.w); ys.push(g.y, g.y + g.h / 2, g.y + g.h);
    });
    return { xs: xs, ys: ys };
  }
  function snapMove(bb, dx, dy, targets) {
    var thr = SNAP / C.zoom, bestX = null, bestY = null, guides = [];
    [bb.x + dx, bb.x + dx + bb.w / 2, bb.x + dx + bb.w].forEach(function (cand) {
      targets.xs.forEach(function (t) { var d = t - cand; if (Math.abs(d) < thr && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d: d, t: t }; });
    });
    [bb.y + dy, bb.y + dy + bb.h / 2, bb.y + dy + bb.h].forEach(function (cand) {
      targets.ys.forEach(function (t) { var d = t - cand; if (Math.abs(d) < thr && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d: d, t: t }; });
    });
    if (bestX) { dx += bestX.d; guides.push({ axis: 'v', pos: bestX.t }); }
    if (bestY) { dy += bestY.d; guides.push({ axis: 'h', pos: bestY.t }); }
    return { dx: dx, dy: dy, guides: guides };
  }
  function snapEdge(val, list) {
    var thr = SNAP / C.zoom, best = null;
    list.forEach(function (t) { var d = t - val; if (Math.abs(d) < thr && (best === null || Math.abs(d) < Math.abs(best))) best = d; });
    return best;
  }

  // ------------------------------------------------------------------ mouse
  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (KH.ui) KH.ui.closePopovers();
    var t = e.target;
    if (t.closest('#crop-bar')) return;
    if (C.crop) {
      var ch = t.closest('.kh-handle.crop');
      if (ch) { e.preventDefault(); startCropHandle(ch, e); return; }
      if (t.closest('.kh-crop-wrap')) { e.preventDefault(); startCropPan(e); return; }
      C.exitCrop();
    }
    var handle = t.closest('.kh-handle');
    if (handle) { e.preventDefault(); startHandle(handle, e); return; }
    var editingEl = KH.text.editing;
    var elTarget = pick(t);
    if (editingEl) {
      if (elTarget === editingEl) return; // native caret / selection
      KH.text.exit();
      if (!elTarget) { C.clearSelection(); return; }
    }
    if (!elTarget) {
      if (!e.shiftKey) C.clearSelection();
      var p0 = C.toSlide(e);
      drag = { type: 'marquee', x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y, base: e.shiftKey ? C.sel.slice() : [] };
      e.preventDefault();
      return;
    }
    e.preventDefault();
    if (e.shiftKey || e.metaKey || e.ctrlKey) C.toggle(elTarget);
    else if (C.sel.indexOf(elTarget) < 0) C.select([elTarget]);
    if (M.isLocked(elTarget) || !C.sel.length) return;
    var p = C.toSlide(e);
    var els = C.sel.filter(function (x) { return !M.isLocked(x); });
    var nested = els.some(M.isNested);
    drag = { type: 'move', start: p, moved: false, els: els, alt: e.altKey, primary: elTarget, nested: nested,
             others: nested ? [] : M.elements().filter(function (x) { return C.sel.indexOf(x) < 0; }) };
    drag.targets = snapTargets(drag.others);
    drag.starts = els.map(function (el) { return M.geom(el); });
    drag.rots = els.map(M.ancestorRot);
  }
  function startHandle(handle, e) {
    var el = C.single(); if (!el) return;
    var g = M.geom(el), p = C.toSlide(e), ag = M.absGeom(el), anc = M.ancestorRot(el);
    if (handle.classList.contains('rot')) {
      drag = { type: 'rotate', el: el, g: g, cx: ag.x + ag.w / 2, cy: ag.y + ag.h / 2, start: p, anc: anc, ag: ag };
      return;
    }
    var hh = handle.getAttribute('data-h');
    drag = { type: 'resize', el: el, g: g, hh: hh, start: p, anc: anc, nested: M.isNested(el),
             sx: hh.indexOf('w') >= 0 ? -1 : hh.indexOf('e') >= 0 ? 1 : 0,
             sy: hh.indexOf('n') >= 0 ? -1 : hh.indexOf('s') >= 0 ? 1 : 0,
             lock: M.isAspectLocked(el), autoH: M.isAutoHeight(el), etype: M.type(el),
             snap: M.type(el) === 'group' ? M.groupSnapshot(el) : null,
             others: M.isNested(el) ? [] : M.elements().filter(function (x) { return x !== el; }) };
    drag.targets = snapTargets(drag.others);
  }
  function onMouseMove(e) {
    if (!drag) return;
    var p = C.toSlide(e);
    if (drag.type === 'move') {
      var dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved) {
        if (Math.hypot(dx * C.zoom, dy * C.zoom) < 3) return;
        drag.moved = true;
        if (drag.alt) { // option-drag duplicates
          var clones = M.duplicate(drag.els, 0, 0);
          drag.els = clones; C.sel = clones; drag.starts = clones.map(function (el) { return M.geom(el); });
        }
      }
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      var bb = unionBox(drag.starts);
      if (!drag.nested && (!e.altKey || drag.alt)) { var sn = snapMove(bb, dx, dy, drag.targets); dx = sn.dx; dy = sn.dy; C.guides = sn.guides; } else C.guides = [];
      drag.els.forEach(function (el, i) { var d = rot(dx, dy, drag.rots[i]); M.setGeom(el, { x: drag.starts[i].x + d.x, y: drag.starts[i].y + d.y }); });
      var mg = drag.nested ? M.absGeom(drag.els[0]) : { x: bb.x + dx, y: bb.y + dy, h: bb.h };
      drag.measure = { text: Math.round(mg.x) + ', ' + Math.round(mg.y), x: mg.x, y: mg.y + mg.h + 10 / C.zoom };
      C.renderSelection(); KH.emit('geom');
    } else if (drag.type === 'resize') {
      resizeTo(p, e.shiftKey);
    } else if (drag.type === 'rotate') {
      var ang = Math.atan2(p.y - drag.cy, p.x - drag.cx) * 180 / Math.PI + 90 - drag.anc;
      var r = ((ang % 360) + 360) % 360; if (r > 180) r -= 360;
      if (e.shiftKey) r = Math.round(r / 45) * 45;
      else [0, 90, 180, -90, -180].forEach(function (s) { if (Math.abs(r - s) < 3) r = s; });
      if (r === -180) r = 180;
      M.setGeom(drag.el, { r: r });
      drag.measure = { text: Math.round(r) + '°', x: drag.cx, y: drag.ag.y + drag.ag.h + 10 / C.zoom };
      C.renderSelection(); KH.emit('geom');
    } else if (drag.type === 'marquee') {
      drag.x1 = p.x; drag.y1 = p.y;
      var rect = normRect(drag);
      var hits = M.elements().filter(function (el) { return intersects(M.visualBox(el), rect); });
      C.sel = drag.base.slice();
      hits.forEach(function (el) { if (C.sel.indexOf(el) < 0) C.sel.push(el); });
      C.renderSelection();
    } else if (drag.type === 'cropresize') {
      cropResizeTo(p, e.shiftKey);
    } else if (drag.type === 'croppan') {
      var d = rot(p.x - drag.start.x, p.y - drag.start.y, drag.ag.r);
      var r0 = drag.r0, nr = { x: r0.x + d.x, y: r0.y + d.y, w: r0.w, h: r0.h }, thr = SNAP / C.zoom;
      if (!e.altKey) { // snap image edges to the crop window edges
        if (Math.abs(nr.x) < thr) nr.x = 0; else if (Math.abs(nr.x + nr.w - drag.bw) < thr) nr.x = drag.bw - nr.w;
        if (Math.abs(nr.y) < thr) nr.y = 0; else if (Math.abs(nr.y + nr.h - drag.bh) < thr) nr.y = drag.bh - nr.h;
      }
      M.cropSet(drag.el, nr);
      C.renderSelection();
    }
  }
  function unionBox(gs) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    gs.forEach(function (g) { x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y); x1 = Math.max(x1, g.x + g.w); y1 = Math.max(y1, g.y + g.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function resizeTo(p, shift) {
    var d = drag, g = d.g;
    var pd = rot(p.x - d.start.x, p.y - d.start.y, d.anc); // mouse delta in the parent's frame
    var dx = pd.x, dy = pd.y;
    var th = g.r * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
    var lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos; // delta in the element's local frame
    var w = g.w, hh = g.h, min = 8;
    if (d.sx) w = Math.max(min, g.w + d.sx * lx);
    if (d.sy) hh = Math.max(min, g.h + d.sy * ly);
    if (d.lock || shift) {
      var ar = g.w / g.h;
      if (d.sx && d.sy) { if (Math.abs(d.sx * lx) * g.h >= Math.abs(d.sy * ly) * g.w) hh = w / ar; else w = hh * ar; }
      else if (d.sx) hh = w / ar; else w = hh * ar;
    }
    // keep the opposite corner/edge anchored
    var ax = -d.sx * g.w / 2, ay = -d.sy * g.h / 2, bx = -d.sx * w / 2, by = -d.sy * hh / 2;
    var ddx = ax - bx, ddy = ay - by;
    var cx = g.x + g.w / 2 + ddx * cos - ddy * sin, cy = g.y + g.h / 2 + ddx * sin + ddy * cos;
    var nx = cx - w / 2, ny = cy - hh / 2;
    var guides = [];
    if (!g.r && !d.nested && !(d.lock || shift)) { // snap the moving edges
      if (d.sx > 0) { var s1 = snapEdge(nx + w, d.targets.xs); if (s1 !== null) { w += s1; guides.push({ axis: 'v', pos: nx + w }); } }
      if (d.sx < 0) { var s2 = snapEdge(nx, d.targets.xs); if (s2 !== null) { nx += s2; w -= s2; guides.push({ axis: 'v', pos: nx }); } }
      if (d.sy > 0) { var s3 = snapEdge(ny + hh, d.targets.ys); if (s3 !== null) { hh += s3; guides.push({ axis: 'h', pos: ny + hh }); } }
      if (d.sy < 0) { var s4 = snapEdge(ny, d.targets.ys); if (s4 !== null) { ny += s4; hh -= s4; guides.push({ axis: 'h', pos: ny }); } }
    }
    C.guides = guides;
    var geom = { x: nx, y: ny, w: w, h: hh };
    if (d.autoH && !d.sy && !(d.lock || shift)) delete geom.h;
    M.setGeom(d.el, geom);
    if (d.etype === 'line') KH.shapes.renderLine(d.el);
    if (d.etype === 'math') KH.math.syncSizeFromBox(d.el);
    if (d.etype === 'code') KH.code.syncSizeFromBox(d.el);
    if (d.etype === 'group') M.scaleGroupTo(d.el, d.snap, w, hh);
    var ag = M.absGeom(d.el);
    drag.measure = { text: Math.round(w) + ' × ' + Math.round(geom.h == null ? d.el.offsetHeight : hh), x: ag.x, y: ag.y + ag.h + 10 / C.zoom };
    C.renderSelection(); KH.emit('geom');
  }
  function onMouseUp() {
    if (!drag) return;
    var d = drag; drag = null; C.guides = [];
    if (d.type === 'marquee') { C.renderSelection(); KH.emit('select', C.sel); return; }
    if (d.type === 'move' && !d.moved) { C.renderSelection(); return; }
    if (d.type === 'move') d.els.forEach(M.fitAncestors);
    else if (d.el) M.fitAncestors(d.el);
    C.renderSelection();
    M.history.push();
  }
  function onDblClick(e) {
    if (e.target.closest('#crop-bar')) return;
    var el = pick(e.target);
    if (!el) return;
    if (KH.text.editing === el) return;
    var t = M.type(el);
    if (t === 'group') { var kid = childUnder(el, e.target); if (kid) C.select([kid]); return; }
    if (t === 'text' || t === 'shape' || t === 'html') { if (!M.isLocked(el)) KH.text.enter(el, e); }
    else if (t === 'math') KH.ui.editEquation(el);
    else if (t === 'code') KH.ui.editCode(el);
    else if (t === 'image') { if (!M.isLocked(el)) C.enterCrop(el); }
    else if (t === 'video') KH.ui.toggleVideoPreview(el);
  }
  function onContextMenu(e) {
    if (KH.text.editing) return;
    e.preventDefault();
    var el = pick(e.target);
    if (el) {
      if (C.sel.indexOf(el) < 0) C.select([el]);
      KH.ui.contextMenu(C.elementMenu(), e.clientX, e.clientY);
    } else {
      C.clearSelection();
      KH.ui.contextMenu(C.slideMenu(), e.clientX, e.clientY);
    }
  }

  // ------------------------------------------------------------------ image crop mode
  /* Keynote-style mask editing: the full image shows as a ghost, the box is the visible window.
     Drag inside to pan the image, drag the handles to change the window, slider to scale. */
  C.enterCrop = function (el) {
    if (M.type(el) !== 'image' || M.isLocked(el)) return;
    if (KH.text.editing) KH.text.exit();
    if (C.crop && C.crop.el !== el) C.exitCrop(true);
    C.sel = [el];
    C.crop = { el: el, refW: el.clientWidth || 1 };
    buildCropBar();
    C.renderSelection(); KH.emit('select', C.sel);
  };
  C.exitCrop = function (silent) {
    var cr = C.crop; if (!cr) return;
    C.crop = null; removeCropBar();
    if (cr.el.isConnected) M.cropNormalize(cr.el);
    C.renderSelection();
    if (!silent) M.history.push();
    KH.emit('select', C.sel);
  };
  C.resetCrop = function (el) {
    el = el || C.single(); if (!el) return;
    M.cropReset(el); C.renderSelection(); M.history.push();
    if (C.crop && C.crop.el === el) { C.crop.refW = el.clientWidth; syncCropBar(); }
  };
  function renderCrop(el) {
    var g = M.absGeom(el), r = M.cropGet(el), img = el.querySelector('img'), src = img ? img.getAttribute('src') : '';
    var bl = el.clientLeft, bt = el.clientTop; // border offsets
    var w = h('div', { class: 'kh-crop-wrap', style: { left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px', transform: g.r ? 'rotate(' + g.r + 'deg)' : '' } });
    var at = { left: (bl + r.x) + 'px', top: (bt + r.y) + 'px', width: r.w + 'px', height: r.h + 'px' };
    w.appendChild(h('img', { class: 'kh-crop-ghost', src: src, draggable: 'false', style: at }));
    w.appendChild(h('div', { class: 'kh-crop-win', style: { left: bl + 'px', top: bt + 'px', width: el.clientWidth + 'px', height: el.clientHeight + 'px' } },
      h('img', { class: 'kh-crop-full', src: src, draggable: 'false', style: { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' } })));
    w.appendChild(h('div', { class: 'kh-crop-outline' }));
    Object.keys(HPOS).forEach(function (hh) {
      w.appendChild(h('div', { class: 'kh-handle crop', 'data-h': hh, style: { left: HPOS[hh][0] + '%', top: HPOS[hh][1] + '%' } }));
    });
    overlay.appendChild(w);
    syncCropBar();
  }
  function buildCropBar() {
    removeCropBar();
    var slider = h('input', { type: 'range', min: '10', max: '400', step: '1', title: 'Image scale' });
    slider.addEventListener('input', function () { cropScale(parseFloat(slider.value), true); });
    slider.addEventListener('change', function () { cropScale(parseFloat(slider.value), false); slider.blur(); });
    var pct = h('span', { class: 'pct' }, '100%');
    cropBar = h('div', { id: 'crop-bar' },
      h('span', { class: 'lbl' }, 'Crop'),
      h('span', { class: 'help' }, 'drag the image to pan · handles set the window'),
      slider, pct,
      h('button', { onclick: function () { C.resetCrop(); } }, 'Reset'),
      h('button', { class: 'primary', onclick: function () { C.exitCrop(); } }, 'Done'));
    cropBar.slider = slider; cropBar.pct = pct;
    cropBar.addEventListener('mousedown', function (e) { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    wrap.appendChild(cropBar);
  }
  function removeCropBar() { if (cropBar) { cropBar.remove(); cropBar = null; } }
  function syncCropBar() {
    if (!cropBar || !C.crop) return;
    var r = M.cropGet(C.crop.el), v = Math.round(r.w / C.crop.refW * 100);
    if (document.activeElement !== cropBar.slider) cropBar.slider.value = String(KH.clamp(v, 10, 400));
    cropBar.pct.textContent = v + '%';
  }
  function cropScale(pct, live) {
    var cr = C.crop; if (!cr) return;
    var el = cr.el, r = M.cropGet(el), target = cr.refW * pct / 100, s = target / r.w;
    if (s > 0 && Math.abs(s - 1) > 1e-4) {
      var cx = el.clientWidth / 2, cy = el.clientHeight / 2; // scale about the window center
      M.cropSet(el, { x: cx - (cx - r.x) * s, y: cy - (cy - r.y) * s, w: r.w * s, h: r.h * s });
      C.renderSelection();
    }
    if (!live) M.history.push(); // commits the live preview too
  }
  function startCropPan(e) {
    var el = C.crop.el;
    drag = { type: 'croppan', el: el, start: C.toSlide(e), r0: M.cropGet(el), ag: M.absGeom(el), bw: el.clientWidth, bh: el.clientHeight };
  }
  function startCropHandle(handle, e) {
    var el = C.crop.el, hh = handle.getAttribute('data-h');
    drag = { type: 'cropresize', el: el, g: M.geom(el), r0: M.cropGet(el), start: C.toSlide(e), anc: M.ancestorRot(el), hh: hh,
             sx: hh.indexOf('w') >= 0 ? -1 : hh.indexOf('e') >= 0 ? 1 : 0, sy: hh.indexOf('n') >= 0 ? -1 : hh.indexOf('s') >= 0 ? 1 : 0,
             bd: { l: el.clientLeft, t: el.clientTop } };
  }
  /* Move the crop window's edges; the image stays fixed on the slide. */
  function cropResizeTo(p, shift) {
    var d = drag, g = d.g, r0 = d.r0, thr = SNAP / C.zoom, min = 8;
    var l = rot(p.x - d.start.x, p.y - d.start.y, d.anc + g.r); // mouse delta in the box's local frame
    var dl = d.sx < 0 ? l.x : 0, dr = d.sx > 0 ? l.x : 0, dt = d.sy < 0 ? l.y : 0, db = d.sy > 0 ? l.y : 0;
    var bw = g.w - d.bd.l * 2, bh = g.h - d.bd.t * 2; // inner (client) size
    // snap window edges to the image edges
    if (d.sx < 0 && Math.abs(dl - r0.x) < thr) dl = r0.x;
    if (d.sx > 0 && Math.abs(bw + dr - (r0.x + r0.w)) < thr) dr = r0.x + r0.w - bw;
    if (d.sy < 0 && Math.abs(dt - r0.y) < thr) dt = r0.y;
    if (d.sy > 0 && Math.abs(bh + db - (r0.y + r0.h)) < thr) db = r0.y + r0.h - bh;
    var w = g.w - dl + dr, hh = g.h - dt + db;
    if (shift && d.sx && d.sy) { // keep the window's aspect
      var ar = g.w / g.h;
      if (Math.abs(w - g.w) * g.h >= Math.abs(hh - g.h) * g.w) hh = w / ar; else w = hh * ar;
      if (d.sx < 0) dl = g.w + dr - w; else dr = w - g.w + dl;
      if (d.sy < 0) dt = g.h + db - hh; else db = hh - g.h + dt;
    }
    if (w < min) { w = min; if (d.sx < 0) dl = g.w + dr - w; }
    if (hh < min) { hh = min; if (d.sy < 0) dt = g.h + db - hh; }
    var th = g.r * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
    var ox = dl + w / 2 - g.w / 2, oy = dt + hh / 2 - g.h / 2; // new center relative to the old one, local frame
    var ncx = g.x + g.w / 2 + ox * cos - oy * sin, ncy = g.y + g.h / 2 + ox * sin + oy * cos;
    M.setGeom(d.el, { x: ncx - w / 2, y: ncy - hh / 2, w: w, h: hh });
    M.cropSet(d.el, { x: r0.x - dl, y: r0.y - dt, w: r0.w, h: r0.h });
    var ag = M.absGeom(d.el);
    drag.measure = { text: Math.round(w) + ' × ' + Math.round(hh), x: ag.x, y: ag.y + ag.h + 10 / C.zoom };
    C.renderSelection(); KH.emit('geom');
  }

  // ------------------------------------------------------------------ operations
  C.insert = function (el, opts) {
    opts = opts || {};
    M.add(el);
    if (opts.select !== false) C.select([el]);
    M.history.push();
    if (opts.edit) KH.text.enter(el);
    return el;
  };
  C.fitSize = function (nw, nh, frac, upscale) {
    frac = frac || 0.72;
    var mw = M.W * frac, mh = M.H * frac;
    var s = Math.min(mw / nw, mh / nh);
    if (!upscale) s = Math.min(1, s);
    return { w: nw * s, h: nh * s };
  };
  C.centerAt = function (el, w, hgt, point) {
    var p = point || { x: M.W / 2, y: M.H / 2 };
    var x = KH.clamp(p.x - w / 2, Math.min(0, M.W - w), Math.max(0, M.W - w));
    var y = KH.clamp(p.y - hgt / 2, Math.min(0, M.H - hgt), Math.max(0, M.H - hgt));
    M.setGeom(el, { x: x, y: y, w: w, h: hgt });
  };
  C.deleteSelection = function () {
    if (!C.sel.length) return;
    if (KH.text.editing) KH.text.exit(true);
    if (C.crop) C.exitCrop(true);
    M.remove(C.sel); C.sel = [];
    C.renderSelection(); KH.emit('select', C.sel); M.history.push();
  };
  C.duplicateSelection = function () { if (!C.sel.length) return; var c = M.duplicate(C.sel); c.forEach(M.fitAncestors); C.select(c); M.history.push(); };
  var nudgePush = KH.debounce(function () { C.sel.forEach(M.fitAncestors); C.renderSelection(); M.history.push(); }, 400);
  C.nudge = function (dx, dy) {
    if (C.crop) { var r = M.cropGet(C.crop.el); M.cropSet(C.crop.el, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }); C.renderSelection(); nudgePush(); return; }
    C.sel.forEach(function (el) { if (M.isLocked(el)) return; var g = M.geom(el); M.setGeom(el, { x: g.x + dx, y: g.y + dy }); });
    C.renderSelection(); KH.emit('geom'); nudgePush();
  };
  C.reorder = function (how) { if (!C.sel.length) return; M.reorder(C.sel, how); C.renderSelection(); M.history.push(); };
  C.toggleLock = function () {
    C.sel.forEach(function (el) { if (M.isLocked(el)) el.removeAttribute('data-locked'); else el.setAttribute('data-locked', '1'); });
    if (C.crop) C.exitCrop(true);
    C.renderSelection(); KH.emit('select', C.sel); M.history.push();
  };
  C.centerOnSlide = function (axis) { if (!C.sel.length) return; M.centerOnSlide(C.sel, axis); C.sel.forEach(M.fitAncestors); C.renderSelection(); M.history.push(); };
  C.align = function (how) { M.align(C.sel, how); C.sel.forEach(M.fitAncestors); C.renderSelection(); M.history.push(); };
  C.distribute = function (axis) { if (C.sel.length < 3) return; M.distribute(C.sel, axis); C.sel.forEach(M.fitAncestors); C.renderSelection(); M.history.push(); };
  /* apply a function to every selected element, then commit */
  C.apply = function (fn, opts) {
    C.sel.forEach(fn);
    C.sel.forEach(M.fitAncestors);
    C.renderSelection();
    if (!(opts && opts.nocommit)) M.history.push();
    KH.emit('geom');
  };
  C.canGroup = function () { return M.canGroup(C.sel); };
  C.hasGroup = function () { return C.sel.some(function (e) { return M.type(e) === 'group'; }); };
  C.group = function () {
    if (!C.canGroup()) return;
    if (KH.text.editing) KH.text.exit(true);
    var g = M.group(C.sel); if (!g) return;
    M.fitAncestors(g);
    C.select([g]); M.history.push();
  };
  C.ungroup = function () {
    var groups = C.sel.filter(function (e) { return M.type(e) === 'group' && !M.isLocked(e); });
    if (!groups.length) return;
    var kids = [];
    groups.forEach(function (g) { var p = M.parentGroup(g); kids = kids.concat(M.ungroup(g)); if (p) M.fitGroup(p); });
    C.select(kids); M.history.push();
  };

  // ------------------------------------------------------------------ clipboard
  function cleanEl(el) {
    var c = el.cloneNode(true);
    c.classList.remove('kh-editing');
    KH.$$('[contenteditable]', c).forEach(function (b) { b.removeAttribute('contenteditable'); });
    c.removeAttribute('contenteditable');
    if (M.isNested(el)) { var g = M.absGeom(el); M.setGeom(c, { x: g.x, y: g.y, r: g.r }); } // paste lands on the slide
    return c;
  }
  C.copySelection = function () {
    if (!C.sel.length) return null;
    var payload = JSON.stringify({ keyhtml: 1, html: C.sel.map(function (el) { return cleanEl(el).outerHTML; }) });
    C.clipboard = payload;
    C.clipboardText = C.sel.map(function (el) { return el.textContent.trim(); }).filter(Boolean).join('\n');
    return payload;
  };
  function onCopy(e) {
    if (KH.text.editing || inInput(e.target) || !C.sel.length) return;
    var payload = C.copySelection();
    try { e.clipboardData.setData('text/plain', C.clipboardText || ' '); e.clipboardData.setData('application/x-keyhtml', payload); e.preventDefault(); } catch (err) {}
  }
  function onCut(e) {
    if (KH.text.editing || inInput(e.target) || !C.sel.length) return;
    onCopy(e); C.deleteSelection();
  }
  C.pasteElements = function (htmls, point) {
    var tpl = document.createElement('template');
    var els = [];
    htmls.forEach(function (html) {
      tpl.innerHTML = html;
      var el = tpl.content.firstElementChild;
      if (!el || !el.classList.contains('kh-el')) return;
      el = document.importNode(el, true);
      var existing = M.elements();
      var g = { x: KH.px(el.style.left), y: KH.px(el.style.top) };
      if (point) { M.setGeom(el, { x: point.x, y: point.y }); point = { x: point.x + 24, y: point.y + 24 }; }
      else {
        var clash = existing.some(function (x) { return Math.abs(KH.px(x.style.left) - g.x) < 1 && Math.abs(KH.px(x.style.top) - g.y) < 1 && x.outerHTML === el.outerHTML; });
        if (clash) M.setGeom(el, { x: g.x + 24, y: g.y + 24 });
      }
      M.add(el); els.push(el);
    });
    if (els.length) { C.select(els); M.history.push(); }
    return els;
  };
  C.pasteInternal = function () {
    if (!C.clipboard) return;
    try { C.pasteElements(JSON.parse(C.clipboard).html); } catch (e) {}
  };
  function onPaste(e) {
    if (KH.text.editing || inInput(e.target)) return;
    if (KH.ui && KH.ui.modalOpen()) return;
    var cd = e.clipboardData; if (!cd) return;
    var data = '';
    try { data = cd.getData('application/x-keyhtml'); } catch (err) {}
    if (data) { e.preventDefault(); try { C.pasteElements(JSON.parse(data).html); } catch (err) {} return; }
    var files = Array.prototype.slice.call(cd.files || []);
    if (files.length) { e.preventDefault(); KH.io.insertFiles(files); return; }
    var text = cd.getData('text/plain');
    if (C.clipboard && (!text || text === C.clipboardText)) { e.preventDefault(); C.pasteInternal(); return; }
    if (text && text.trim()) {
      e.preventDefault();
      var html = KH.escapeHtml(text.trim()).split(/\r?\n/).join('<br>');
      var el = M.create.text({ html: html, x: 460, y: 440, w: 1000, fontSize: 40 });
      C.insert(el);
    }
  }
  function onDrop(e) {
    e.preventDefault(); wrap.classList.remove('dragging');
    var files = Array.prototype.slice.call(e.dataTransfer.files || []);
    if (files.length) { KH.io.insertFiles(files, C.toSlide(e)); return; }
    var uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (uri && /^https?:\/\//.test(uri) && /\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(uri)) {
      var p = C.toSlide(e);
      var img = new Image();
      img.onload = function () { var s = C.fitSize(img.naturalWidth, img.naturalHeight); var el = M.create.image({ src: uri, x: 0, y: 0, w: s.w, h: s.h }); C.centerAt(el, s.w, s.h, p); C.insert(el); };
      img.src = uri;
    }
  }

  // ------------------------------------------------------------------ menus
  C.elementMenu = function () {
    var el = C.single(), t = el ? M.type(el) : null, items = [];
    if (el && (t === 'text' || t === 'shape' || t === 'html')) items.push({ label: 'Edit Text', action: function () { KH.text.enter(el); } });
    if (el && t === 'math') items.push({ label: 'Edit Equation…', action: function () { KH.ui.editEquation(el); } });
    if (el && t === 'code') items.push({ label: 'Edit Code…', action: function () { KH.ui.editCode(el); } });
    if (el && t === 'html') items.push({ label: 'Edit HTML Source…', action: function () { KH.ui.editHtml(el); } });
    if (el && t === 'image') {
      items.push({ label: 'Crop Image', action: function () { C.enterCrop(el); } });
      if (M.isCropped(el)) items.push({ label: 'Reset Crop', action: function () { C.resetCrop(el); } });
      items.push({ label: 'Replace Image…', action: function () { KH.io.replaceMedia(el); } });
    }
    if (el && t === 'video') items.push({ label: 'Preview Movie', action: function () { KH.ui.toggleVideoPreview(el); } });
    if (items.length) items.push({ sep: true });
    items.push({ label: 'Cut', shortcut: '⌘X', action: function () { C.copySelection(); C.deleteSelection(); } });
    items.push({ label: 'Copy', shortcut: '⌘C', action: function () { C.copySelection(); } });
    items.push({ label: 'Paste', shortcut: '⌘V', disabled: !C.clipboard, action: C.pasteInternal });
    items.push({ label: 'Duplicate', shortcut: '⌘D', action: C.duplicateSelection });
    items.push({ label: 'Delete', shortcut: '⌫', action: C.deleteSelection });
    items.push({ sep: true });
    items.push({ label: 'Group', shortcut: '⌘G', disabled: !C.canGroup(), action: C.group });
    items.push({ label: 'Ungroup', shortcut: '⇧⌘G', disabled: !C.hasGroup(), action: C.ungroup });
    items.push({ sep: true });
    items.push({ label: 'Center on Slide Horizontally', action: function () { C.centerOnSlide('h'); } });
    items.push({ label: 'Center on Slide Vertically', action: function () { C.centerOnSlide('v'); } });
    items.push({ sep: true });
    items.push({ label: 'Distribute Horizontally', disabled: C.sel.length < 3, action: function () { C.distribute('h'); } });
    items.push({ label: 'Distribute Vertically', disabled: C.sel.length < 3, action: function () { C.distribute('v'); } });
    items.push({ sep: true });
    items.push({ label: 'Bring to Front', shortcut: '⇧⌘]', action: function () { C.reorder('front'); } });
    items.push({ label: 'Bring Forward', shortcut: '⌘]', action: function () { C.reorder('forward'); } });
    items.push({ label: 'Send Backward', shortcut: '⌘[', action: function () { C.reorder('backward'); } });
    items.push({ label: 'Send to Back', shortcut: '⇧⌘[', action: function () { C.reorder('back'); } });
    items.push({ sep: true });
    items.push({ label: (el && M.isLocked(el)) ? 'Unlock' : 'Lock', shortcut: '⌘L', action: C.toggleLock });
    return items;
  };
  C.slideMenu = function () {
    var i = M.cur, skipped = M.slide().hasAttribute('data-skip');
    return [
      { label: 'Paste', shortcut: '⌘V', disabled: !C.clipboard, action: C.pasteInternal },
      { sep: true },
      { label: 'New Slide', shortcut: '⇧⌘N', action: function () { KH.nav.addSlide(); } },
      { label: 'Duplicate Slide', action: function () { KH.nav.duplicate([i]); } },
      { label: 'Delete Slide', action: function () { KH.nav.remove([i]); } },
      { sep: true },
      { label: skipped ? 'Don’t Skip Slide' : 'Skip Slide', action: function () { KH.nav.toggleSkip([i]); } },
      { label: 'Select All', shortcut: '⌘A', action: C.selectAll },
    ];
  };

  // ------------------------------------------------------------------ keyboard
  function onKeyDown(e) {
    var t = e.target, k = e.key, mod = e.metaKey || e.ctrlKey;
    if (KH.ui && KH.ui.modalOpen()) { return; }
    if (KH.io && KH.io.showing && KH.io.showing()) { return; } // slideshow overlay is up
    // ⌥⌘0: reset text color to the deck default (selected text while editing, else selected boxes)
    if (mod && e.altKey && e.code === 'Digit0' && (KH.text.editing || C.sel.length)) { e.preventDefault(); KH.text.resetColor(); return; }
    if (KH.text.editing) {
      if (k === 'Escape') { KH.text.exit(); e.preventDefault(); }
      else if (k === 'Enter' && mod) { KH.text.exit(); e.preventDefault(); }
      else if (k === 'Tab') { document.execCommand(e.shiftKey ? 'outdent' : 'indent'); e.preventDefault(); }
      else if (mod && k.toLowerCase() === 's') { e.preventDefault(); KH.text.exit(); KH.io.save(); }
      else if (mod && k.toLowerCase() === 'k') { e.preventDefault(); KH.text.link(); }
      return;
    }
    if (inInput(t)) {
      if (k === 'Escape') t.blur();
      else if (mod && k.toLowerCase() === 's') { e.preventDefault(); t.blur(); KH.io.save(); }
      return;
    }
    var lk = k.toLowerCase();
    if (mod) {
      if (lk === 's') { e.preventDefault(); if (C.crop) C.exitCrop(); KH.io.save(); return; }
      if (lk === 'z') { e.preventDefault(); if (C.crop) C.exitCrop(true); if (e.shiftKey) M.history.redo(); else M.history.undo(); return; }
      if (lk === 'y') { e.preventDefault(); M.history.redo(); return; }
      if (lk === 'a') { e.preventDefault(); C.selectAll(); return; }
      if (lk === 'd') { e.preventDefault(); if (C.sel.length) C.duplicateSelection(); else KH.nav.duplicate([M.cur]); return; }
      if (lk === 'l' && C.sel.length) { e.preventDefault(); C.toggleLock(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); C.zoomStep(1); return; }
      if (k === '-' || k === '_') { e.preventDefault(); C.zoomStep(-1); return; }
      if (k === '0') { e.preventDefault(); C.fit(); return; }
      if (k === ']' || k === '}') { e.preventDefault(); C.reorder(e.shiftKey ? 'front' : 'forward'); return; }
      if (k === '[' || k === '{') { e.preventDefault(); C.reorder(e.shiftKey ? 'back' : 'backward'); return; }
      if (e.shiftKey && lk === 'n') { e.preventDefault(); KH.nav.addSlide(); return; }
      if (e.altKey && lk === 'p') { e.preventDefault(); KH.io.play(); return; }
      if (lk === 'b' && C.sel.length) { e.preventDefault(); KH.text.exec('bold'); return; }
      if (lk === 'i' && C.sel.length) { e.preventDefault(); KH.text.exec('italic'); return; }
      if (lk === 'u' && C.sel.length) { e.preventDefault(); KH.text.exec('underline'); return; }
      if (lk === 'e' && C.sel.length) { e.preventDefault(); C.align('centerh'); C.align('centerv'); return; }
      if (lk === 'g') { e.preventDefault(); if (e.shiftKey) C.ungroup(); else C.group(); return; }
      if (lk === 'k' && C.single() && M.type(C.single()) === 'image') { e.preventDefault(); if (C.crop) C.exitCrop(); else C.enterCrop(C.single()); return; }
      if (lk === 'k' && C.single() && KH.text.canEdit(C.single())) { e.preventDefault(); KH.text.link(); return; }
      return;
    }
    var step = e.shiftKey ? 10 : 1;
    if (C.crop) {
      if (k === 'Escape' || k === 'Enter') { e.preventDefault(); C.exitCrop(); return; }
      if (k === 'ArrowLeft') { e.preventDefault(); C.nudge(-step, 0); return; }
      if (k === 'ArrowRight') { e.preventDefault(); C.nudge(step, 0); return; }
      if (k === 'ArrowUp') { e.preventDefault(); C.nudge(0, -step); return; }
      if (k === 'ArrowDown') { e.preventDefault(); C.nudge(0, step); return; }
    }
    switch (k) {
      case 'Delete': case 'Backspace':
        if (C.sel.length) { e.preventDefault(); C.deleteSelection(); } break;
      case 'ArrowLeft': if (C.sel.length) { e.preventDefault(); C.nudge(-step, 0); } break;
      case 'ArrowRight': if (C.sel.length) { e.preventDefault(); C.nudge(step, 0); } break;
      case 'ArrowUp': if (C.sel.length) { e.preventDefault(); C.nudge(0, -step); } else { e.preventDefault(); KH.nav.goto(M.cur - 1); } break;
      case 'ArrowDown': if (C.sel.length) { e.preventDefault(); C.nudge(0, step); } else { e.preventDefault(); KH.nav.goto(M.cur + 1); } break;
      case 'PageUp': e.preventDefault(); KH.nav.goto(M.cur - 1); break;
      case 'PageDown': e.preventDefault(); KH.nav.goto(M.cur + 1); break;
      case 'Home': if (!C.sel.length) { e.preventDefault(); KH.nav.goto(0); } break;
      case 'End': if (!C.sel.length) { e.preventDefault(); KH.nav.goto(M.slides().length - 1); } break;
      case 'Escape':
        if (KH.ui && KH.ui.closePopovers()) break;
        if (C.sel.length && M.isNested(C.sel[0])) { C.select([C.sel[0].parentNode]); break; } // step out to the group
        C.clearSelection(); break;
      case 'Enter': {
        var el = C.single();
        if (el && KH.text.canEdit(el)) { e.preventDefault(); KH.text.enter(el); }
        else if (el && M.type(el) === 'math') { e.preventDefault(); KH.ui.editEquation(el); }
        else if (el && M.type(el) === 'code') { e.preventDefault(); KH.ui.editCode(el); }
        else if (el && M.type(el) === 'image') { e.preventDefault(); C.enterCrop(el); }
        break;
      }
      case 't': case 'T': if (!C.sel.length) { e.preventDefault(); KH.toolbar.insertText(); } break;
      default: break;
    }
  }
  return C;
})();
