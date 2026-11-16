/* keyhtml editor — toolbar wiring and insert actions. */
KH.toolbar = (function () {
  var TB = {};
  var M = KH.model, C = KH.canvas, h = KH.h;

  function on(sel, fn) { var el = KH.$(sel); if (el) { el.addEventListener('mousedown', function (e) { e.preventDefault(); }); el.addEventListener('click', fn); } }

  TB.init = function () {
    KH.$$('.tb-icon[data-icon]').forEach(function (i) { i.innerHTML = KH.icon(i.getAttribute('data-icon')); });
    on('#tb-file', function (e) { KH.ui.dropdown(e.currentTarget, fileMenu()); });
    on('#tb-undo', function () { M.history.undo(); });
    on('#tb-redo', function () { M.history.redo(); });
    on('#tb-addslide', function (e) { KH.ui.layoutPicker(e.currentTarget); });
    on('#tb-text', TB.insertText);
    on('#tb-shape', function (e) { KH.ui.shapePicker(e.currentTarget); });
    on('#tb-media', function (e) { KH.ui.dropdown(e.currentTarget, mediaMenu()); });
    on('#tb-math', function () { if (KH.text.editing) KH.text.exit(); KH.ui.editEquation(); });
    on('#tb-table', TB.insertTable);
    on('#tb-html', function () { if (KH.text.editing) KH.text.exit(); KH.ui.editHtml(); });
    on('#tb-play', function () { KH.io.play(); });
    on('#tb-save', function () { KH.io.save(); });
    var zoom = KH.$('#tb-zoom');
    zoom.addEventListener('change', function () { if (zoom.value === 'fit') C.fit(); else C.setZoom(parseFloat(zoom.value), false); zoom.blur(); });
    KH.on('zoom', function (z) {
      if (C.fitMode) { zoom.value = 'fit'; return; }
      var opt = Array.prototype.slice.call(zoom.options).filter(function (o) { return Math.abs(parseFloat(o.value) - z) < 1e-6; })[0];
      if (opt) zoom.value = opt.value;
      else {
        var custom = zoom.querySelector('option[data-custom]');
        if (!custom) { custom = h('option', { 'data-custom': '1' }); zoom.appendChild(custom); }
        custom.value = String(z); custom.textContent = Math.round(z * 100) + '%'; zoom.value = String(z);
      }
    });
    KH.on('change', updateUndo); KH.on('load', updateUndo);
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o' && !KH.ui.modalOpen()) { e.preventDefault(); KH.ui.openDialog(); }
      if ((e.metaKey || e.ctrlKey) && e.key === '/' && !KH.ui.modalOpen()) { e.preventDefault(); KH.ui.shortcuts(); }
    });
  };
  function updateUndo() {
    KH.$('#tb-undo').disabled = !M.history.canUndo();
    KH.$('#tb-redo').disabled = !M.history.canRedo();
  }
  function fileMenu() {
    return [
      { label: 'New / Open…', shortcut: '⌘O', action: function () { KH.ui.openDialog(); } },
      { label: 'Save', shortcut: '⌘S', action: function () { KH.io.save(); } },
      { label: 'Save a Copy As…', action: function () { KH.io.saveAs(); } },
      { sep: true },
      { label: 'Play from Start', action: function () { KH.io.play(true); } },
      { label: 'Play from Current Slide', shortcut: '⌥⌘P', action: function () { KH.io.play(); } },
      { label: 'Play in a Browser Tab', action: function () { KH.io.playInTab(); } },
      { label: 'Print / Save as PDF…', action: function () { KH.io.print(); } },
      { label: 'Export Standalone HTML…', action: function () { KH.io.exportStandalone(); } },
      { sep: true },
      { label: 'Insert File from Path…', action: TB.importPath },
      { label: 'Reveal in Finder', action: function () { KH.io.reveal(); } },
      { sep: true },
      { label: 'Keyboard Shortcuts…', shortcut: '⌘/', action: function () { KH.ui.shortcuts(); } },
    ];
  }
  function mediaMenu() {
    return [
      { label: 'Image or PDF…', action: function () { KH.io.pickFiles('image/*,.pdf,.svg', true); } },
      { label: 'Movie or Audio…', action: function () { KH.io.pickFiles('video/*,audio/*', true); } },
      { label: 'From File Path…', action: TB.importPath },
      { sep: true },
      { label: 'Tip: drag files onto the slide or paste a screenshot', disabled: true },
    ];
  }
  TB.importPath = function () {
    KH.ui.prompt('Insert from path', 'Absolute path of an image, PDF or movie. The file is copied into the deck’s assets folder.', '').then(function (p) {
      if (p && p.trim()) KH.io.importPath(p.trim());
    });
  };
  TB.insertText = function () {
    if (KH.text.editing) KH.text.exit();
    var el = M.create.text({ html: '', x: M.W / 2 - 400, y: M.H / 2 - 40, w: 800, fontSize: 40 });
    C.insert(el, { edit: true });
  };
  TB.insertShape = function (type) {
    if (KH.text.editing) KH.text.exit();
    var el;
    if (type === 'line' || type === 'arrow' || type === 'darrow') {
      el = M.create.line({ arrow: type === 'arrow' ? 'end' : type === 'darrow' ? 'both' : 'none' });
      C.centerAt(el, 600, 40);
    } else {
      var wide = /^(rect|rounded|rarrow|larrow|chevron)$/.test(type);
      el = M.create.shape({ type: type === 'rounded' ? 'rect' : type, radius: type === 'rounded' ? 28 : 0, w: wide ? 520 : 400, h: wide ? 300 : 400 });
      C.centerAt(el, wide ? 520 : 400, wide ? 300 : 400);
    }
    C.insert(el);
  };
  TB.insertTable = function () {
    if (KH.text.editing) KH.text.exit();
    var rows = 3, cols = 3, html = '<table>';
    for (var r = 0; r < rows; r++) {
      html += '<tr>';
      for (var c = 0; c < cols; c++) html += r === 0 ? '<th>Header</th>' : '<td>Cell</td>';
      html += '</tr>';
    }
    html += '</table>';
    var el = M.create.text({ html: html, x: 260, y: 320, w: 1400, fontSize: 36 });
    C.insert(el);
  };
  return TB;
})();
