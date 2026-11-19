/* keyhtml editor — the right-hand inspector (Format / Animate / Document). */
KH.inspector = (function () {
  var I = { tab: 'format' };
  var M = KH.model, C = KH.canvas, T = KH.text, h = KH.h;
  var body;
  var FONTS = [
    ['"Helvetica Neue",Helvetica,Arial,sans-serif', 'Helvetica Neue'], ['Helvetica,Arial,sans-serif', 'Helvetica'], ['Arial,sans-serif', 'Arial'],
    ['"Avenir Next",Avenir,sans-serif', 'Avenir Next'], ['"Gill Sans","Gill Sans MT",sans-serif', 'Gill Sans'], ['Futura,sans-serif', 'Futura'],
    ['Optima,sans-serif', 'Optima'], ['Verdana,sans-serif', 'Verdana'], ['Georgia,serif', 'Georgia'], ['"Times New Roman",Times,serif', 'Times New Roman'],
    ['Palatino,"Palatino Linotype",serif', 'Palatino'], ['Baskerville,serif', 'Baskerville'], ['"Hoefler Text",serif', 'Hoefler Text'],
    ['Menlo,Monaco,Consolas,monospace', 'Menlo'], ['"Courier New",Courier,monospace', 'Courier New'], ['system-ui,sans-serif', 'System'],
  ];
  var THEMES = {
    light: { '--kh-bg': '#ffffff', '--kh-color': '#1d1d1f', '--kh-accent': '#0a84ff', '--kh-muted': '#6e6e73' },
    dark: { '--kh-bg': '#000000', '--kh-color': '#ffffff', '--kh-accent': '#4cc9f0', '--kh-muted': '#8a8a8a' },
    slate: { '--kh-bg': '#1c2331', '--kh-color': '#f2f4f8', '--kh-accent': '#ffb703', '--kh-muted': '#9aa4b5' },
    warm: { '--kh-bg': '#fbf7f0', '--kh-color': '#2b2118', '--kh-accent': '#c1440e', '--kh-muted': '#8a7b6e' },
  };

  I.init = function () {
    body = KH.$('#inspector-body');
    KH.on('select', I.refresh); KH.on('change', I.refresh); KH.on('edit-start', I.refresh); KH.on('edit-end', I.refresh);
    KH.on('slide', I.refresh); KH.on('load', I.refresh);
    KH.on('geom', KH.debounce(I.syncGeom, 60));
    KH.on('selectionchange', KH.debounce(function () {
      // Don't rebuild the panel out from under a control the user just focused (e.g. the Size box).
      if (body.contains(document.activeElement) || I.pickerOpen) return;
      if (T.editing && I.tab === 'format') I.refresh();
    }, 150));
    KH.$$('.tb-tab').forEach(function (b) { b.addEventListener('click', function () { I.setTab(b.getAttribute('data-tab')); }); });
  };
  I.setTab = function (tab) {
    I.tab = tab;
    KH.$$('.tb-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
    I.refresh();
  };

  // ---------------------------------------------------------------- controls
  function sec(title) {
    var s = h('div', { class: 'insp-section' });
    if (title) s.appendChild(h('h4', {}, title));
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) s.appendChild(arguments[i]);
    return s;
  }
  function row(label) {
    var r = h('div', { class: 'insp-row' }, h('label', {}, label));
    var c = h('div', { class: 'ctl' });
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) c.appendChild(typeof arguments[i] === 'string' ? h('span', { class: 'unit' }, arguments[i]) : arguments[i]);
    r.appendChild(c);
    return r;
  }
  function stack(label, ctl) {
    return h('div', { class: 'insp-row', style: { flexDirection: 'column', alignItems: 'stretch' } }, h('label', { style: { width: 'auto', marginBottom: '3px' } }, label), ctl);
  }
  function fmt(v) { return (Math.round(v * 100) / 100).toString(); }
  function num(get, set, o) {
    o = o || {};
    var inp = h('input', { type: 'number', step: o.step || 1, class: o.wide ? 'wide' : '' });
    if (o.min != null) inp.min = o.min; if (o.max != null) inp.max = o.max;
    inp.value = fmt(get());
    if (o.geom) inp.setAttribute('data-geom', o.geom);
    inp.addEventListener('change', function () {
      var v = parseFloat(inp.value);
      if (isNaN(v)) { inp.value = fmt(get()); return; }
      if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v);
      set(v);
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    return inp;
  }
  function stepper(get, set, o) {
    o = o || {}; var step = o.step || 1;
    var inp = num(get, set, o);
    var minus = h('button', {}, '−'), plus = h('button', {}, '+');
    minus.addEventListener('mousedown', function (e) { e.preventDefault(); });
    plus.addEventListener('mousedown', function (e) { e.preventDefault(); });
    minus.addEventListener('click', function () { var v = get() - step; if (o.min != null) v = Math.max(o.min, v); set(v); });
    plus.addEventListener('click', function () { var v = get() + step; if (o.max != null) v = Math.min(o.max, v); set(v); });
    return h('div', { class: 'stepper' }, minus, inp, plus);
  }
  /* The swatch grid: the dark-deck palette first (white text on black, signal / highlight / threshold
     accents and the greys used for secondary text, data points and axes), then general colors. */
  var PALETTE = [
    ['#ffffff', 'White'], ['#b0b0b0', 'Light grey · data points'], ['#8a8a8a', 'Mid grey · secondary text'], ['#666666', 'Grey · axes'], ['#333333', 'Dark grey · reference lines'],
    ['#000000', 'Black'], ['#4cc9f0', 'Signal · cyan'], ['#ff9f1c', 'Highlight · orange'], ['#f72585', 'Threshold · magenta'], ['#ffd60a', 'Yellow'],
    ['#06d6a0', 'Green'], ['#4361ee', 'Blue'], ['#7209b7', 'Violet'], ['#e63946', 'Red'], ['#80ffdb', 'Mint'],
    ['#1a1a1a', 'Near black'], ['#e9ecef', 'Near white'], ['#3a86ff', 'Light blue'], ['#8ac926', 'Lime'], ['#d4a373', 'Tan'],
  ];
  function colorCtl(get, set, o) {
    o = o || {};
    var cur = get();
    var none = KH.isTransparent(cur);
    // The swatch opens a grid of preset colors; its "Custom…" cell opens the native picker, which is
    // the (invisible) color input underneath and keeps all its event handling below.
    var inp = h('input', { type: 'color', value: KH.toHex(cur) || '#000000', class: 'native', tabindex: '-1', title: 'Custom color' });
    var sw = h('button', { class: 'swatch', title: 'Color' });
    var showCur = function (v) { sw.style.background = v || ''; sw.classList.toggle('is-none', !v); };
    showCur(none ? null : KH.toHex(cur) || cur);
    var w = h('div', { class: 'color-ctl' + (none ? ' is-none' : '') }, sw, inp);
    // Text color on a selection (o.text, while editing): the selected range is remembered when the
    // picker opens and painted directly (T.styleRange) on every pick. That needs neither focus nor
    // the selection, so the native panel stays open, the text shows the color live, and the color
    // still lands on that text when the box is no longer being edited by the time the panel closes
    // (a click on the slide dismisses it, and macOS keeps the panel bound to this control even after
    // the inspector has been rebuilt). It never falls back to coloring the whole box.
    // A collapsed caret gets the typing color when the picker closes, as before.
    var saved = null, spans = null, dirty = false, pending = false;
    var textSel = function () { return o.text && T.editing && T.lastRange && !T.lastRange.collapsed ? T.lastRange : null; };
    var capture = function () {
      var r = textSel(); if (!r) return;
      if (saved && spans && T.sameRange(r, saved.range)) return; // still the text painted so far
      saved = { el: T.editing, range: r.cloneRange() }; spans = null;
    };
    var paint = function (v) {
      if (!saved.el.isConnected || (!spans && !saved.range.startContainer.isConnected)) { saved = null; return; }
      if (!spans) {
        spans = T.styleRange(saved.range, 'color', v);
        if (!spans.length) { saved = null; return; }
        var r = document.createRange(); r.setStartBefore(spans[0]); r.setEndAfter(spans[spans.length - 1]);
        saved.range = r; if (T.editing === saved.el) T.setRange(r);
      } else spans.forEach(function (s) { s.style.color = v; });
      dirty = true;
      C.renderSelection(); KH.emit('geom');
    };
    var commit = function () {
      if (saved) { if (dirty) { dirty = false; M.history.push(); } return; }
      if (pending) { pending = false; if (T.editing) set(inp.value, false); return; }
      set(inp.value, false);
    };
    var open = function () { I.pickerOpen = true; capture(); };
    var shut = function () { I.pickerOpen = false; };
    inp.addEventListener('mousedown', open); inp.addEventListener('focus', open);
    inp.addEventListener('blur', function () { shut(); if (saved || pending) commit(); });
    inp.addEventListener('input', function () {
      w.classList.remove('is-none');
      capture();
      if (saved) paint(inp.value);
      else if (T.editing) pending = true;
      else set(inp.value, true);
    });
    inp.addEventListener('change', function () { shut(); w.classList.remove('is-none'); showCur(inp.value); if (saved || pending || !T.editing) commit(); });
    inp.addEventListener('input', function () { showCur(inp.value); });
    // A preset swatch applies at once: to the remembered text selection, the typing color, or the boxes.
    var choose = function (hex) {
      inp.value = hex; w.classList.remove('is-none'); showCur(hex);
      capture();
      if (saved) { paint(hex); commit(); }
      else set(hex, false);
    };
    var pop = null;
    sw.addEventListener('mousedown', function (e) { e.preventDefault(); });
    sw.addEventListener('click', function () {
      if (pop && pop.isConnected) { KH.ui.closePopovers(); return; }
      var grid = h('div', { class: 'swatch-grid' });
      var curHex = KH.toHex(w.classList.contains('is-none') ? '' : inp.value) || '';
      PALETTE.forEach(function (c) {
        var b = h('button', { class: 'sw' + (c[0] === curHex ? ' active' : ''), title: c[1] + '  ' + c[0], style: { background: c[0] } });
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function () { KH.ui.closePopovers(); choose(c[0]); });
        grid.appendChild(b);
      });
      var custom = h('button', { class: 'ibtn custom' }, 'Custom…');
      custom.addEventListener('mousedown', function (e) { e.preventDefault(); });
      custom.addEventListener('click', function () {
        KH.ui.closePopovers();
        open();
        try { inp.showPicker(); } catch (e) { inp.click(); }
      });
      pop = KH.ui.popover(sw, h('div', { class: 'swatch-pop' }, grid, custom), { onClose: function () { I.pickerOpen = false; pop = null; } });
      I.pickerOpen = true;
    });
    if (o.none) {
      var nb = h('button', { class: 'none', title: 'None / transparent' }, '∅');
      nb.addEventListener('click', function () { w.classList.add('is-none'); set(null, false); });
      w.appendChild(nb);
    }
    return w;
  }
  function sel(options, get, set) {
    var s = h('select');
    options.forEach(function (o) { s.appendChild(h('option', { value: o[0] }, o[1])); });
    var v = get();
    if (!options.some(function (o) { return o[0] === v; })) { s.appendChild(h('option', { value: v }, 'Other: ' + String(v).slice(0, 24))); }
    s.value = v;
    s.addEventListener('change', function () { set(s.value); });
    return s;
  }
  function check(label, get, set) {
    var c = h('input', { type: 'checkbox' }); c.checked = !!get();
    c.addEventListener('change', function () { set(c.checked); });
    return h('label', { class: 'chk' }, c, label);
  }
  function seg(options, get, set, small) {
    var s = h('div', { class: 'seg' + (small ? ' small' : '') });
    var cur = get();
    options.forEach(function (o) {
      var b = h('button', { title: o.title || '' });
      b.innerHTML = o.icon ? KH.icon(o.icon) : o.label;
      if (cur === o.v || (Array.isArray(cur) && cur.indexOf(o.v) >= 0)) b.classList.add('active');
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { set(o.v, b); });
      s.appendChild(b);
    });
    return s;
  }
  function btn(label, fn, cls) {
    var b = h('button', { class: 'ibtn ' + (cls || '') }, label);
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', fn);
    return b;
  }
  function iconBtn(icon, title, fn) {
    var b = h('button', { class: 'ibtn', title: title, style: { padding: '0 6px' } });
    b.innerHTML = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round">' + KH.icon(icon).replace(/^<svg[^>]*>|<\/svg>$/g, '') + '</svg>';
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', fn);
    return b;
  }
  function ta(get, set, cls, placeholder) {
    var t = h('textarea', { class: cls || '', spellcheck: 'false', placeholder: placeholder || '' });
    t.value = get() || '';
    t.addEventListener('change', function () { set(t.value); });
    t.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); set(t.value); t.blur(); } });
    return t;
  }
  function hint(text) { return h('div', { class: 'insp-hint' }, text); }
  function applySel(fn, live) { C.apply(fn, { nocommit: !!live }); }
  function basename(p) { return (p || '').replace(/^.*\//, '').replace(/\?.*$/, ''); }

  // ---------------------------------------------------------------- refresh
  I.refresh = function () {
    if (!body || !M.deck) return;
    body.innerHTML = '';
    if (I.tab === 'document') renderDocument();
    else if (I.tab === 'animate') renderAnimate();
    else renderFormat();
  };
  I.syncGeom = function () {
    var el = C.single(); if (!el) return;
    var g = M.geom(el);
    KH.$$('[data-geom]', body).forEach(function (inp) {
      if (document.activeElement === inp) return;
      var k = inp.getAttribute('data-geom');
      inp.value = fmt(g[k]);
    });
  };

  function renderFormat() {
    var els = C.sel;
    if (!els.length) { body.appendChild(slideSection()); return; }
    var types = els.map(M.type), el = els[0], type = types[0];
    var same = types.every(function (t) { return t === type; });
    if (same) {
      if (type === 'text') { body.appendChild(textSection(el)); body.appendChild(boxSection(el, false)); }
      else if (type === 'shape') { body.appendChild(boxSection(el, true)); body.appendChild(textSection(el)); }
      else if (type === 'line') body.appendChild(lineSection(el));
      else if (type === 'image') body.appendChild(imageSection(el));
      else if (type === 'video') body.appendChild(videoSection(el));
      else if (type === 'math') body.appendChild(mathSection(el));
      else if (type === 'code') body.appendChild(codeSection(el));
      else if (type === 'html') {
        // While editing an HTML block in place, offer selection-level text formatting too.
        if (T.editing === el && els.length === 1) body.appendChild(textSection(el));
        body.appendChild(htmlSection(el));
      }
      else if (type === 'group') body.appendChild(groupSection(el));
    }
    body.appendChild(arrangeSection(els));
  }
  function groupSection(el) {
    var s = sec('Group');
    var n = M.elements(el).length;
    s.appendChild(row('', h('span', { class: 'insp-hint', style: { margin: 0, flex: '1' } }, n + ' objects'), btn('Ungroup', C.ungroup)));
    s.appendChild(hint('Resizing a group scales everything inside it (text sizes too when the aspect is kept). Double-click an object inside the group to select and edit it; Esc steps back out.'));
    return s;
  }

  // ---------------------------------------------------------------- sections
  function slideSection() {
    var slide = M.slide();
    var s = sec('Slide');
    s.appendChild(row('Background',
      colorCtl(function () { return slide.style.backgroundColor || slide.style.background; }, function (v, live) { slide.style.background = v || ''; if (!live) M.history.push(); }, { none: true }),
      btn('Theme default', function () { slide.style.background = ''; slide.style.backgroundImage = ''; M.history.push(); })));
    s.appendChild(row('Image', btn('Choose…', function () {
      KH.io.pickFiles('image/*,.pdf', false, function (files) {
        if (!files.length) return;
        KH.io.upload(files[0]).then(function (res) {
          slide.style.backgroundImage = 'url("' + res.url + '")'; slide.style.backgroundSize = 'cover'; slide.style.backgroundPosition = 'center';
          M.history.push();
        }).catch(function (e) { KH.toast(e.message, 'error'); });
      });
    }), btn('Clear', function () { slide.style.backgroundImage = ''; slide.style.backgroundSize = ''; slide.style.backgroundPosition = ''; M.history.push(); })));
    s.appendChild(row('Transition', sel([['', 'Deck default'], ['none', 'None'], ['fade', 'Fade'], ['push', 'Push'], ['zoom', 'Zoom']],
      function () { return slide.getAttribute('data-transition') || ''; }, function (v) { if (v) slide.setAttribute('data-transition', v); else slide.removeAttribute('data-transition'); M.history.push(); })));
    s.appendChild(row('', check('Skip this slide when presenting', function () { return slide.hasAttribute('data-skip'); }, function () { KH.nav.toggleSkip([M.cur]); })));
    s.appendChild(hint('Nothing selected. Click an object to format it; double-click text to edit. Drop images, PDFs or movies anywhere on the slide, or paste a screenshot.'));
    return s;
  }

  function arrangeSection(els) {
    var el = els[0], single = els.length === 1, type = M.type(el);
    var s = sec('Arrange');
    if (single) {
      var g = M.geom(el), aspect = M.isAspectLocked(el);
      s.appendChild(row('Position',
        num(function () { return M.geom(el).x; }, function (v) { applySel(function (e) { M.setGeom(e, { x: v }); }); }, { geom: 'x' }), 'X',
        num(function () { return M.geom(el).y; }, function (v) { applySel(function (e) { M.setGeom(e, { y: v }); }); }, { geom: 'y' }), 'Y'));
      s.appendChild(row('Size',
        num(function () { return M.geom(el).w; }, function (v) {
          applySel(function (e) { var gg = M.geom(e); M.resizeTo(e, v, M.isAspectLocked(e) ? v * gg.h / gg.w : gg.h); afterResize(e); });
        }, { geom: 'w', min: 1 }), 'W',
        num(function () { return M.geom(el).h; }, function (v) {
          applySel(function (e) { var gg = M.geom(e); M.resizeTo(e, M.isAspectLocked(e) ? v * gg.w / gg.h : gg.w, v); afterResize(e); });
        }, { geom: 'h', min: 1 }), 'H'));
      s.appendChild(row('Rotate',
        num(function () { return M.geom(el).r; }, function (v) { applySel(function (e) { M.setGeom(e, { r: v }); }); }, { geom: 'r', step: 1, min: -180, max: 180 }), '°',
        type !== 'line' ? check('Keep ratio', function () { return aspect; }, function (v) { applySel(function (e) { e.setAttribute('data-lock-aspect', v ? '1' : '0'); }); }) : null));
        if (type === 'text' && !M.isAutoHeight(el)) s.appendChild(row('', btn('Auto height', function () { applySel(function (e) { M.setGeom(e, { h: 'auto' }); }); })));
    }
    var grid = h('div', { class: 'align-grid' });
    [['arrLeft', 'Align left', 'left'], ['arrCenterH', 'Center horizontally', 'centerh'], ['arrRight', 'Align right', 'right'],
     ['arrTop', 'Align top', 'top'], ['arrCenterV', 'Center vertically', 'centerv'], ['arrBottom', 'Align bottom', 'bottom']].forEach(function (a) {
      var b = h('button', { title: a[1] + (els.length > 1 ? ' (relative to selection)' : ' (on slide)') }); b.innerHTML = KH.icon(a[0]);
      b.addEventListener('click', function () { C.align(a[2]); });
      grid.appendChild(b);
    });
    s.appendChild(row('Align', grid));
    if (els.length >= 3) s.appendChild(row('Distribute', btn('Horizontally', function () { C.distribute('h'); }), btn('Vertically', function () { C.distribute('v'); })));
    if (C.canGroup() || C.hasGroup()) s.appendChild(row('Group', C.canGroup() ? btn('Group  ⌘G', C.group) : null, C.hasGroup() ? btn('Ungroup  ⇧⌘G', C.ungroup) : null));
    s.appendChild(row('Order',
      iconBtn('front', 'Bring to front', function () { C.reorder('front'); }), btn('▲', function () { C.reorder('forward'); }, ''),
      btn('▼', function () { C.reorder('backward'); }), iconBtn('back', 'Send to back', function () { C.reorder('back'); })));
    s.appendChild(row('Opacity', num(function () { return Math.round((el.style.opacity === '' ? 1 : parseFloat(el.style.opacity)) * 100); },
      function (v) { applySel(function (e) { e.style.opacity = v >= 100 ? '' : String(v / 100); }); }, { min: 0, max: 100 }), '%',
      check('Lock', function () { return M.isLocked(el); }, function () { C.toggleLock(); })));
    s.appendChild(row('', btn('Delete', C.deleteSelection, 'danger'), btn('Duplicate', C.duplicateSelection)));
    return s;
  }
  function afterResize(e) {
    var t = M.type(e);
    if (t === 'line') KH.shapes.renderLine(e);
    if (t === 'math') KH.math.syncSizeFromBox(e);
    if (t === 'code') KH.code.syncSizeFromBox(e);
  }

  function matchFont(ff) {
    var first = (ff || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    var m = FONTS.filter(function (f) { return f[0].split(',')[0].replace(/["']/g, '').trim().toLowerCase() === first; })[0];
    return m ? m[0] : (ff || '');
  }
  function textSection(el) {
    var st = T.state(el);
    var s = sec('Text');
    var inHtml = M.type(el) === 'html'; // box-level rows would restyle the whole imported slide
    var fontOpts = FONTS.slice();
    if (!el.style.fontFamily && !T.editing) fontOpts.unshift(['', 'Theme font']);
    s.appendChild(row('Font', sel(fontOpts, function () { return el.style.fontFamily ? matchFont(el.style.fontFamily) : (T.editing ? matchFont(st.fontFamily) : ''); },
      function (v) { if (!v) applySel(function (e) { e.style.fontFamily = ''; }); else T.exec('fontName', v); })));
    s.appendChild(row('Size', stepper(function () { return st.fontSize; }, function (v) { T.setFontSize(v); }, { min: 4, max: 500, step: 2 }), 'px',
      colorCtl(function () { return st.color; }, function (v, live) { T.exec('foreColor', v || '', live); }, { text: true }),
      (function () { var b = btn('Default', T.resetColor); b.title = 'Reset to the deck text color (⌥⌘0)'; return b; })()));
    s.appendChild(row('Style',
      seg([{ v: 'bold', icon: 'bold', title: 'Bold ⌘B' }, { v: 'italic', icon: 'italic', title: 'Italic ⌘I' }, { v: 'underline', icon: 'underline', title: 'Underline ⌘U' }, { v: 'strikeThrough', icon: 'strike', title: 'Strikethrough' }],
        function () { return [st.bold && 'bold', st.italic && 'italic', st.underline && 'underline', st.strike && 'strikeThrough']; }, function (v) { T.exec(v); }),
      seg([{ v: 'superscript', icon: 'sup', title: 'Superscript' }, { v: 'subscript', icon: 'sub', title: 'Subscript' }],
        function () { return [st.sup && 'superscript', st.sub && 'subscript']; }, function (v) { if (T.editing) T.exec(v); }),
      inHtml ? null : seg([{ v: 'link', icon: 'link', title: 'Link ⌘K' }], function () { return st.link && 'link'; }, function () { T.link(); })));
    s.appendChild(row('Align',
      seg([{ v: 'justifyLeft', icon: 'alignLeft', title: 'Left' }, { v: 'justifyCenter', icon: 'alignCenter', title: 'Center' }, { v: 'justifyRight', icon: 'alignRight', title: 'Right' }, { v: 'justifyFull', icon: 'alignJustify', title: 'Justify' }],
        function () { return 'justify' + st.align.charAt(0).toUpperCase() + st.align.slice(1).replace('justify', 'Full'); }, function (v) { T.exec(v); }),
      inHtml ? null : seg([{ v: 'top', icon: 'valignTop', title: 'Top' }, { v: 'middle', icon: 'valignMiddle', title: 'Middle' }, { v: 'bottom', icon: 'valignBottom', title: 'Bottom' }],
        function () { return T.valign(el); }, function (v) { applySel(function (e) { T.valign(e, v); }); })));
    s.appendChild(row('Lists',
      seg([{ v: 'insertUnorderedList', icon: 'ul', title: 'Bulleted list' }, { v: 'insertOrderedList', icon: 'ol', title: 'Numbered list' }],
        function () { return [st.ul && 'insertUnorderedList', st.ol && 'insertOrderedList']; }, function (v) { T.exec(v); }),
      btn('⇤', function () { if (T.editing) T.exec('outdent'); }, ''), btn('⇥', function () { if (T.editing) T.exec('indent'); }, '')));
    if (!inHtml) s.appendChild(row('Spacing',
      num(function () { return parseFloat(el.style.lineHeight) || 1.3; }, function (v) { applySel(function (e) { e.style.lineHeight = String(v); }); }, { step: 0.05, min: 0.5, max: 4 }), 'line',
      num(function () { var b = T.body(el); return b ? KH.px(b.style.padding || getComputedStyle(b).paddingLeft) : 8; }, function (v) { applySel(function (e) { var b = T.body(e); if (b) b.style.padding = v + 'px'; }); }, { min: 0, max: 400 }), 'inset'));
    if (T.table(el)) s.appendChild(row('Table',
      btn('+row', function () { T.tableAddRow(el); M.history.push(); }), btn('−row', function () { T.tableDelRow(el); M.history.push(); }),
      btn('+col', function () { T.tableAddCol(el); M.history.push(); }), btn('−col', function () { T.tableDelCol(el); M.history.push(); })));
    s.appendChild(hint(T.editing === el ? 'Editing: formatting applies to the selection. $…$ renders as LaTeX when you finish (Esc or ⌘⏎).' : 'Formatting applies to the whole box. Double-click (or press ⏎) to edit the text.'));
    return s;
  }
  function boxSection(el, isShape) {
    var s = sec(isShape ? 'Shape' : 'Box');
    if (isShape) {
      var types = KH.shapes.types.filter(function (t) { return !/^(line|arrow|darrow)$/.test(t.id); }).map(function (t) { return [t.id === 'rounded' ? 'rect' : t.id, t.name]; });
      types = types.filter(function (t, i, a) { return a.findIndex(function (x) { return x[0] === t[0]; }) === i; });
      s.appendChild(row('Shape', sel(types, function () { return KH.shapes.shapeType(el); }, function (v) { applySel(function (e) { KH.shapes.setShapeType(e, v); }); })));
    }
    s.appendChild(row('Fill', colorCtl(function () { return el.style.backgroundColor || el.style.background; },
      function (v, live) { applySel(function (e) { e.style.background = v || ''; }, live); }, { none: true })));
    s.appendChild(row('Border',
      num(function () { return KH.px(el.style.borderWidth); }, function (v) {
        applySel(function (e) { var col = e.style.borderColor || '#1d1d1f'; e.style.border = v > 0 ? v + 'px solid ' + col : ''; });
      }, { min: 0, max: 100 }), 'px',
      colorCtl(function () { return el.style.borderColor || '#1d1d1f'; }, function (v, live) {
        applySel(function (e) { var w = KH.px(e.style.borderWidth) || 4; e.style.border = w + 'px solid ' + (v || '#1d1d1f'); }, live);
      })));
    s.appendChild(row('Corners', num(function () { return KH.px(el.style.borderRadius); }, function (v) { applySel(function (e) { e.style.borderRadius = v > 0 ? v + 'px' : ''; }); }, { min: 0, max: 500 }), 'px',
      check('Shadow', function () { return !!el.style.boxShadow; }, function (v) { applySel(function (e) { e.style.boxShadow = v ? '0 12px 32px rgba(0,0,0,.35)' : ''; }); })));
    return s;
  }
  function lineSection(el) {
    var s = sec('Line');
    function upd(fn, live) { applySel(function (e) { fn(e); KH.shapes.renderLine(e); }, live); }
    s.appendChild(row('Stroke', colorCtl(function () { return el.getAttribute('data-stroke'); }, function (v, live) { upd(function (e) { e.setAttribute('data-stroke', v || '#000'); }, live); }),
      num(function () { return parseFloat(el.getAttribute('data-stroke-width')) || 6; }, function (v) { upd(function (e) { e.setAttribute('data-stroke-width', String(v)); }); }, { min: 1, max: 100 }), 'px'));
    s.appendChild(row('Arrows', sel([['none', 'None'], ['end', 'End'], ['start', 'Start'], ['both', 'Both']], function () { return el.getAttribute('data-arrow') || 'none'; }, function (v) { upd(function (e) { e.setAttribute('data-arrow', v); }); })));
    s.appendChild(row('Dash', sel([['', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], function () { return el.getAttribute('data-dash') || ''; }, function (v) { upd(function (e) { if (v) e.setAttribute('data-dash', v); else e.removeAttribute('data-dash'); }); })));
    s.appendChild(hint('Drag the end handles to change the length; use the rotation handle or the Rotate field for the angle.'));
    return s;
  }
  function imageSection(el) {
    var img = el.querySelector('img');
    var s = sec('Image');
    var name = h('span', { class: 'insp-hint', style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }, title: img ? img.getAttribute('src') : '' }, img ? basename(img.getAttribute('src')) : '');
    s.appendChild(row('File', name, btn('Replace…', function () { KH.io.replaceMedia(el); })));
    if (img && img.getAttribute('data-pdf')) {
      var pages = parseInt(img.getAttribute('data-pages'), 10) || 1;
      s.appendChild(row('PDF page', stepper(function () { return parseInt(img.getAttribute('data-page'), 10) || 1; }, function (v) { KH.io.pdfPage(el, v); }, { min: 1, max: pages }), 'of ' + pages));
      s.appendChild(hint('Converted from ' + basename(img.getAttribute('data-pdf')) + ' to SVG: it stays vector-sharp at any projector resolution.'));
    }
    var cropped = M.isCropped(el), cropping = C.crop && C.crop.el === el;
    s.appendChild(row('Crop', btn(cropping ? 'Done' : cropped ? 'Edit crop…' : 'Crop…', function () { if (cropping) C.exitCrop(); else C.enterCrop(el); }),
      cropped ? btn('Reset', function () { C.resetCrop(el); }) : null, h('span', { class: 'unit' }, '⌘K')));
    if (!cropped) s.appendChild(row('Fit', sel([['fill', 'Stretch to box'], ['contain', 'Fit inside'], ['cover', 'Fill & crop']],
      function () { return el.classList.contains('kh-fit-contain') ? 'contain' : el.classList.contains('kh-fit-cover') ? 'cover' : 'fill'; },
      function (v) { applySel(function (e) { e.classList.remove('kh-fit-contain', 'kh-fit-cover'); if (v !== 'fill') e.classList.add('kh-fit-' + v); }); }),
      btn('Natural size', function () { KH.io.naturalSize(el); })));
    else s.appendChild(hint('Cropped: the box shows a window onto the image. Resizing the box scales the crop with it; double-click the image to adjust it.'));
    s.appendChild(row('Border', num(function () { return KH.px(el.style.borderWidth); }, function (v) { applySel(function (e) { var col = e.style.borderColor || '#1d1d1f'; e.style.border = v > 0 ? v + 'px solid ' + col : ''; }); }, { min: 0, max: 100 }), 'px',
      colorCtl(function () { return el.style.borderColor || '#1d1d1f'; }, function (v, live) { applySel(function (e) { var w = KH.px(e.style.borderWidth) || 4; e.style.border = w + 'px solid ' + (v || '#1d1d1f'); }, live); })));
    s.appendChild(row('Corners', num(function () { return KH.px(el.style.borderRadius); }, function (v) { applySel(function (e) { e.style.borderRadius = v > 0 ? v + 'px' : ''; e.style.overflow = v > 0 ? 'hidden' : ''; }); }, { min: 0, max: 500 }), 'px',
      check('Shadow', function () { return !!el.style.boxShadow; }, function (v) { applySel(function (e) { e.style.boxShadow = v ? '0 12px 32px rgba(0,0,0,.35)' : ''; }); })));
    s.appendChild(row('Fill', colorCtl(function () { return el.style.backgroundColor || el.style.background; }, function (v, live) { applySel(function (e) { e.style.background = v || ''; }, live); }, { none: true }), hint('behind transparent images')));
    return s;
  }
  function videoSection(el) {
    var v = el.querySelector('video,audio');
    var s = sec(v && v.tagName === 'AUDIO' ? 'Audio' : 'Movie');
    var name = h('span', { class: 'insp-hint', style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 } }, v ? basename(v.getAttribute('src')) : '');
    s.appendChild(row('File', name, btn('Replace…', function () { KH.io.replaceMedia(el); })));
    function attr(name, on) { applySel(function (e) { var m = e.querySelector('video,audio'); if (!m) return; if (on) m.setAttribute(name, name === 'data-autoplay' ? '1' : ''); else m.removeAttribute(name); }); }
    s.appendChild(row('Playback', check('Autoplay', function () { return v && v.hasAttribute('data-autoplay'); }, function (on) { attr('data-autoplay', on); }),
      check('Loop', function () { return v && v.hasAttribute('loop'); }, function (on) { attr('loop', on); })));
    s.appendChild(row('', check('Muted', function () { return v && v.hasAttribute('muted'); }, function (on) { attr('muted', on); }),
      check('Controls', function () { return v && v.hasAttribute('controls'); }, function (on) { attr('controls', on); })));
    s.appendChild(row('Start at', num(function () { return parseFloat(v && v.getAttribute('data-start')) || 0; }, function (x) { applySel(function (e) { var m = e.querySelector('video,audio'); if (m) { if (x > 0) m.setAttribute('data-start', String(x)); else m.removeAttribute('data-start'); } }); }, { min: 0, step: 0.5 }), 's',
      btn('Preview ▶', function () { KH.ui.toggleVideoPreview(el); })));
    s.appendChild(hint('Autoplay starts the movie when the slide (or its build step) appears. Without controls, clicking the movie during the talk toggles play/pause. MP4 (H.264) plays everywhere.'));
    return s;
  }
  function mathSection(el) {
    var s = sec('Equation');
    s.appendChild(stack('LaTeX (⌘⏎ to apply)', ta(function () { return el.getAttribute('data-tex'); }, function (v) {
      applySel(function (e) { e.setAttribute('data-tex', v); KH.math.renderElement(e, false); });
    }, 'tex')));
    if (el.getAttribute('data-error')) s.appendChild(h('div', { class: 'insp-error' }, el.getAttribute('data-error')));
    s.appendChild(row('Size', stepper(function () { return Math.round(parseFloat(el.getAttribute('data-fs')) || 60); }, function (v) { T.setFontSize(v); }, { min: 8, max: 400, step: 4 }), 'px',
      colorCtl(function () { return el.style.color || getComputedStyle(el).color; }, function (v, live) { applySel(function (e) { e.style.color = v || ''; }, live); })));
    s.appendChild(row('', btn('Open equation editor…', function () { KH.ui.editEquation(el); })));
    return s;
  }
  function codeSection(el) {
    var K = KH.code, s = sec('Code');
    s.appendChild(row('Language', sel(K.LANGS, function () { return K.lang(el); }, function (v) {
      applySel(function (e) { if (M.type(e) === 'code') { e.setAttribute('data-lang', v); K.render(e); } });
    })));
    s.appendChild(row('Theme', seg([{ v: 'dark', label: 'Dark' }, { v: 'light', label: 'Light' }], function () { return K.theme(el); }, function (v) {
      applySel(function (e) { if (M.type(e) === 'code') K.theme(e, v); });
    })));
    s.appendChild(row('Size', stepper(function () { return Math.round(K.fontSize(el)); }, function (v) { T.setFontSize(v); }, { min: 6, max: 200, step: 2 }), 'px'));
    s.appendChild(row('', btn('Edit code…', function () { KH.ui.editCode(el); })));
    s.appendChild(hint('The box is as large as the code: change the size here, or drag a corner to scale it. Double-click (or press ⏎) to edit the code.'));
    return s;
  }
  function htmlSection(el) {
    var s = sec('HTML block');
    s.appendChild(row('', btn('Edit HTML source…', function () { KH.ui.editHtml(el); }), btn('Edit in place', function () { T.enter(el); })));
    s.appendChild(row('Clip', check('Clip overflow', function () { return el.style.overflow !== 'visible'; }, function (v) { applySel(function (e) { e.style.overflow = v ? '' : 'visible'; }); })));
    s.appendChild(row('Fill', colorCtl(function () { return el.style.backgroundColor || el.style.background; }, function (v, live) { applySel(function (e) { e.style.background = v || ''; }, live); }, { none: true })));
    var PV = KH.preview, state = PV.state(el), live = PV.isLive(el);
    var status = !PV.enabled && PV.wants(el) ? 'off (Document ▸ Advanced)' : live ? 'on' : state === 'auto' ? (PV.hasScripts() ? 'off: no canvas, data-demo or script inside' : 'off: the deck has no custom JS') : 'off';
    s.appendChild(row('Preview', sel([['auto', 'Auto'], ['on', 'Always'], ['off', 'Never']], function () { return state; }, function (v) { applySel(function (e) { PV.setState(e, v); }); }), status));
    s.appendChild(hint(live
      ? 'Live preview: the deck is rendered by the player, custom JS included, in an isolated frame over this block — what you see is what Play shows. The picture itself cannot be edited: change the HTML source, the deck\'s custom JS or CSS. Double-click still edits the block\'s text in place (the preview pauses).'
      : 'Arbitrary HTML/CSS. Imported slides from hand-written decks live in blocks like this; double-click to edit the text directly. Blocks whose content is drawn by the deck\'s JavaScript can show a live preview.'));
    return s;
  }

  // ---------------------------------------------------------------- animate
  /* Per-bullet builds (same rules as player.js buildItems/buildUnits). */
  function buildItemCount(e) {
    var body = T.body(e); if (!body || M.type(e) === 'html') return 0;
    var lis = KH.$$('li', body).filter(function (li) { return !li.parentElement.closest('li'); });
    if (lis.length) return lis.length;
    return Array.prototype.filter.call(body.children, function (c) { return !/^(BR|STYLE|SCRIPT)$/.test(c.tagName); }).length;
  }
  function byItems(e) { return e.getAttribute('data-build-items') === '1' && buildItemCount(e) > 0; }
  function buildFrom(e) { return Math.max(1, parseInt(e.getAttribute('data-build-from'), 10) || 1); }
  function lastStep(e) {
    var b = parseInt(e.getAttribute('data-build'), 10) || 0;
    if (!b || !byItems(e)) return b;
    return b + Math.max(0, buildItemCount(e) - buildFrom(e));
  }
  function stepLabel(e) {
    var b = parseInt(e.getAttribute('data-build'), 10) || 0, l = lastStep(e);
    return l > b ? b + '–' + l : String(b);
  }

  /* New builds default to Appear. A built object with no data-build-effect is a fade (older decks). */
  function setBuild(e, n) {
    if (!e.hasAttribute('data-build') && !e.hasAttribute('data-build-effect')) e.setAttribute('data-build-effect', 'appear');
    e.setAttribute('data-build', String(n));
  }
  function clearBuild(e) { e.removeAttribute('data-build'); e.removeAttribute('data-build-effect'); }

  function renderAnimate() {
    var els = C.sel;
    var slide = M.slide();
    if (els.length) {
      var el = els[0];
      var s = sec('Build In');
      s.appendChild(row('Order', stepper(function () { return parseInt(el.getAttribute('data-build'), 10) || 0; }, function (v) {
        applySel(function (e) { if (v > 0) setBuild(e, v); else clearBuild(e); });
      }, { min: 0, max: 99 }), '(0 = no build)'));
      s.appendChild(row('Effect', sel([['appear', 'Appear'], ['fade', 'Fade in'], ['rise', 'Rise'], ['pop', 'Pop'], ['slide-left', 'Slide from right']],
        function () { return el.getAttribute('data-build-effect') || (el.hasAttribute('data-build') ? 'fade' : 'appear'); }, function (v) { applySel(function (e) { e.setAttribute('data-build-effect', v); }); })));
      var nItems = els.length === 1 ? buildItemCount(el) : 0;
      if (nItems > 1) {
        s.appendChild(row('', check('Build by bullet (one per click)', function () { return el.getAttribute('data-build-items') === '1'; }, function (v) {
          applySel(function (e) {
            if (v) {
              e.setAttribute('data-build-items', '1');
              if (!(parseInt(e.getAttribute('data-build'), 10) > 0)) {
                var n = 1; M.elements(slide).forEach(function (o) { if (o !== e) n = Math.max(n, lastStep(o) + 1); });
                setBuild(e, n);
              }
            } else { e.removeAttribute('data-build-items'); e.removeAttribute('data-build-from'); }
          });
        })));
        if (el.getAttribute('data-build-items') === '1') {
          s.appendChild(row('Start at', stepper(function () { return buildFrom(el); }, function (v) {
            applySel(function (e) { if (v > 1) e.setAttribute('data-build-from', String(v)); else e.removeAttribute('data-build-from'); });
          }, { min: 1, max: nItems }), 'of ' + nItems));
          var b = parseInt(el.getAttribute('data-build'), 10) || 0, k = buildFrom(el);
          s.appendChild(hint((k > 1 ? 'Bullets 1–' + (k - 1) + ' show from the start. ' : '') +
            'Bullet ' + k + (nItems > k ? '–' + nItems : '') + ' appear' + (nItems > k ? '' : 's') + ' on click' + (nItems > k ? 's ' + b + '–' + lastStep(el) : ' ' + b) +
            '. Lines count as bullets in a box without a list. Use the Fade in effect for a fade.'));
        }
      }
      s.appendChild(row('', btn('Build selected in sequence', function () {
        var start = 0;
        M.elements(slide).forEach(function (e) { if (C.sel.indexOf(e) < 0) start = Math.max(start, lastStep(e)); });
        var ordered = M.elements(slide).filter(function (e) { return C.sel.indexOf(e) >= 0; });
        ordered.forEach(function (e) { setBuild(e, start + 1); start = lastStep(e); });
        C.renderSelection(); M.history.push();
      }), btn('Same step', function () {
        var n = 1; M.elements(slide).forEach(function (e) { if (C.sel.indexOf(e) < 0) n = Math.max(n, lastStep(e) + 1); });
        applySel(function (e) { setBuild(e, n); });
      })));
      s.appendChild(hint('Objects with build order N appear on the Nth click. The orange badge on the canvas shows the order. Several objects may share a step.'));
      body.appendChild(s);
    }
    var list = sec('Builds on this slide');
    var built = M.elements(slide).filter(function (e) { return (parseInt(e.getAttribute('data-build'), 10) || 0) > 0; })
      .sort(function (a, b) { return parseInt(a.getAttribute('data-build'), 10) - parseInt(b.getAttribute('data-build'), 10); });
    if (!built.length) list.appendChild(hint('No builds. Select objects and set a build order.'));
    built.forEach(function (e) {
      var label = M.type(e) + ': ' + (e.textContent.trim().slice(0, 28) || (e.querySelector('img') ? basename(e.querySelector('img').getAttribute('src')) : ''));
      var r = h('div', { class: 'insp-row' }, h('span', { style: { minWidth: '22px', marginRight: '4px', fontWeight: '600', color: '#ff9500' } }, stepLabel(e)),
        h('span', { style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }, onclick: function () { C.select([e]); } }, label),
        btn('×', function () { clearBuild(e); M.history.push(); }));
      list.appendChild(r);
    });
    if (built.length) list.appendChild(row('', btn('Clear all builds', function () { built.forEach(clearBuild); M.history.push(); })));
    body.appendChild(list);
    var tr = sec('Transition');
    tr.appendChild(row('This slide', sel([['', 'Deck default'], ['none', 'None'], ['fade', 'Fade'], ['push', 'Push'], ['zoom', 'Zoom']],
      function () { return slide.getAttribute('data-transition') || ''; }, function (v) { if (v) slide.setAttribute('data-transition', v); else slide.removeAttribute('data-transition'); M.history.push(); })));
    body.appendChild(tr);
  }

  // ---------------------------------------------------------------- document
  function themeMatch() {
    for (var k in THEMES) {
      var ok = true;
      for (var key in THEMES[k]) if ((KH.toHex(M.theme(key)) || '') !== THEMES[k][key]) ok = false;
      if (ok) return k;
    }
    return 'custom';
  }
  function docChange() { KH.emit('theme'); M.history.push(); }
  function renderDocument() {
    var s = sec('Presentation');
    var title = h('input', { type: 'text', value: M.title });
    title.addEventListener('change', function () { M.title = title.value; KH.io.markDirty(); });
    s.appendChild(row('Title', title));
    s.appendChild(row('Slide size', sel([['1920x1080', '1920 × 1080 (16:9)'], ['1920x1200', '1920 × 1200 (16:10)'], ['1600x1200', '1600 × 1200 (4:3)'], ['3840x2160', '3840 × 2160 (4K)']],
      function () { return M.W + 'x' + M.H; }, function (v) { var p = v.split('x'); M.setSize(parseInt(p[0], 10), parseInt(p[1], 10)); C.fit(); KH.nav.refresh(); docChange(); })));
    s.appendChild(row('Transition', sel([['none', 'None'], ['fade', 'Fade'], ['push', 'Push'], ['zoom', 'Zoom']], function () { return M.setting('transition') || 'none'; }, function (v) { M.setting('transition', v === 'none' ? null : v); docChange(); })));
    s.appendChild(row('', check('Show slide numbers', function () { return M.setting('slide-numbers') === '1'; }, function (v) { M.setting('slide-numbers', v ? '1' : null); docChange(); })));
    body.appendChild(s);

    var th = sec('Theme');
    th.appendChild(row('Preset', sel([['light', 'Light'], ['dark', 'Dark'], ['slate', 'Slate'], ['warm', 'Warm'], ['custom', 'Custom']], themeMatch, function (v) {
      if (!THEMES[v]) return;
      for (var key in THEMES[v]) M.theme(key, THEMES[v][key]);
      docChange(); I.refresh();
    })));
    [['--kh-bg', 'Background'], ['--kh-color', 'Text'], ['--kh-accent', 'Accent'], ['--kh-muted', 'Muted']].forEach(function (k) {
      th.appendChild(row(k[1], colorCtl(function () { return M.theme(k[0]); }, function (v, live) { M.theme(k[0], v || '#000000'); if (!live) docChange(); })));
    });
    th.appendChild(row('Font', sel(FONTS, function () { return matchFont(M.theme('--kh-font')); }, function (v) { M.theme('--kh-font', v); docChange(); })));
    th.appendChild(row('Headings', sel(FONTS, function () { return matchFont(M.theme('--kh-heading-font') || M.theme('--kh-font')); }, function (v) { M.theme('--kh-heading-font', v); docChange(); })));
    th.appendChild(hint('Theme colors apply to slides and text that have no explicit color. Imported decks keep their own CSS (below), which overrides the theme.'));
    body.appendChild(th);

    var tex = sec('LaTeX');
    tex.appendChild(stack('Macros / preamble (applies to every equation)', ta(function () { return M.macros; }, function (v) { M.macros = v; KH.math.rerenderAll(); M.history.push(); }, 'tex', '\\newcommand{\\Msun}{M_\\odot}')));
    body.appendChild(tex);

    var adv = sec('Advanced');
    adv.appendChild(stack('Custom CSS (scoped to the deck)', ta(function () { return M.customCss; }, function (v) { M.customCss = v; KH.io.applyCustomCss(); KH.nav.refresh(); M.history.push(); }, '', '.kh-slide h1 { letter-spacing: -0.02em }')));
    adv.appendChild(stack('Custom JavaScript (runs when presenting)', ta(function () { return M.customJs; }, function (v) { M.customJs = v; M.history.push(); }, '', "document.addEventListener('kh:slide', e => { /* e.detail.index, e.detail.slide */ });")));
    adv.appendChild(stack('External scripts (one path per line, relative to the deck)', ta(function () { return (M.scripts || []).join('\n'); }, function (v) { M.scripts = v.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean); M.history.push(); }, '', 'data/my_data.js')));
    adv.appendChild(hint('Hooks while presenting: kh:ready, kh:slide (detail: index, step, slide), kh:next / kh:prev (cancelable), and window.khPlayer. In the editor, custom JS runs only inside the isolated live preview laid over HTML blocks that hold a canvas, a data-demo or a script.'));
    body.appendChild(adv);

    var act = sec('Actions');
    act.appendChild(btn('▶ Play from start', function () { KH.io.play(true); }, 'block'));
    act.appendChild(btn('Print / save as PDF…', KH.io.print, 'block'));
    act.appendChild(btn('Export standalone HTML…', KH.io.exportStandalone, 'block'));
    act.appendChild(btn('Save a copy as…', KH.io.saveAs, 'block'));
    if (KH.info && KH.info.platform === 'darwin') act.appendChild(btn('Reveal in Finder', KH.io.reveal, 'block'));
    act.appendChild(hint('File: ' + (M.file || '—') + (KH.info ? '\nRoot: ' + KH.info.root + '\nPDF converter: ' + (KH.info.pdf_backend || 'none') : '')));
    body.appendChild(act);
  }
  return I;
})();
