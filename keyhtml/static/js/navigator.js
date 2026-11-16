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
      { label: 'Duplicate', shortcut: '⌘D', disabled: i < 0, action: function () { N.duplicate(sel); } },
      { label: 'Delete', shortcut: '⌫', disabled: i < 0, action: function () { N.remove(sel); } },
      { sep: true },
      { label: skipped ? 'Don’t Skip Slide' : 'Skip Slide', disabled: i < 0, action: function () { N.toggleSkip(sel); } },
    ], e.clientX, e.clientY);
  }
  function onKeyDown(e) {
    var mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); N.remove(N.selected); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); N.duplicate(N.selected); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      var i = KH.clamp(M.cur + (e.key === 'ArrowUp' ? -1 : 1), 0, M.slides().length - 1);
      if (e.shiftKey) { if (N.selected.indexOf(i) < 0) N.selected.push(i); M.setCurrent(i); N.highlight(); } else N.goto(i);
    } else if (mod && e.key === 'a') { e.preventDefault(); e.stopPropagation(); N.selected = M.slides().map(function (_, k) { return k; }); N.highlight(); }
  }
  window.addEventListener('resize', KH.debounce(scaleThumbs, 100));
  return N;
})();
