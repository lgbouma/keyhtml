/* keyhtml editor — slide navigator (thumbnails, reorder by drag, slide operations). */
KH.nav = (function () {
  var N = { selected: [] };
  var M = KH.model, h = KH.h;
  var list, dragState = null;

  N.init = function () {
    list = KH.$('#nav-list');
    list.setAttribute('tabindex', '0');
    KH.$('#nav-add').addEventListener('click', function (e) { KH.ui.layoutPicker(e.currentTarget); });
    list.addEventListener('mousedown', onMouseDown);
    list.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    list.addEventListener('keydown', onKeyDown);
    KH.on('change', function (ev) { if (ev && ev.restored) N.refresh(); else N.refreshCurrentDebounced(); });
    KH.on('slide', N.highlight);
    KH.on('textinput', N.refreshCurrentDebounced);
    KH.on('geom', N.refreshCurrentDebounced);
    KH.on('load', N.refresh);
    KH.on('theme', N.refresh);
  };

  function makeThumb(slide) {
    var deck = M.deck;
    var t = h('div', { class: 'kh-deck nav-thumb' });
    t.setAttribute('style', deck.getAttribute('style') || '');
    t.style.width = M.W + 'px'; t.style.height = M.H + 'px';
    var c = slide.cloneNode(true);
    c.classList.add('kh-current'); c.classList.remove('kh-drop-target');
    KH.$$('[contenteditable]', c).forEach(function (b) { b.removeAttribute('contenteditable'); });
    KH.$$('.kh-editing', c).forEach(function (b) { b.classList.remove('kh-editing'); });
    KH.$$('video,audio', c).forEach(function (v) {
      var ph = h('div', { class: 'nav-video-placeholder' }, '▶');
      v.parentNode.replaceChild(ph, v);
    });
    KH.$$('[id]', c).forEach(function (x) { x.removeAttribute('id'); });
    KH.$$('iframe', c).forEach(function (f) { f.removeAttribute('src'); });
    t.appendChild(c);
    return t;
  }
  function scaleThumbs() {
    var frame = list.querySelector('.nav-frame');
    if (!frame) return;
    var s = frame.clientWidth / M.W;
    KH.$$('.nav-thumb', list).forEach(function (t) { t.style.transform = 'scale(' + s + ')'; });
  }
  N.refresh = function () {
    if (!M.deck) return;
    var scrollTop = list.scrollTop;
    list.innerHTML = '';
    M.slides().forEach(function (slide, i) {
      var item = h('div', { class: 'nav-item', 'data-i': String(i) },
        h('div', { class: 'nav-num' }, String(i + 1)),
        h('div', { class: 'nav-frame' }, makeThumb(slide)));
      if (slide.hasAttribute('data-skip')) item.classList.add('skipped');
      list.appendChild(item);
    });
    scaleThumbs();
    N.highlight();
    list.scrollTop = scrollTop;
  };
  N.refreshSlide = function (i) {
    var item = list.querySelector('.nav-item[data-i="' + i + '"]');
    var slide = M.slides()[i];
    if (!item || !slide) { N.refresh(); return; }
    var frame = item.querySelector('.nav-frame');
    frame.innerHTML = ''; frame.appendChild(makeThumb(slide));
    item.classList.toggle('skipped', slide.hasAttribute('data-skip'));
    scaleThumbs();
  };
  N.refreshCurrentDebounced = KH.debounce(function () {
    if (list.querySelectorAll('.nav-item').length !== M.slides().length) N.refresh(); else N.refreshSlide(M.cur);
  }, 250);
  N.highlight = function () {
    KH.$$('.nav-item', list).forEach(function (it, i) {
      it.classList.toggle('current', i === M.cur);
      it.classList.toggle('selected', N.selected.indexOf(i) >= 0 && i !== M.cur);
    });
    var cur = list.querySelector('.nav-item.current');
    if (cur && cur.scrollIntoViewIfNeeded) cur.scrollIntoViewIfNeeded(false);
    else if (cur) cur.scrollIntoView({ block: 'nearest' });
  };
  N.goto = function (i) {
    i = KH.clamp(i, 0, M.slides().length - 1);
    if (KH.text.editing) KH.text.exit();
    N.selected = [i];
    M.setCurrent(i);
    N.highlight();
  };

  // ------------------------------------------------------------ operations
  N.addSlide = function (layout, at) {
    if (KH.text.editing) KH.text.exit();
    M.addSlide(layout || 'title-bullets', at);
    N.selected = [M.cur];
    M.history.push();
    N.refresh();
  };
  N.duplicate = function (indices) {
    if (KH.text.editing) KH.text.exit();
    indices = (indices || N.selected).slice().sort(function (a, b) { return b - a; });
    indices.forEach(function (i) { M.duplicateSlide(i); });
    M.history.push(); N.refresh();
  };
  N.remove = function (indices) {
    if (KH.text.editing) KH.text.exit(true);
    indices = (indices || N.selected).slice().sort(function (a, b) { return b - a; });
    if (!indices.length) return;
    M.deleteSlides(indices);
    N.selected = [M.cur];
    M.history.push(); N.refresh();
  };
  N.toggleSkip = function (indices) {
    var slides = M.slides();
    (indices || N.selected).forEach(function (i) { var s = slides[i]; if (s.hasAttribute('data-skip')) s.removeAttribute('data-skip'); else s.setAttribute('data-skip', '1'); });
    M.history.push(); N.refresh();
  };
  N.move = function (indices, to) {
    M.moveSlides(indices, to);
    N.selected = [M.cur];
    M.history.push(); N.refresh();
  };

  // ------------------------------------------------------------ clipboard
  /* ⌘C / ⌘X with the keyboard focus in the navigator copy the selected slides (not the objects that
     happen to be selected on the current slide); ⌘V pastes copied slides after the current one, from
     the navigator or the canvas, also into another deck open in another editor tab. */
  var CLIP = 'application/x-keyhtml-slides';
  /* "In the navigator" = the last click went there. The keyboard focus alone will not do: it stays on the
     list when an object on the slide is clicked afterwards. */
  var navActive = false;
  document.addEventListener('mousedown', function (e) { navActive = !!list && list.contains(e.target); }, true);
  document.addEventListener('focusin', function (e) { if (e.target === list) navActive = true; }, true);
  function inList() { return navActive && document.activeElement === list; }
  function inField(t) { return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function selection() {
    var n = M.slides().length;
    var s = N.selected.filter(function (i, k, a) { return i >= 0 && i < n && a.indexOf(i) === k; }).sort(function (a, b) { return a - b; });
    return s.length ? s : [M.cur];
  }
  N.copy = function (indices) {
    if (KH.text.editing) KH.text.exit();
    var slides = M.slides();
    indices = (indices || selection()).slice().sort(function (a, b) { return a - b; });
    var texts = [];
    var htmls = indices.map(function (i) {
      var c = slides[i].cloneNode(true);
      c.classList.remove('kh-current', 'kh-leaving', 'kh-enter', 'kh-drop-target');
      c.removeAttribute('data-kh-conflict');
      KH.$$('[contenteditable]', c).forEach(function (b) { b.removeAttribute('contenteditable'); });
      KH.$$('.kh-editing', c).forEach(function (b) { b.classList.remove('kh-editing'); });
      texts.push(KH.$$('.kh-el', c).map(function (el) { return el.textContent.trim(); }).filter(Boolean).join('\n'));
      return c.outerHTML;
    });
    N.clipboard = JSON.stringify({ keyhtml: 1, slides: htmls });
    N.clipboardText = texts.filter(Boolean).join('\n\n');
    return N.clipboard;
  };
  /* Insert copied slides after the selected ones (after the current slide when nothing else is selected). */
  N.paste = function (payload) {
    var htmls;
    try { htmls = JSON.parse(payload || N.clipboard).slides; } catch (e) { return false; }
    if (!htmls || !htmls.length) return false;
    if (KH.text.editing) KH.text.exit();
    var sel = selection(), at = sel[sel.length - 1] + 1, first = at;
    var tpl = document.createElement('template');
    htmls.forEach(function (html) {
      tpl.innerHTML = html;
      var s = tpl.content.firstElementChild;
      if (!s || !s.classList.contains('kh-slide')) return;
      s = document.importNode(s, true);
      s.classList.remove('kh-current');
      s.setAttribute('data-kh-id', M.newSlideId()); // a copy is a new slide (see model.js)
      var slides = M.slides();
      if (at >= slides.length) M.deck.appendChild(s); else M.deck.insertBefore(s, slides[at]);
      at++;
    });
    if (at === first) return false;
    N.selected = [];
    for (var k = first; k < at; k++) N.selected.push(k);
    M.setCurrent(first);
    M.history.push(); N.refresh();
    return true;
  };
  function onCopy(e) {
    if (!inList() || !M.deck || (KH.ui && KH.ui.modalOpen())) return;
    var payload = N.copy();
    try { e.clipboardData.setData('text/plain', N.clipboardText || ' '); e.clipboardData.setData(CLIP, payload); } catch (err) {}
    e.preventDefault(); e.stopImmediatePropagation(); // not the canvas: it would copy the selected objects instead
    if (e.type === 'cut') N.remove(selection());
  }
  function onPaste(e) {
    if (!M.deck || KH.text.editing || (inField(e.target) && e.target !== list) || (KH.ui && KH.ui.modalOpen())) return;
    var cd = e.clipboardData, data = '', text = '';
    try { data = cd.getData(CLIP); text = cd.getData('text/plain'); } catch (err) {}
    // copied with the context menu (no clipboard event): the slides are only in N.clipboard
    if (!data && inList() && N.clipboard && (!text || text === N.clipboardText)) data = N.clipboard;
    if (!data) return;
    e.preventDefault(); e.stopImmediatePropagation();
    N.paste(data);
  }
  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);
  document.addEventListener('paste', onPaste, true);

  // ------------------------------------------------------------ mouse
  function itemIndex(e) { var it = e.target.closest('.nav-item'); return it ? parseInt(it.getAttribute('data-i'), 10) : -1; }
  function onMouseDown(e) {
    if (e.button !== 0) return;
    var i = itemIndex(e);
    list.focus();
    if (i < 0) return;
    e.preventDefault();
    if (e.shiftKey) {
      var a = Math.min(M.cur, i), b = Math.max(M.cur, i); N.selected = [];
      for (var k = a; k <= b; k++) N.selected.push(k);
      N.highlight();
    } else if (e.metaKey || e.ctrlKey) {
      var p = N.selected.indexOf(i); if (p >= 0) N.selected.splice(p, 1); else N.selected.push(i);
      if (N.selected.indexOf(M.cur) < 0 && N.selected.length) N.goto(N.selected[0]); else N.highlight();
    } else {
      if (N.selected.indexOf(i) < 0 || N.selected.length <= 1) N.goto(i);
    }
    dragState = { startY: e.clientY, moving: false, indices: N.selected.slice().sort(function (a, b) { return a - b; }) };
    // a plain click on one of several selected slides: they stay selected for a drag, else it selects just that one
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey && N.selected.length > 1) dragState.single = i;
  }
  function onMouseMove(e) {
    if (!dragState) return;
    if (!dragState.moving) { if (Math.abs(e.clientY - dragState.startY) < 5) return; dragState.moving = true; }
    var items = KH.$$('.nav-item', list), to = items.length;
    for (var k = 0; k < items.length; k++) {
      var r = items[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { to = k; break; }
    }
    dragState.to = to;
    var ind = list.querySelector('.nav-drop-indicator');
    if (!ind) { ind = h('div', { class: 'nav-drop-indicator' }); list.appendChild(ind); }
    var y;
    if (to < items.length) y = items[to].offsetTop - 2; else { var last = items[items.length - 1]; y = last ? last.offsetTop + last.offsetHeight : 0; }
    ind.style.top = y + 'px';
  }
  function onMouseUp() {
    if (!dragState) return;
    var d = dragState; dragState = null;
    var ind = list.querySelector('.nav-drop-indicator'); if (ind) ind.remove();
    if (!d.moving && d.single != null) { N.goto(d.single); return; }
    if (!d.moving || d.to == null) return;
    var to = d.to;
    var allBefore = d.indices.every(function (i) { return i < to; });
    var allAfter = d.indices.every(function (i) { return i >= to; });
    if (d.indices.length && (d.indices[0] === to || (allBefore && d.indices[d.indices.length - 1] === to - 1))) return;
    N.move(d.indices, to);
  }
  function onContextMenu(e) {
    e.preventDefault();
    var i = itemIndex(e);
    if (i >= 0 && N.selected.indexOf(i) < 0) N.goto(i);
    var sel = N.selected.slice();
    var skipped = i >= 0 && M.slides()[i].hasAttribute('data-skip');
    KH.ui.contextMenu([
      { label: 'New Slide', shortcut: '⇧⌘N', action: function () { N.addSlide(); } },
      { label: 'Cut', shortcut: '⌘X', disabled: i < 0, action: function () { N.copy(sel); N.remove(sel); } },
      { label: 'Copy', shortcut: '⌘C', disabled: i < 0, action: function () { N.copy(sel); } },
      { label: 'Paste', shortcut: '⌘V', disabled: !N.clipboard, action: function () { N.paste(); } },
      { label: 'Duplicate', shortcut: '⌘D', disabled: i < 0, action: function () { N.duplicate(sel); } },
      { label: 'Delete', shortcut: '⌫', disabled: i < 0, action: function () { N.remove(sel); } },
      { sep: true },
      { label: skipped ? 'Don’t Skip Slide' : 'Skip Slide', disabled: i < 0, action: function () { N.toggleSkip(sel); } },
    ], e.clientX, e.clientY);
  }
  function onKeyDown(e) {
    // The list keeps the keyboard focus when an object on the slide is clicked afterwards. Those keys
    // belong to the canvas (⌫ deletes the object, not the slide; arrows nudge it): let them pass.
    if (!navActive) return;
    var mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); N.remove(N.selected); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); N.duplicate(N.selected); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      var i = KH.clamp(M.cur + (e.key === 'ArrowUp' ? -1 : 1), 0, M.slides().length - 1);
      if (e.shiftKey) { if (N.selected.indexOf(i) < 0) N.selected.push(i); M.setCurrent(i); N.highlight(); } else N.goto(i);
    } else if (mod && e.key === 'a') { e.preventDefault(); e.stopPropagation(); N.selected = M.slides().map(function (_, k) { return k; }); N.highlight(); }
  }
  N.scaleThumbs = function () { if (list) scaleThumbs(); };
  window.addEventListener('resize', KH.debounce(scaleThumbs, 100));
  return N;
})();
