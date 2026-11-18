/* keyhtml editor — document model. The deck is a live DOM tree (div.kh-deck) that is
   also exactly what gets written to disk, so the model is mostly thin helpers over it. */
KH.model = (function () {
  var M = {
    deck: null, file: null, dir: '', mtime: 0, title: 'Untitled', macros: '', customCss: '', customJs: '', scripts: [],
    cur: 0, W: 1920, H: 1080, exists: false,
  };
  var h = KH.h;

  // ---------------------------------------------------------------- custom CSS scoping
  /* Prefix every selector with .kh-deck so deck CSS can never restyle the editor. :root rules
     (custom properties) stay global; html/body rules are mapped onto the slides. */
  M.scopeCss = function (css) {
    if (!css || !css.trim()) return '';
    var sheet;
    try { sheet = new CSSStyleSheet(); sheet.replaceSync(css); } catch (e) { return css; }
    function scopeSel(sel) {
      return sel.split(',').map(function (s) {
        s = s.trim(); if (!s) return '';
        if (/^\.kh-deck(\b|$)/.test(s) || /^:root(\b|$)/.test(s)) return s;
        if (/^(html|body)$/.test(s)) return '.kh-deck .kh-slide';
        if (/^html\s+body\b/.test(s)) return s.replace(/^html\s+body\b/, '.kh-deck .kh-slide');
        if (/^(html|body)\b/.test(s)) return s.replace(/^(html|body)\b/, '.kh-deck .kh-slide');
        if (s === '*') return '.kh-deck *';
        return '.kh-deck ' + s;
      }).filter(Boolean).join(', ');
    }
    function walk(rules) {
      var out = [];
      Array.prototype.forEach.call(rules, function (r) {
        if (r.type === 1) out.push(scopeSel(r.selectorText) + ' { ' + r.style.cssText + ' }');
        else if (r.type === 4) out.push('@media ' + r.conditionText + ' {\n' + walk(r.cssRules) + '\n}');
        else if (r.type === 12) out.push('@supports ' + r.conditionText + ' {\n' + walk(r.cssRules) + '\n}');
        else if (r.type === 6) { /* @page: dropped */ }
        else out.push(r.cssText);
      });
      return out.join('\n');
    }
    return walk(sheet.cssRules);
  };
  /* vh/vw -> px for a 1920x1080 slide (hand-written decks often size everything in vh). */
  M.convertViewportUnits = function (s) {
    return (s || '').replace(/(-?\d*\.?\d+)\s*(vh|vw|vmin|vmax)\b/g, function (m, n, u) {
      var f = (u === 'vh' || u === 'vmin') ? 10.8 : 19.2;
      return KH.round(parseFloat(n) * f, 2) + 'px';
    });
  };

  // ---------------------------------------------------------------- queries
  M.slides = function () { return M.deck ? KH.$$(':scope > .kh-slide', M.deck) : []; };
  M.slide = function () { return M.slides()[M.cur] || null; };
  M.elements = function (slide) { slide = slide || M.slide(); return slide ? KH.$$(':scope > .kh-el', slide) : []; };
  M.slideIndex = function (slide) { return M.slides().indexOf(slide); };
  M.elIndex = function (el) { return M.elements(el.parentNode).indexOf(el); };
  M.notesEl = function (slide) {
    slide = slide || M.slide();
    var n = KH.$(':scope > .kh-notes', slide);
    if (!n) { n = h('aside', { class: 'kh-notes' }); slide.appendChild(n); }
    return n;
  };
  M.type = function (el) {
    var c = el.classList;
    if (c.contains('kh-group')) return 'group';
    if (c.contains('kh-text')) return 'text';
    if (c.contains('kh-image')) return 'image';
    if (c.contains('kh-video')) return 'video';
    if (c.contains('kh-shape-line')) return 'line';
    if (c.contains('kh-shape')) return 'shape';
    if (c.contains('kh-math')) return 'math';
    if (c.contains('kh-code')) return 'code';
    if (c.contains('kh-html')) return 'html';
    return 'other';
  };
  M.isAspectLocked = function (el) {
    var t = M.type(el);
    if (el.dataset.lockAspect === '0') return false;
    return t === 'image' || t === 'video' || t === 'math' || t === 'code' || t === 'group' || el.dataset.lockAspect === '1';
  };
  M.isLocked = function (el) { return el.hasAttribute('data-locked'); };
  M.geom = function (el) {
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, r: KH.getRotation(el) };
  };
  M.setGeom = function (el, g) {
    if (g.x != null) el.style.left = KH.round(g.x, 1) + 'px';
    if (g.y != null) el.style.top = KH.round(g.y, 1) + 'px';
    if (g.w != null) el.style.width = KH.round(g.w, 1) + 'px';
    if (g.h != null) el.style.height = g.h === 'auto' ? 'auto' : KH.round(g.h, 1) + 'px';
    if (g.r != null) el.style.transform = Math.abs(g.r) > 0.01 ? 'rotate(' + KH.round(g.r, 2) + 'deg)' : '';
    el.style.right = ''; el.style.bottom = '';
  };
  M.isAutoHeight = function (el) { return M.type(el) === 'text' && (!el.style.height || el.style.height === 'auto'); };
  M.bbox = function (els) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    els.forEach(function (el) {
      var g = M.geom(el);
      x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y); x1 = Math.max(x1, g.x + g.w); y1 = Math.max(y1, g.y + g.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  // ---------------------------------------------------------------- groups & nested geometry
  /* A group is a div.kh-el.kh-group whose children are .kh-el with geometry relative to the group
     box. Groups nest. M.geom is always relative to the parent; M.absGeom composes the ancestors'
     rotations to give slide coordinates. */
  M.parentGroup = function (el) { var p = el.parentNode; return p && p.classList && p.classList.contains('kh-group') ? p : null; };
  M.isNested = function (el) { return !!M.parentGroup(el); };
  M.ancestorRot = function (el) { var r = 0, p = M.parentGroup(el); while (p) { r += KH.getRotation(p); p = M.parentGroup(p); } return r; };
  M.absGeom = function (el) {
    var g = M.geom(el), p = M.parentGroup(el);
    if (!p) return g;
    var pg = M.absGeom(p), th = pg.r * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
    var lx = g.x + g.w / 2 - p.offsetWidth / 2, ly = g.y + g.h / 2 - p.offsetHeight / 2; // child center relative to the group center
    var cx = pg.x + pg.w / 2 + lx * cos - ly * sin, cy = pg.y + pg.h / 2 + lx * sin + ly * cos;
    return { x: cx - g.w / 2, y: cy - g.h / 2, w: g.w, h: g.h, r: pg.r + g.r };
  };
  /* axis-aligned box of a (possibly rotated) element, in its parent's coordinates */
  M.visualBox = function (el) {
    var g = M.geom(el);
    if (!g.r) return { x: g.x, y: g.y, w: g.w, h: g.h };
    var th = g.r * Math.PI / 180, cos = Math.abs(Math.cos(th)), sin = Math.abs(Math.sin(th));
    var w = g.w * cos + g.h * sin, hh = g.w * sin + g.h * cos;
    return { x: g.x + g.w / 2 - w / 2, y: g.y + g.h / 2 - hh / 2, w: w, h: hh };
  };
  function unionBoxes(boxes) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    boxes.forEach(function (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function normRot(r) { r = ((r % 360) + 360) % 360; if (r > 180) r -= 360; return KH.round(r, 2); }
  M.elPath = function (el) {
    var path = [];
    while (el && el.classList && el.classList.contains('kh-el')) { path.unshift(M.elements(el.parentNode).indexOf(el)); el = el.parentNode; }
    return path;
  };
  M.elAtPath = function (path) {
    var cont = M.slide(), el = null;
    for (var i = 0; i < path.length; i++) { el = M.elements(cont)[path[i]]; if (!el) return null; cont = el; }
    return el;
  };
  M.canGroup = function (els) {
    return els.length >= 2 && els.every(function (e) { return e.parentNode === els[0].parentNode && !M.isLocked(e); });
  };
  /* Group elements (same parent); z-order position of the frontmost element is kept. */
  M.group = function (els) {
    if (!M.canGroup(els)) return null;
    var parent = els[0].parentNode;
    var sorted = M.elements(parent).filter(function (e) { return els.indexOf(e) >= 0; });
    var box = unionBoxes(sorted.map(M.visualBox));
    var g = h('div', { class: 'kh-el kh-group' });
    M.setGeom(g, { x: box.x, y: box.y, w: box.w, h: box.h });
    parent.insertBefore(g, sorted[sorted.length - 1].nextSibling);
    sorted.forEach(function (e) { var eg = M.geom(e); M.setGeom(e, { x: eg.x - box.x, y: eg.y - box.y }); g.appendChild(e); });
    return g;
  };
  /* Dissolve a group: children get absolute geometry in the group's parent (rotation composed). */
  M.ungroup = function (group) {
    var gg = M.geom(group), th = gg.r * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
    var cx = gg.x + gg.w / 2, cy = gg.y + gg.h / 2, kids = M.elements(group);
    kids.forEach(function (k) {
      var g = M.geom(k), lx = g.x + g.w / 2 - gg.w / 2, ly = g.y + g.h / 2 - gg.h / 2;
      var ncx = cx + lx * cos - ly * sin, ncy = cy + lx * sin + ly * cos;
      M.setGeom(k, { x: ncx - g.w / 2, y: ncy - g.h / 2, r: normRot(g.r + gg.r) });
      if (group.style.opacity && !k.style.opacity) k.style.opacity = group.style.opacity;
      group.parentNode.insertBefore(k, group);
    });
    group.remove();
    return kids;
  };
  /* Re-fit a group box to its children (after a child moved, resized or was deleted), keeping
     the children where they are on the slide. */
  M.fitGroup = function (group) {
    var kids = M.elements(group);
    if (!kids.length) { var p = M.parentGroup(group); group.remove(); if (p) M.fitGroup(p); return; }
    var gg = M.geom(group), box = unionBoxes(kids.map(M.visualBox));
    if (Math.abs(box.x) < 0.05 && Math.abs(box.y) < 0.05 && Math.abs(box.w - gg.w) < 0.05 && Math.abs(box.h - gg.h) < 0.05) return;
    var th = gg.r * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
    var ox = box.x + box.w / 2 - gg.w / 2, oy = box.y + box.h / 2 - gg.h / 2; // new center relative to old, in group frame
    var ncx = gg.x + gg.w / 2 + ox * cos - oy * sin, ncy = gg.y + gg.h / 2 + ox * sin + oy * cos;
    M.setGeom(group, { x: ncx - box.w / 2, y: ncy - box.h / 2, w: box.w, h: box.h });
    kids.forEach(function (k) { var g = M.geom(k); M.setGeom(k, { x: g.x - box.x, y: g.y - box.y }); });
  };
  M.fitAncestors = function (el) { var p = M.parentGroup(el); while (p) { var next = M.parentGroup(p); M.fitGroup(p); p = next; } };
  /* Snapshot of a group's children so a resize can scale them from the drag's starting state
     (avoids accumulating rounding over many mouse moves). */
  M.groupSnapshot = function (group) {
    return { w: group.offsetWidth, h: group.offsetHeight, kids: M.elements(group).map(function (k) {
      var t = M.type(k);
      return { el: k, g: M.geom(k), auto: M.isAutoHeight(k), type: t,
               fs: (t === 'text' || t === 'shape' || t === 'html') ? (parseFloat(k.style.fontSize) || parseFloat(getComputedStyle(k).fontSize)) : null,
               spans: KH.$$('[style*="font-size"]', k).map(function (s) { return { el: s, fs: parseFloat(s.style.fontSize) }; }).filter(function (s) { return s.fs > 0 && /px$/.test(s.el.style.fontSize); }),
               snap: t === 'group' ? M.groupSnapshot(k) : null };
    }) };
  };
  M.scaleGroupTo = function (group, snap, w, hh) {
    var sx = w / snap.w, sy = hh / snap.h, uniform = Math.abs(sx - sy) < 0.002, fsc = Math.sqrt(sx * sy);
    snap.kids.forEach(function (k) {
      var g = { x: k.g.x * sx, y: k.g.y * sy, w: k.g.w * sx, h: k.auto ? 'auto' : k.g.h * sy };
      M.setGeom(k.el, g);
      if (uniform && k.fs) {
        k.el.style.fontSize = KH.round(k.fs * fsc, 1) + 'px';
        k.spans.forEach(function (s) { s.el.style.fontSize = KH.round(s.fs * fsc, 1) + 'px'; });
      }
      if (k.type === 'line') KH.shapes.renderLine(k.el);
      else if (k.type === 'math') KH.math.syncSizeFromBox(k.el);
      else if (k.type === 'code') KH.code.syncSizeFromBox(k.el);
      else if (k.type === 'group') M.scaleGroupTo(k.el, k.snap, g.w, g.h);
    });
  };
  /* Resize any element to w×h (groups scale their children, cropped images keep their crop). */
  M.resizeTo = function (el, w, hh) {
    var snap = M.type(el) === 'group' ? M.groupSnapshot(el) : null;
    M.setGeom(el, { w: w, h: hh });
    if (snap) M.scaleGroupTo(el, snap, w, hh);
  };
  /* Groups left with fewer than two children are dissolved. */
  M.pruneGroups = function (groups) {
    groups.forEach(function (g) {
      if (!g.isConnected) return;
      var kids = M.elements(g);
      if (kids.length === 0) { var p = M.parentGroup(g); g.remove(); if (p) M.pruneGroups([p]); }
      else if (kids.length === 1) { var pp = M.parentGroup(g); M.ungroup(g); if (pp) M.fitGroup(pp); }
      else M.fitAncestors(kids[0]); // refits g and everything above it
    });
  };

  // ---------------------------------------------------------------- image crop
  /* A cropped image is a box with overflow hidden whose <img> is positioned in percent of the
     box, so resizing the box scales the crop with it: <img style="left:-20%;top:0;width:150%;height:150%">. */
  M.isCropped = function (el) { return el.classList.contains('kh-cropped'); };
  M.cropGet = function (el) {
    var img = el.querySelector('img'), bw = el.clientWidth, bh = el.clientHeight;
    if (!img || !M.isCropped(el)) return { x: 0, y: 0, w: bw, h: bh };
    var pc = function (v, ref) { return /%$/.test(v) ? parseFloat(v) / 100 * ref : KH.px(v); };
    return { x: pc(img.style.left || '0', bw), y: pc(img.style.top || '0', bh), w: pc(img.style.width || '100%', bw), h: pc(img.style.height || '100%', bh) };
  };
  M.cropSet = function (el, r) {
    var img = el.querySelector('img'); if (!img) return;
    var bw = el.clientWidth || 1, bh = el.clientHeight || 1;
    var p = function (v, ref) { return KH.round(v / ref * 100, 4) + '%'; };
    el.classList.add('kh-cropped'); el.classList.remove('kh-fit-contain', 'kh-fit-cover');
    img.style.left = p(r.x, bw); img.style.top = p(r.y, bh); img.style.width = p(r.w, bw); img.style.height = p(r.h, bh);
  };
  M.cropReset = function (el) {
    var img = el.querySelector('img');
    el.classList.remove('kh-cropped');
    if (img) { img.style.left = ''; img.style.top = ''; img.style.width = ''; img.style.height = ''; }
  };
  /* drop a crop that is exactly the box */
  M.cropNormalize = function (el) {
    if (!M.isCropped(el)) return;
    var r = M.cropGet(el);
    if (Math.abs(r.x) < 0.5 && Math.abs(r.y) < 0.5 && Math.abs(r.w - el.clientWidth) < 0.5 && Math.abs(r.h - el.clientHeight) < 0.5) M.cropReset(el);
  };

  // ---------------------------------------------------------------- creation
  function baseEl(cls, g) {
    var el = h('div', { class: 'kh-el ' + cls });
    M.setGeom(el, g);
    return el;
  }
  M.create = {
    text: function (o) {
      o = o || {};
      var el = baseEl('kh-text' + (o.heading ? ' kh-heading' : ''), { x: o.x != null ? o.x : 560, y: o.y != null ? o.y : 480, w: o.w || 800, h: o.h || 'auto' });
      if (o.fontSize) el.style.fontSize = o.fontSize + 'px';
      if (o.align) el.style.textAlign = o.align;
      if (o.color) el.style.color = o.color;
      if (o.valign && o.valign !== 'top') el.classList.add('kh-valign-' + o.valign);
      if (o.placeholder) el.setAttribute('data-placeholder', '1');
      var body = h('div', { class: 'kh-body' });
      body.innerHTML = o.html || '';
      el.appendChild(body);
      return el;
    },
    image: function (o) {
      var el = baseEl('kh-image', { x: o.x, y: o.y, w: o.w, h: o.h });
      var img = h('img', { src: o.src, alt: o.alt || '' });
      if (o.pdf) { img.setAttribute('data-pdf', o.pdf); img.setAttribute('data-page', String(o.page || 1)); if (o.pages) img.setAttribute('data-pages', String(o.pages)); }
      el.appendChild(img);
      return el;
    },
    video: function (o) {
      var el = baseEl('kh-video', { x: o.x, y: o.y, w: o.w, h: o.h });
      var v = h(o.kind === 'audio' ? 'audio' : 'video', { src: o.src, controls: true, preload: 'metadata', playsinline: true });
      if (o.autoplay) v.setAttribute('data-autoplay', '1');
      if (o.loop) v.setAttribute('loop', '');
      if (o.muted) v.setAttribute('muted', '');
      el.appendChild(v);
      return el;
    },
    shape: function (o) {
      o = o || {};
      var type = o.type || 'rect';
      var el = baseEl('kh-shape kh-shape-' + type, { x: o.x != null ? o.x : 760, y: o.y != null ? o.y : 340, w: o.w || 400, h: o.h || 400 });
      el.style.background = o.fill || '#4a90d9';
      if (o.strokeWidth) el.style.border = o.strokeWidth + 'px solid ' + (o.stroke || '#2d6fb5');
      if (o.radius) el.style.borderRadius = o.radius + 'px';
      if (o.color) el.style.color = o.color;
      var body = h('div', { class: 'kh-body' });
      body.innerHTML = o.html || '';
      el.appendChild(body);
      return el;
    },
    line: function (o) {
      o = o || {};
      var el = baseEl('kh-shape kh-shape-line', { x: o.x != null ? o.x : 660, y: o.y != null ? o.y : 520, w: o.w || 600, h: o.h || 40 });
      el.setAttribute('data-stroke', o.stroke || '#1d1d1f');
      el.setAttribute('data-stroke-width', String(o.strokeWidth || 6));
      el.setAttribute('data-arrow', o.arrow || 'none');
      if (o.dash) el.setAttribute('data-dash', o.dash);
      KH.shapes.renderLine(el);
      return el;
    },
    math: function (o) {
      var el = baseEl('kh-math', { x: o.x != null ? o.x : 660, y: o.y != null ? o.y : 480, w: 100, h: 100 });
      el.setAttribute('data-tex', o.tex || '');
      el.setAttribute('data-fs', String(o.fs || 60));
      if (o.color) el.style.color = o.color;
      KH.math.renderElement(el);
      return el;
    },
    code: function (o) {
      o = o || {};
      var el = baseEl('kh-code' + (o.theme === 'light' ? ' kh-code-light' : ''), { x: o.x != null ? o.x : 460, y: o.y != null ? o.y : 340, w: 100, h: 100 });
      el.setAttribute('data-lang', o.lang || 'auto');
      el.style.fontSize = (o.fs || KH.code.DEFAULT_FS) + 'px';
      KH.code.render(el, o.code || '');
      return el;
    },
    html: function (o) {
      var el = baseEl('kh-html', { x: o.x != null ? o.x : 460, y: o.y != null ? o.y : 240, w: o.w || 1000, h: o.h || 600 });
      el.innerHTML = o.html || '';
      return el;
    },
  };
  M.add = function (el, slide) {
    slide = slide || M.slide();
    var notes = KH.$(':scope > .kh-notes', slide);
    if (notes) slide.insertBefore(el, notes); else slide.appendChild(el);
    return el;
  };
  M.remove = function (els) {
    var parents = [];
    els.forEach(function (el) { var p = M.parentGroup(el); if (p && parents.indexOf(p) < 0) parents.push(p); el.remove(); });
    M.pruneGroups(parents);
  };
  M.duplicate = function (els, dx, dy) {
    if (dx == null) dx = 24; if (dy == null) dy = 24;
    var clones = [];
    els.forEach(function (el) {
      var c = el.cloneNode(true);
      c.classList.remove('kh-editing');
      KH.$$('[contenteditable]', c).forEach(function (b) { b.removeAttribute('contenteditable'); });
      var g = M.geom(el);
      M.setGeom(c, { x: g.x + dx, y: g.y + dy });
      el.parentNode.insertBefore(c, el.nextSibling);
      clones.push(c);
    });
    return clones;
  };
  M.reorder = function (els, how) {
    var slide = els[0].parentNode;
    var all = M.elements(slide);
    var notes = KH.$(':scope > .kh-notes', slide);
    var set = new Set(els);
    var sorted = all.filter(function (e) { return set.has(e); });
    if (how === 'front') sorted.forEach(function (e) { slide.insertBefore(e, notes); });
    else if (how === 'back') sorted.reverse().forEach(function (e) { slide.insertBefore(e, slide.firstChild); });
    else if (how === 'forward') {
      sorted.reverse().forEach(function (e) {
        var n = e.nextElementSibling; while (n && set.has(n)) n = n.nextElementSibling;
        if (n && n.classList.contains('kh-el')) slide.insertBefore(n, e);
      });
    } else if (how === 'backward') {
      sorted.forEach(function (e) {
        var p = e.previousElementSibling; while (p && set.has(p)) p = p.previousElementSibling;
        if (p && p.classList.contains('kh-el')) slide.insertBefore(e, p);
      });
    }
  };
  M.align = function (els, how) {
    if (!els.length) return;
    var pg = M.parentGroup(els[0]);
    var ref = els.length > 1 ? M.bbox(els) : pg ? { x: 0, y: 0, w: pg.offsetWidth, h: pg.offsetHeight } : { x: 0, y: 0, w: M.W, h: M.H };
    els.forEach(function (el) {
      var g = M.geom(el);
      switch (how) {
        case 'left': M.setGeom(el, { x: ref.x }); break;
        case 'centerh': M.setGeom(el, { x: ref.x + (ref.w - g.w) / 2 }); break;
        case 'right': M.setGeom(el, { x: ref.x + ref.w - g.w }); break;
        case 'top': M.setGeom(el, { y: ref.y }); break;
        case 'centerv': M.setGeom(el, { y: ref.y + (ref.h - g.h) / 2 }); break;
        case 'bottom': M.setGeom(el, { y: ref.y + ref.h - g.h }); break;
      }
    });
  };
  // Center the selection on the slide (or on its group, for elements inside one) along one axis,
  // moving a multi-selection as a block so the spacing between the elements is kept.
  M.centerOnSlide = function (els, axis) {
    var byParent = new Map();
    els.forEach(function (el) { var p = M.parentGroup(el); if (!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(el); });
    byParent.forEach(function (list, pg) {
      var box = M.bbox(list), W = pg ? pg.offsetWidth : M.W, H = pg ? pg.offsetHeight : M.H;
      var dx = axis === 'h' ? (W - box.w) / 2 - box.x : 0, dy = axis === 'v' ? (H - box.h) / 2 - box.y : 0;
      list.forEach(function (el) { var g = M.geom(el); M.setGeom(el, axis === 'h' ? { x: g.x + dx } : { y: g.y + dy }); });
    });
  };
  /* Space three or more elements evenly along one axis, as Keynote's Distribute Horizontally /
     Vertically: the selection's outer edges stay where they are and the gaps between neighbours
     (in order of their centers) are made equal, accounting for each element's size. */
  M.distribute = function (els, axis) {
    if (els.length < 3) return;
    var key = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h';
    var items = els.map(function (el) { return { el: el, g: M.geom(el) }; })
      .sort(function (a, b) { return (a.g[key] + a.g[size] / 2) - (b.g[key] + b.g[size] / 2); });
    var box = M.bbox(els);
    var total = items.reduce(function (s, it) { return s + it.g[size]; }, 0);
    var gap = (box[size] - total) / (items.length - 1);
    var pos = box[key];
    items.forEach(function (it) { var g = {}; g[key] = pos; M.setGeom(it.el, g); pos += it.g[size] + gap; });
  };

  // ---------------------------------------------------------------- slide ids
  /* Every slide carries a stable data-kh-id. It survives reordering and edits (a duplicate gets a
     new one), so changes made to the file outside the editor can be merged slide by slide. */
  M.newSlideId = function (taken) {
    var id;
    do { id = 's' + Math.random().toString(36).slice(2, 10); }
    while ((taken && taken.has(id)) || (M.deck && M.deck.querySelector(':scope > .kh-slide[data-kh-id="' + id + '"]')));
    if (taken) taken.add(id);
    return id;
  };
  /* Give slides without an id (or with a duplicated one) a fresh id. Returns true if any changed. */
  M.ensureSlideIds = function (deck) {
    var seen = new Set(), changed = false;
    KH.$$(':scope > .kh-slide', deck).forEach(function (s) { var id = s.getAttribute('data-kh-id'); if (id) seen.add(id); });
    var used = new Set();
    KH.$$(':scope > .kh-slide', deck).forEach(function (s) {
      var id = s.getAttribute('data-kh-id');
      if (!id || used.has(id)) { id = M.newSlideId(seen); s.setAttribute('data-kh-id', id); changed = true; }
      used.add(id);
    });
    return changed;
  };
  M.slideId = function (slide) { return slide ? slide.getAttribute('data-kh-id') : null; };

  // ---------------------------------------------------------------- slides
  M.newSlide = function (layout) {
    var s = h('section', { class: 'kh-slide', 'data-kh-id': M.newSlideId() });
    (KH.layouts.build(layout || 'blank', s) || []).forEach(function (el) { s.appendChild(el); });
    s.appendChild(h('aside', { class: 'kh-notes' }));
    return s;
  };
  M.addSlide = function (layout, at) {
    var slides = M.slides();
    if (at == null) at = M.cur + 1;
    var s = M.newSlide(layout);
    if (at >= slides.length) M.deck.appendChild(s); else M.deck.insertBefore(s, slides[at]);
    M.setCurrent(at);
    return s;
  };
  M.duplicateSlide = function (i) {
    var s = M.slides()[i];
    var c = s.cloneNode(true);
    c.classList.remove('kh-current');
    c.setAttribute('data-kh-id', M.newSlideId());
    c.removeAttribute('data-kh-conflict');
    KH.$$('[contenteditable]', c).forEach(function (b) { b.removeAttribute('contenteditable'); });
    s.parentNode.insertBefore(c, s.nextSibling);
    M.setCurrent(i + 1);
    return c;
  };
  M.deleteSlides = function (indices) {
    var slides = M.slides();
    if (indices.length >= slides.length) { // keep at least one
      indices = indices.slice(0, slides.length - 1);
      if (!indices.length) return;
    }
    indices.forEach(function (i) { slides[i].remove(); });
    M.setCurrent(Math.min(Math.min.apply(null, indices), M.slides().length - 1));
  };
  M.moveSlides = function (indices, to) {
    var slides = M.slides();
    var moving = indices.map(function (i) { return slides[i]; });
    var ref = slides[to] || null; // insert before this (null = end)
    if (ref && moving.indexOf(ref) >= 0) { // reference is being moved: find next non-moving
      var k = to; while (k < slides.length && moving.indexOf(slides[k]) >= 0) k++;
      ref = slides[k] || null;
    }
    moving.forEach(function (s) { M.deck.insertBefore(s, ref); });
    M.setCurrent(M.slideIndex(moving[0]));
  };
  M.setCurrent = function (i) {
    var slides = M.slides();
    i = KH.clamp(i, 0, slides.length - 1);
    slides.forEach(function (s, k) { s.classList.toggle('kh-current', k === i); });
    var changed = (i !== M.cur);
    M.cur = i;
    KH.emit('slide', i);
    return changed;
  };
  M.notes = function (slide, value) {
    var n = M.notesEl(slide);
    if (value === undefined) return n.textContent;
    n.textContent = value;
  };
  /* Notes as light HTML (<b>, <i>, <span style="font-size:…em">); line breaks are plain newlines. */
  M.notesHtml = function (slide, html) {
    var n = M.notesEl(slide);
    if (html === undefined) return n.innerHTML;
    n.innerHTML = html;
  };

  // ---------------------------------------------------------------- theme & settings
  var THEME_KEYS = ['--kh-bg', '--kh-color', '--kh-accent', '--kh-muted', '--kh-font', '--kh-heading-font'];
  M.theme = function (key, value) {
    if (value === undefined) return M.deck.style.getPropertyValue(key).trim();
    M.deck.style.setProperty(key, value);
  };
  M.setting = function (key, value) {
    if (value === undefined) return M.deck.getAttribute('data-' + key);
    if (value === null || value === '' || value === false) M.deck.removeAttribute('data-' + key);
    else M.deck.setAttribute('data-' + key, value === true ? '1' : String(value));
  };
  M.setSize = function (w, h) {
    M.W = w; M.H = h;
    M.deck.setAttribute('data-width', String(w)); M.deck.setAttribute('data-height', String(h));
    M.deck.style.width = w + 'px'; M.deck.style.height = h + 'px';
  };

  // ---------------------------------------------------------------- history
  var hist = { stack: [], index: -1, max: 200 };
  M.history = hist;
  function snapshot() {
    return { html: M.deck.innerHTML, cur: M.cur, sel: KH.canvas ? KH.canvas.selIndices() : [] };
  }
  hist.reset = function () { hist.stack = [snapshot()]; hist.index = 0; };
  hist.push = function (opts) {
    opts = opts || {};
    var s = snapshot();
    hist.stack = hist.stack.slice(0, hist.index + 1);
    if (hist.stack.length && hist.stack[hist.stack.length - 1].html === s.html && !opts.force) {
      hist.stack[hist.stack.length - 1] = s; // nothing changed; keep latest selection
      if (!opts.silent) KH.emit('change', { nochange: true });
      return;
    }
    hist.stack.push(s);
    if (hist.stack.length > hist.max) hist.stack.shift();
    hist.index = hist.stack.length - 1;
    if (!opts.silent) KH.emit('change', {});
  };
  hist.canUndo = function () { return hist.index > 0; };
  hist.canRedo = function () { return hist.index < hist.stack.length - 1; };
  function restore(s, sel) {
    if (KH.text && KH.text.editing) KH.text.exit(true);
    M.deck.innerHTML = s.html;
    M.setCurrent(s.cur);
    KH.canvas.clearSelection(true);
    KH.canvas.selectIndices(sel || s.sel);
    KH.emit('change', { restored: true });
  }
  // Undo keeps the selection of the state being undone (as Keynote does), redo uses the target's.
  hist.undo = function () { if (!hist.canUndo()) return; var from = hist.stack[hist.index]; hist.index--; restore(hist.stack[hist.index], from.cur === hist.stack[hist.index].cur ? from.sel : null); };
  hist.redo = function () { if (!hist.canRedo()) return; hist.index++; restore(hist.stack[hist.index]); };

  // ---------------------------------------------------------------- load / save
  function cleanDeckClone() {
    var deck = M.deck.cloneNode(true);
    deck.classList.remove('kh-back'); deck.removeAttribute('data-kh-trans');
    ['transform', 'left', 'top'].forEach(function (p) { deck.style[p] = ''; });
    KH.$$('#kh-num', deck).forEach(function (e) { e.remove(); });
    KH.$$('.kh-slide', deck).forEach(function (s) { s.classList.remove('kh-current', 'kh-leaving', 'kh-enter', 'kh-drop-target'); });
    KH.$$('.kh-el', deck).forEach(function (e) { e.classList.remove('kh-editing', 'kh-hidden', 'kh-build-in', 'kh-build-preview-hidden', 'kh-empty'); });
    KH.$$('[contenteditable]', deck).forEach(function (e) { e.removeAttribute('contenteditable'); });
    KH.$$('[style=""]', deck).forEach(function (e) { e.removeAttribute('style'); });
    KH.$$('[class=""]', deck).forEach(function (e) { e.removeAttribute('class'); });
    return deck;
  }
  function openTag(el) { return el.cloneNode(false).outerHTML.replace(/<\/[a-z0-9]+>$/i, ''); }
  function prettyDeck(deck) {
    var out = [openTag(deck)];
    Array.prototype.forEach.call(deck.childNodes, function (n) {
      if (n.nodeType !== 1) return;
      if (n.classList.contains('kh-slide')) {
        out.push('  ' + openTag(n));
        Array.prototype.forEach.call(n.childNodes, function (c) {
          if (c.nodeType === 1) out.push('    ' + c.outerHTML);
          else if (c.nodeType === 3 && c.nodeValue.trim()) out.push('    ' + KH.escapeHtml(c.nodeValue.trim()));
        });
        out.push('  </section>');
      } else out.push('  ' + n.outerHTML);
    });
    out.push('</div>');
    return out.join('\n');
  }
  M.buildHtml = function () {
    var deck = cleanDeckClone();
    var A = KH.assets || {};
    var esc = function (s) { return (s || '').replace(/<\/(script|style)/gi, '<\\/$1'); };
    var scoped = esc(M.scopeCss(M.customCss || ''));
    var ext = (M.scripts || []).map(function (src) { return '<script class="kh-ext" src="' + KH.escapeHtml(src) + '"></script>\n'; }).join('');
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta name="generator" content="keyhtml ' + KH.version + '">\n' +
      '<title>' + KH.escapeHtml(M.title) + '</title>\n' +
      '<style id="kh-deck-css">\n' + (A.deckCss || '') + '\n</style>\n' +
      '<style id="kh-player-css">\n' + (A.playerCss || '') + '\n</style>\n' +
      '<style id="kh-custom-css">\n' + scoped + '\n</style>\n' +
      '<script type="text/plain" id="kh-custom-css-src">' + esc(M.customCss || '') + '</script>\n' +
      '<script type="text/x-keyhtml-macros" id="kh-macros">' + esc(M.macros || '') + '</script>\n' +
      ext +
      '</head>\n<body>\n' + prettyDeck(deck) + '\n' +
      '<script id="kh-player-js">\n' + esc(A.playerJs || '') + '\n</script>\n' +
      (M.customJs && M.customJs.trim() ? '<script id="kh-custom-js">\n' + esc(M.customJs) + '\n</script>\n' : '') +
      '</body>\n</html>\n';
  };
  function unesc(s) { return (s || '').replace(/<\\\/(script|style)/gi, '</$1'); }

  /* Import a hand-written deck made of <section> slides: each section becomes a full-slide
     HTML block (editable in place), <aside> becomes presenter notes, the deck's CSS becomes
     scoped custom CSS, scripts are carried along as custom JS. */
  function importSections(doc, sections) {
    var deck = M.newDeck(doc.title || 'Imported');
    deck.innerHTML = '';
    var vu = M.convertViewportUnits;
    M.customCss = vu(KH.$$('style', doc).map(function (st) { return st.textContent; }).join('\n\n'));
    M.scripts = KH.$$('script[src]', doc).map(function (s) { return s.getAttribute('src'); });
    M.customJs = KH.$$('script:not([src])', doc).filter(function (s) { return !s.type || /javascript|ecmascript|module/i.test(s.type); })
      .map(function (s) { return s.textContent; }).join('\n\n');
    sections.forEach(function (sec) {
      var slide = h('section', { class: 'kh-slide' });
      var inner = document.importNode(sec, true);
      var asides = KH.$$('aside', inner);
      var notesText = asides.map(function (a) { return a.textContent; }).join('\n').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
      asides.forEach(function (a) { a.remove(); });
      inner.classList.add('on'); inner.classList.add('active');
      inner.setAttribute('data-kh-wrap', '1'); // the player keeps these classes in sync with the current slide
      KH.$$('[style]', inner).forEach(function (e) { e.setAttribute('style', vu(e.getAttribute('style'))); });
      if (inner.hasAttribute('style')) inner.setAttribute('style', vu(inner.getAttribute('style')));
      var block = M.create.html({ x: 0, y: 0, w: M.W, h: M.H, html: '' });
      block.appendChild(inner);
      slide.appendChild(block);
      var notes = h('aside', { class: 'kh-notes' }); notes.textContent = notesText;
      slide.appendChild(notes);
      deck.appendChild(slide);
    });
    // keep leftover body elements (hidden) so custom scripts that look them up still work
    var extras = Array.prototype.filter.call(doc.body ? doc.body.children : [], function (ch) {
      return sections.indexOf(ch) < 0 && !/^(script|style|link)$/i.test(ch.tagName) && !ch.querySelector('section');
    });
    if (extras.length) {
      var ex = h('div', { class: 'kh-extras', style: 'display:none' });
      extras.forEach(function (e) { ex.appendChild(document.importNode(e, true)); });
      deck.appendChild(ex);
    }
    return deck;
  }
  function importForeign(doc) {
    var deck = h('div', { class: 'kh-deck' });
    var s = h('section', { class: 'kh-slide' });
    var el = M.create.html({ x: 0, y: 0, w: 1920, h: 1080, html: '' });
    var styles = KH.$$('style', doc).map(function (st) { return st.outerHTML; }).join('\n');
    el.innerHTML = styles + (doc.body ? doc.body.innerHTML : '');
    KH.$$('script', el).forEach(function (sc) { sc.remove(); });
    s.appendChild(el); s.appendChild(h('aside', { class: 'kh-notes' }));
    deck.appendChild(s);
    M.title = doc.title || M.title;
    return deck;
  }
  M.loadHtml = function (html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var deck = doc.querySelector('.kh-deck');
    M.title = doc.title || (M.file ? M.file.replace(/^.*\//, '').replace(/\.html?$/i, '') : 'Untitled');
    if (deck) {
      var mac = doc.getElementById('kh-macros'); M.macros = mac ? unesc(mac.textContent) : '';
      var cssSrc = doc.getElementById('kh-custom-css-src'), css = doc.getElementById('kh-custom-css');
      M.customCss = cssSrc ? unesc(cssSrc.textContent).trim() : (css ? css.textContent.trim() : '');
      var js = doc.getElementById('kh-custom-js'); M.customJs = js ? unesc(js.textContent).trim() : '';
      M.scripts = KH.$$('script.kh-ext[src]', doc).map(function (s) { return s.getAttribute('src'); });
      deck = document.adoptNode(deck);
    } else {
      var secs = KH.$$('section', doc).filter(function (s) { return !s.querySelector('section'); });
      if (!secs.length) secs = KH.$$('.slide', doc).filter(function (s) { return !s.querySelector('.slide'); });
      deck = secs.length ? importSections(doc, secs) : importForeign(doc);
    }
    deck.classList.remove('kh-back'); deck.removeAttribute('data-kh-trans');
    deck.style.transform = ''; deck.style.left = ''; deck.style.top = '';
    KH.$$('#kh-num', deck).forEach(function (e) { e.remove(); });
    KH.$$('.kh-slide', deck).forEach(function (s) { s.classList.remove('kh-current', 'kh-leaving', 'kh-enter'); });
    KH.$$('.kh-el', deck).forEach(function (e) { e.classList.remove('kh-hidden', 'kh-build-in', 'kh-editing'); });
    KH.$$('[contenteditable]', deck).forEach(function (e) { e.removeAttribute('contenteditable'); });
    KH.$$('video,audio', deck).forEach(function (v) { v.muted = true; v.removeAttribute('autoplay'); });
    M.deck = deck;
    M.W = parseInt(deck.getAttribute('data-width'), 10) || 1920;
    M.H = parseInt(deck.getAttribute('data-height'), 10) || 1080;
    deck.style.width = M.W + 'px'; deck.style.height = M.H + 'px';
    if (!M.slides().length) deck.appendChild(M.newSlide('title'));
    M.idsAssigned = M.ensureSlideIds(deck); // true when the file had slides without ids
    M.cur = 0;
    return deck;
  };
  M.newDeck = function (title) {
    var deck = h('div', { class: 'kh-deck', 'data-width': '1920', 'data-height': '1080' }); // no data-transition: hard cuts by default
    deck.style.cssText = '--kh-bg:#ffffff;--kh-color:#1d1d1f;--kh-accent:#0a84ff;--kh-muted:#6e6e73;--kh-font:"Helvetica Neue",Helvetica,Arial,sans-serif;--kh-heading-font:"Helvetica Neue",Helvetica,Arial,sans-serif';
    M.deck = deck; M.W = 1920; M.H = 1080;
    deck.style.width = '1920px'; deck.style.height = '1080px';
    M.title = title || 'Untitled';
    M.macros = ''; M.customCss = ''; M.customJs = ''; M.scripts = [];
    deck.appendChild(M.newSlide('title'));
    M.cur = 0;
    return deck;
  };
  M.themeKeys = THEME_KEYS;
  return M;
})();
