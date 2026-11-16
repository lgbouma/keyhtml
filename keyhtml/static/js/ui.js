/* keyhtml editor — popovers, menus, modals and the equation / HTML editors. */
KH.ui = (function () {
  var U = {};
  var h = KH.h, M = KH.model;
  var layer, modalLayer, openPop = null, modalStack = [];

  U.init = function () {
    layer = KH.$('#popover-layer'); modalLayer = KH.$('#modal-layer');
    document.addEventListener('mousedown', function (e) {
      if (openPop && !openPop.contains(e.target) && !(openPop.anchor && openPop.anchor.contains(e.target))) U.closePopovers();
    }, true);
    window.addEventListener('blur', function () { U.closePopovers(); });
  };

  // ---------------------------------------------------------------- popovers
  U.popover = function (anchor, content, opts) {
    opts = opts || {};
    U.closePopovers();
    var pop = h('div', { class: 'popover' });
    pop.appendChild(content);
    layer.appendChild(pop);
    var x, y;
    if (opts.x != null) { x = opts.x; y = opts.y; }
    else { var r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 4; }
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    requestAnimationFrame(function () {
      var pr = pop.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) pop.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
      if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, (opts.x != null ? y - pr.height : window.innerHeight - pr.height - 8)) + 'px';
    });
    pop.anchor = anchor;
    openPop = pop;
    return pop;
  };
  U.closePopovers = function () { if (!openPop) return false; openPop.remove(); openPop = null; return true; };
  U.menu = function (items) {
    var m = h('div', { class: 'menu' });
    items.forEach(function (it) {
      if (it.sep) { m.appendChild(h('div', { class: 'menu-sep' })); return; }
      var row = h('div', { class: 'menu-item' + (it.disabled ? ' disabled' : '') + (it.checked ? ' checked' : '') }, (it.checked ? '✓ ' : '') + it.label);
      if (it.shortcut) row.appendChild(h('span', { class: 'shortcut' }, it.shortcut));
      row.addEventListener('mouseup', function (e) { e.stopPropagation(); U.closePopovers(); setTimeout(function () { it.action && it.action(); }, 0); });
      m.appendChild(row);
    });
    return m;
  };
  U.contextMenu = function (items, x, y) { return U.popover(null, U.menu(items), { x: x, y: y }); };
  U.dropdown = function (anchor, items) { return U.popover(anchor, U.menu(items)); };

  // ---------------------------------------------------------------- modals
  U.modal = function (o) {
    var el = h('div', { class: 'modal', style: o.width ? { width: o.width } : null });
    var head = h('div', { class: 'modal-head' }, o.title || '');
    var body = h('div', { class: 'modal-body' });
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    var foot = h('div', { class: 'modal-foot' });
    var api = { el: el, body: body };
    api.close = function () {
      var i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
      el.remove();
      if (!modalStack.length) modalLayer.classList.remove('on');
      document.removeEventListener('keydown', onKey, true);
      if (o.onClose) o.onClose();
    };
    (o.buttons || [{ label: 'Close', close: true }]).forEach(function (b) {
      var btn = h('button', { class: 'mbtn' + (b.primary ? ' primary' : '') }, b.label);
      btn.addEventListener('click', function () { var r = b.action ? b.action(api) : undefined; if (b.close !== false && r !== false) api.close(); });
      if (b.primary) api.primary = btn;
      foot.appendChild(btn);
    });
    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== api) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && api.primary) { e.preventDefault(); e.stopPropagation(); api.primary.click(); }
      else if (e.key === 'Enter' && api.primary && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); e.stopPropagation(); api.primary.click(); }
    }
    document.addEventListener('keydown', onKey, true);
    el.appendChild(head); el.appendChild(body); el.appendChild(foot);
    modalLayer.appendChild(el);
    modalLayer.classList.add('on');
    modalStack.push(api);
    setTimeout(function () { var f = body.querySelector('textarea,input'); if (f) { f.focus(); if (f.select && o.selectAll) f.select(); } }, 0);
    return api;
  };
  U.modalOpen = function () { return modalStack.length > 0; };
  U.prompt = function (title, label, value) {
    return new Promise(function (resolve) {
      var input = h('input', { type: 'text', value: value || '' });
      var body = h('div', {}, h('div', { class: 'hint', style: { marginBottom: '6px' } }, label || ''), input);
      U.modal({ title: title, body: body, selectAll: true, onClose: function () { resolve(null); },
        buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: function (api) { var v = input.value; api.close(); resolve(v); return false; } }] });
    });
  };
  U.confirm = function (title, text, okLabel) {
    return new Promise(function (resolve) {
      var done = false;
      U.modal({ title: title, body: h('div', { style: { fontSize: '13px', lineHeight: '1.5' } }, text), onClose: function () { if (!done) resolve(false); },
        buttons: [{ label: 'Cancel' }, { label: okLabel || 'OK', primary: true, action: function () { done = true; resolve(true); } }] });
    });
  };
  U.toast = KH.toast;

  // ---------------------------------------------------------------- equation editor
  U.editEquation = function (el) {
    var tex = el ? (el.getAttribute('data-tex') || '') : '';
    var ta = h('textarea', { class: 'tex', spellcheck: 'false', style: { minHeight: '110px' } });
    ta.value = tex;
    var preview = h('div', { class: 'preview' });
    var err = h('div', { class: 'error' });
    var render = KH.debounce(function () {
      var r = KH.math.svg(ta.value.trim() || '\\ ', true);
      preview.innerHTML = ''; preview.appendChild(r.svg);
      err.textContent = r.error || '';
    }, 120);
    ta.addEventListener('input', render);
    render();
    var body = h('div', {}, ta, preview, err,
      h('div', { class: 'hint' }, 'Display-mode LaTeX (MathJax). Macros from the Document tab apply. In text boxes you can also type inline math as $x^2$ or display math as $$\\int f$$ — it renders when you finish editing.'));
    U.modal({ title: el ? 'Edit Equation' : 'Insert Equation', body: body, width: '640px',
      buttons: [{ label: 'Cancel' }, { label: el ? 'Apply' : 'Insert', primary: true, action: function () {
        var t = ta.value.trim();
        if (!t) return;
        if (el) {
          el.setAttribute('data-tex', t);
          KH.math.renderElement(el, false);
          KH.canvas.renderSelection();
          M.history.push();
        } else {
          var m = M.create.math({ tex: t, fs: 60 });
          var g = M.geom(m);
          var w = KH.px(m.style.width), hh = KH.px(m.style.height);
          KH.canvas.centerAt(m, w, hh);
          KH.canvas.insert(m);
        }
      } }] });
  };

  // ---------------------------------------------------------------- html source editor
  U.editHtml = function (el) {
    var ta = h('textarea', { spellcheck: 'false', style: { minHeight: '320px', fontSize: '12px' } });
    ta.value = el ? el.innerHTML : '<div style="padding:24px;font-size:40px">Hello <b>HTML</b></div>';
    var body = h('div', {}, ta, h('div', { class: 'hint' }, 'Any HTML works here: tables, iframes (e.g. YouTube embeds), custom markup. Sizes are in px of the 1920×1080 slide. Double-click the block on the slide to edit its text in place.'));
    U.modal({ title: el ? 'Edit HTML' : 'Insert HTML', body: body, width: '720px',
      buttons: [{ label: 'Cancel' }, { label: el ? 'Apply' : 'Insert', primary: true, action: function () {
        if (el) { el.innerHTML = ta.value; KH.canvas.renderSelection(); M.history.push(); }
        else { var n = M.create.html({ html: ta.value }); KH.canvas.insert(n); }
      } }] });
  };

  U.toggleVideoPreview = function (el) {
    var v = el.querySelector('video,audio'); if (!v) return;
    if (v.paused) { v.muted = false; var p = v.play(); if (p && p.catch) p.catch(function () { KH.toast('Could not play this file in the browser', 'error'); }); }
    else { v.pause(); }
  };

  // ---------------------------------------------------------------- pickers
  U.layoutPicker = function (anchor, cb) {
    var grid = h('div', { class: 'layout-grid' });
    KH.layouts.defs.forEach(function (d) {
      var lp = h('div', { class: 'lp' + (d.bg ? ' bg' : '') });
      if (d.bg) lp.style.background = '#0a84ff';
      d.preview.forEach(function (b) {
        lp.appendChild(h('div', { style: { left: (b[0] / 16) + 'px', top: (b[1] / 16) + 'px', width: (b[2] / 16) + 'px', height: (b[3] / 16) + 'px', background: d.bg ? 'rgba(255,255,255,.7)' : null } }));
      });
      var item = h('div', { class: 'layout-item' }, lp, d.name);
      item.addEventListener('click', function () { U.closePopovers(); (cb || KH.nav.addSlide)(d.id); });
      grid.appendChild(item);
    });
    U.popover(anchor, grid);
  };
  U.shapePicker = function (anchor) {
    var grid = h('div', { class: 'shape-grid' });
    KH.shapes.types.forEach(function (t) {
      var item = h('div', { class: 'shape-item', title: t.name });
      item.innerHTML = '<svg viewBox="0 0 28 28" fill="' + (/line|arrow$/.test(t.id) && t.id !== 'rarrow' && t.id !== 'larrow' ? 'none' : '#4a90d9') + '" stroke="#2d6fb5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">' + t.svg + '</svg>';
      item.addEventListener('click', function () { U.closePopovers(); KH.toolbar.insertShape(t.id); });
      grid.appendChild(item);
    });
    U.popover(anchor, grid);
  };

  // ---------------------------------------------------------------- open / new dialog
  U.openDialog = function (opts) {
    opts = opts || {};
    var crumb = h('div', { class: 'file-crumb' });
    var list = h('div', { class: 'file-list' });
    var nameInput = h('input', { type: 'text', placeholder: 'new-talk.html' });
    var curDir = opts.dir || '';
    function load(dir) {
      curDir = dir;
      KH.io.api('/api/list?dir=' + encodeURIComponent(dir)).then(function (res) {
        crumb.textContent = res.root + (dir ? '/' + dir : '');
        list.innerHTML = '';
        if (dir) {
          var up = h('div', { class: 'file-row dir' }, '⬑ ..');
          up.addEventListener('click', function () { load(dir.split('/').slice(0, -1).join('/')); });
          list.appendChild(up);
        }
        res.dirs.forEach(function (d) {
          var row = h('div', { class: 'file-row dir' }, '📁 ' + d);
          row.addEventListener('click', function () { load(dir ? dir + '/' + d : d); });
          list.appendChild(row);
        });
        res.decks.forEach(function (f) {
          var row = h('div', { class: 'file-row' }, '📄 ' + f.name, h('span', { class: 'meta' }, KH.fmtBytes(f.size) + ' · ' + new Date(f.mtime * 1000).toLocaleDateString()));
          row.addEventListener('click', function () { api.close(); KH.io.openFile(dir ? dir + '/' + f.name : f.name); });
          list.appendChild(row);
        });
        if (!res.dirs.length && !res.decks.length) list.appendChild(h('div', { class: 'file-row', style: { color: '#999' } }, 'No .html files here yet'));
      }).catch(function (e) { KH.toast(String(e.message || e), 'error'); });
    }
    var body = h('div', {},
      h('div', { style: { fontWeight: '600', marginBottom: '4px' } }, 'Open a presentation'), crumb, list,
      h('div', { style: { fontWeight: '600', margin: '14px 0 4px' } }, 'Or create a new one'),
      h('div', { style: { display: 'flex', gap: '8px' } }, nameInput, h('button', { class: 'mbtn primary', onclick: function () { createNew(); } }, 'Create')),
      h('div', { class: 'hint' }, 'Existing .html files that are not keyhtml decks are imported: each <section> becomes a slide you can edit in place.'));
    function createNew() {
      var name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      if (!/\.html?$/i.test(name)) name += '.html';
      api.close();
      KH.io.openFile(curDir ? curDir + '/' + name : name);
    }
    nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); createNew(); } });
    var api = U.modal({ title: 'keyhtml', body: body, width: '560px', buttons: opts.cancelable === false ? [] : [{ label: 'Cancel' }] });
    load(curDir);
  };

  U.shortcuts = function () {
    var rows = [
      ['⌘S', 'Save'], ['⌘Z / ⇧⌘Z', 'Undo / redo'], ['⌘O', 'Open / new presentation'], ['⌥⌘P', 'Play from current slide'],
      ['T', 'New text box'], ['⏎', 'Edit selected text'], ['Esc', 'Stop editing / deselect'], ['⌘⏎', 'Finish editing'],
      ['⌘A', 'Select all on slide'], ['⌘D', 'Duplicate (or duplicate slide)'], ['⌘C ⌘X ⌘V', 'Copy, cut, paste (also images from the clipboard)'],
      ['⌫', 'Delete selection'], ['Arrows', 'Nudge 1 px (⇧ 10 px); with nothing selected: change slide'], ['⇧-drag', 'Constrain move; keep aspect while resizing'],
      ['⌥-drag', 'Duplicate while dragging; hold ⌥ to disable snapping'], ['⌘] / ⌘[', 'Bring forward / send backward (⇧ to front / back)'], ['⌘L', 'Lock / unlock'],
      ['⌘G / ⇧⌘G', 'Group / ungroup (double-click a group to select an object inside; Esc steps out)'],
      ['⌘K or ⏎', 'Crop the selected image (also double-click it); drag to pan, handles set the window'],
      ['⌘B ⌘I ⌘U', 'Bold, italic, underline'], ['⌥⌘0', 'Reset text color to the deck default'], ['⇧⌘N', 'New slide'], ['⌘= / ⌘- / ⌘0', 'Zoom in / out / fit'], ['$…$', 'Inline LaTeX in any text box; $$…$$ for display math'],
      ['Right-click', 'Context menu on objects, slides and the navigator'],
    ];
    var body = h('div', { style: { fontSize: '12.5px', lineHeight: '1.6', columns: '2', columnGap: '28px' } });
    rows.forEach(function (r) { body.appendChild(h('div', { style: { breakInside: 'avoid' } }, h('span', { class: 'kbd', style: { marginRight: '8px', minWidth: '70px', display: 'inline-block', textAlign: 'center' } }, r[0]), r[1])); });
    var pres = h('div', { class: 'hint', style: { marginTop: '12px' } }, 'While presenting: → ← space to navigate · f fullscreen · o overview · b black · p presenter window · ? help · add ?print to the URL to save a PDF.');
    U.modal({ title: 'Keyboard shortcuts', body: h('div', {}, body, pres), width: '760px' });
  };

  U.progress = function (frac) {
    var bar = KH.$('.progress');
    if (frac == null) { if (bar) bar.remove(); return; }
    if (!bar) { bar = h('div', { class: 'progress' }); document.body.appendChild(bar); }
    bar.style.width = Math.round(frac * 100) + '%';
  };
  return U;
})();
