/* keyhtml editor — rich text editing inside text boxes and shapes (contenteditable). */
KH.text = (function () {
  var T = { editing: null };
  var M = KH.model, h = KH.h;

  T.body = function (el) { return M.type(el) === 'html' ? el : KH.$(':scope > .kh-body', el); };
  T.canEdit = function (el) { var t = M.type(el); return t === 'text' || t === 'shape' || t === 'html'; };

  function placeCaretAt(x, y) {
    var range = null;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); range.collapse(true); }
    }
    if (range) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(range); return true; }
    return false;
  }
  function caretToEnd(body) {
    var r = document.createRange(); r.selectNodeContents(body); r.collapse(false);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function selectAllIn(body) {
    var r = document.createRange(); r.selectNodeContents(body);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  T.enter = function (el, ev) {
    if (T.editing === el) return;
    if (T.editing) T.exit();
    if (!T.canEdit(el) || M.isLocked(el)) return;
    var body = T.body(el);
    if (!body) { body = h('div', { class: 'kh-body' }); el.appendChild(body); }
    if (M.type(el) !== 'html') KH.math.unrenderBody(body);
    body.setAttribute('contenteditable', 'true');
    el.classList.add('kh-editing');
    T.editing = el;
    body.focus();
    var placed = false;
    if (el.hasAttribute('data-placeholder')) { selectAllIn(body); placed = true; }
    else if (ev && ev.clientX != null) placed = placeCaretAt(ev.clientX, ev.clientY);
    if (!placed) caretToEnd(body);
    KH.canvas.renderSelection();
    KH.emit('edit-start', el);
  };

  function cleanup(body) {
    // Chrome leaves a trailing <br> in otherwise-empty blocks; strip empty font tags etc.
    KH.$$('font', body).forEach(function (f) {
      var span = h('span');
      if (f.color) span.style.color = f.color;
      if (f.face) span.style.fontFamily = f.face;
      if (f.size) span.style.fontSize = ({ 1: '0.6em', 2: '0.8em', 3: '1em', 4: '1.2em', 5: '1.5em', 6: '2em', 7: '3em' })[f.size] || '';
      span.innerHTML = f.innerHTML;
      f.replaceWith(span);
    });
    KH.$$('span', body).forEach(function (s) { if (!s.getAttribute('style') && !s.className) { while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s); s.remove(); } });
    if (body.childNodes.length === 1 && body.firstChild.nodeName === 'BR') body.innerHTML = '';
  }

  T.exit = function (silent) {
    var el = T.editing;
    if (!el) return;
    var body = T.body(el);
    T.editing = null;
    T.clearSaved(); T.lastRange = null;
    if (body) {
      body.removeAttribute('contenteditable');
      if (M.type(el) !== 'html') { cleanup(body); KH.math.renderBody(body); }
    }
    el.classList.remove('kh-editing');
    el.removeAttribute('data-placeholder');
    var sel = window.getSelection(); if (sel) sel.removeAllRanges();
    var empty = body && !body.textContent.trim() && !body.querySelector('img,svg,table,.kh-mi,hr');
    if (empty && M.type(el) === 'text') {
      M.remove([el]);
      KH.canvas.clearSelection(true);
    } else if (el.isConnected) M.fitAncestors(el); // text inside a group may have grown or shrunk
    if (!silent) M.history.push();
    KH.canvas.renderSelection();
    KH.emit('edit-end', el);
  };

  T.onInput = function () {
    KH.canvas.renderSelection();
    KH.emit('geom');
    KH.emit('textinput');
  };

  // ------------------------------------------------------------ formatting
  var BOX_TOGGLES = {
    bold: ['fontWeight', '700', ''], italic: ['fontStyle', 'italic', ''],
    underline: ['textDecoration', 'underline', ''], strikeThrough: ['textDecoration', 'line-through', ''],
  };
  var ALIGN = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right', justifyFull: 'justify' };

  function selectionCollapsed() { var s = window.getSelection(); return !s || s.isCollapsed; }

  T.restoreRange = function () {
    var el = T.editing; if (!el) return;
    var body = T.body(el);
    if (document.activeElement !== body) {
      body.focus();
      if (T.lastRange) { try { var s = window.getSelection(); s.removeAllRanges(); s.addRange(T.lastRange); } catch (e) {} }
    }
  };
  T.exec = function (cmd, val, live) {
    var targets = KH.canvas.sel;
    if (T.editing) {
      T.restoreRange();
      var css = (cmd === 'foreColor' || cmd === 'fontName' || cmd === 'hiliteColor' || cmd === 'backColor');
      document.execCommand('styleWithCSS', false, css);
      document.execCommand(cmd, false, val == null ? null : val);
      T.onInput();
      return;
    }
    if (!targets.length) return;
    targets.forEach(function (el) {
      if (BOX_TOGGLES[cmd]) {
        var p = BOX_TOGGLES[cmd][0], on = BOX_TOGGLES[cmd][1];
        var cur = el.style[p] || '';
        if (p === 'textDecoration') {
          var parts = cur.split(/\s+/).filter(Boolean);
          var i = parts.indexOf(on);
          if (i >= 0) parts.splice(i, 1); else parts.push(on);
          el.style.textDecoration = parts.join(' ');
        } else {
          var isOn = cmd === 'bold' ? (cur === '700' || cur === 'bold' || (!cur && el.classList.contains('kh-heading'))) : cur === on;
          if (cmd === 'bold' && el.classList.contains('kh-heading')) el.style.fontWeight = isOn ? '400' : '';
          else el.style[p] = isOn ? (cmd === 'bold' ? '400' : 'normal') : on;
          if (cmd === 'bold' && el.style.fontWeight === '400' && !el.classList.contains('kh-heading')) el.style.fontWeight = '';
          if (cmd === 'italic' && el.style.fontStyle === 'normal') el.style.fontStyle = '';
        }
      } else if (ALIGN[cmd]) el.style.textAlign = ALIGN[cmd];
      else if (cmd === 'foreColor') el.style.color = val;
      else if (cmd === 'fontName') el.style.fontFamily = val;
      else if (cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') toggleListBox(el, cmd === 'insertOrderedList' ? 'ol' : 'ul');
    });
    KH.canvas.renderSelection();
    if (!live) M.history.push();
  };

  function toggleListBox(el, tag) {
    var body = T.body(el); if (!body) return;
    var list = KH.$(':scope > ul, :scope > ol', body);
    if (list && body.children.length === 1) {
      var lines = KH.$$(':scope > li', list).map(function (li) { return '<div>' + li.innerHTML + '</div>'; }).join('');
      body.innerHTML = lines;
      if (list.tagName.toLowerCase() === tag) return;
      list = null;
    }
    var items = [];
    var blocks = KH.$$(':scope > div, :scope > p', body);
    if (blocks.length) items = blocks.map(function (b) { return b.innerHTML; });
    else items = body.innerHTML.split(/<br\s*\/?>/i);
    items = items.filter(function (s) { return s.replace(/<br\s*\/?>|&nbsp;|\s/gi, '').length; });
    if (!items.length) items = [''];
    body.innerHTML = '<' + tag + '>' + items.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</' + tag + '>';
  }

  /* The deck's default text color: what an unstyled box on this slide inherits (white on dark decks). */
  T.defaultColor = function (el) {
    var slide = (el && el.closest('.kh-slide')) || M.slide();
    return KH.toHex(getComputedStyle(slide).color) || '#ffffff';
  };
  /* Reset color to the deck default: the selected text while editing, else the selected boxes. */
  T.resetColor = function () {
    if (T.editing) {
      T.restoreRange();
      if (selectionCollapsed()) return;
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('foreColor', false, T.defaultColor(T.editing));
      T.onInput();
      return;
    }
    var els = KH.canvas.sel.filter(function (el) { var t = M.type(el); return t === 'text' || t === 'shape'; });
    if (!els.length) return;
    els.forEach(function (el) {
      el.style.color = '';
      var body = T.body(el); if (!body) return;
      KH.$$('[style]', body).forEach(function (n) { n.style.color = ''; if (!n.getAttribute('style')) n.removeAttribute('style'); });
      KH.$$('font[color]', body).forEach(function (f) { f.removeAttribute('color'); });
    });
    KH.canvas.renderSelection();
    M.history.push();
  };

  T.setFontSize = function (px) {
    px = Math.max(4, parseFloat(px) || 40);
    if (T.editing) T.restoreRange();
    if (T.editing && !selectionCollapsed()) {
      var body = T.body(T.editing);
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      // Move (not copy) the children so the new spans can be reselected afterwards.
      var spans = KH.$$('font[size="7"]', body).map(function (f) {
        var span = h('span', { style: 'font-size:' + px + 'px' });
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
        return span;
      });
      if (spans.length) {
        var r = document.createRange();
        r.setStartBefore(spans[0]); r.setEndAfter(spans[spans.length - 1]);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        T.lastRange = r.cloneRange();
      }
      T.onInput();
      return;
    }
    // Collapsed caret inside an HTML block: don't resize the whole imported slide.
    if (T.editing && M.type(T.editing) === 'html') return;
    KH.canvas.sel.forEach(function (el) {
      if (M.type(el) === 'math') { el.setAttribute('data-fs', String(px)); KH.math.renderElement(el); }
      else el.style.fontSize = px + 'px';
    });
    KH.canvas.renderSelection();
    M.history.push();
  };

  /* Current formatting state for the inspector */
  T.state = function (el) {
    var st = { bold: false, italic: false, underline: false, strike: false, align: 'left', fontSize: 40, fontFamily: '', color: '#000000', ul: false, ol: false, sup: false, sub: false };
    if (!el) return st;
    var cs = getComputedStyle(el);
    st.fontSize = Math.round(parseFloat(el.style.fontSize) || parseFloat(cs.fontSize));
    st.fontFamily = el.style.fontFamily || '';
    st.color = KH.toHex(el.style.color || cs.color) || '#000000';
    st.align = el.style.textAlign || cs.textAlign || 'left';
    if (st.align === 'start') st.align = 'left';
    if (T.editing === el) {
      try {
        st.bold = document.queryCommandState('bold'); st.italic = document.queryCommandState('italic');
        st.underline = document.queryCommandState('underline'); st.strike = document.queryCommandState('strikeThrough');
        st.ul = document.queryCommandState('insertUnorderedList'); st.ol = document.queryCommandState('insertOrderedList');
        st.sup = document.queryCommandState('superscript'); st.sub = document.queryCommandState('subscript');
        var s = window.getSelection();
        if (s && s.anchorNode) {
          var n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode;
          var ncs = getComputedStyle(n);
          st.fontSize = Math.round(parseFloat(ncs.fontSize));
          st.color = KH.toHex(ncs.color) || st.color;
          var a = ['left', 'center', 'right', 'justify'].filter(function (k) { return document.queryCommandState('justify' + k[0].toUpperCase() + k.slice(1)); })[0];
          if (a) st.align = a;
        }
      } catch (e) {}
    } else {
      var fw = el.style.fontWeight || cs.fontWeight;
      st.bold = fw === '700' || fw === 'bold' || parseInt(fw, 10) >= 600;
      st.italic = (el.style.fontStyle || cs.fontStyle) === 'italic';
      st.underline = /underline/.test(el.style.textDecoration || '');
      st.strike = /line-through/.test(el.style.textDecoration || '');
      var body = T.body(el);
      if (body) { st.ul = !!KH.$(':scope > ul', body); st.ol = !!KH.$(':scope > ol', body); }
    }
    return st;
  };

  T.valign = function (el, v) {
    if (v === undefined) return el.classList.contains('kh-valign-middle') ? 'middle' : el.classList.contains('kh-valign-bottom') ? 'bottom' : 'top';
    el.classList.remove('kh-valign-middle', 'kh-valign-bottom');
    if (v !== 'top') el.classList.add('kh-valign-' + v);
  };

  /* table helpers for text boxes that contain a table */
  T.table = function (el) { var b = T.body(el); return b ? KH.$('table', b) : null; };
  T.tableAddRow = function (el) {
    var t = T.table(el); if (!t) return;
    var rows = KH.$$('tr', t); var last = rows[rows.length - 1];
    var tr = last.cloneNode(true); KH.$$('td,th', tr).forEach(function (c) { c.innerHTML = '&nbsp;'; });
    last.parentNode.appendChild(tr);
  };
  T.tableAddCol = function (el) {
    var t = T.table(el); if (!t) return;
    KH.$$('tr', t).forEach(function (tr) { var c = tr.lastElementChild.cloneNode(true); c.innerHTML = '&nbsp;'; tr.appendChild(c); });
  };
  T.tableDelRow = function (el) {
    var t = T.table(el); if (!t) return; var rows = KH.$$('tr', t); if (rows.length > 1) rows[rows.length - 1].remove();
  };
  T.tableDelCol = function (el) {
    var t = T.table(el); if (!t) return;
    KH.$$('tr', t).forEach(function (tr) { if (tr.children.length > 1) tr.lastElementChild.remove(); });
  };

  // paste plain text while editing
  document.addEventListener('paste', function (e) {
    if (!T.editing) return;
    var cd = e.clipboardData; if (!cd) return;
    if (cd.files && cd.files.length) return; // let canvas handle images
    var text = cd.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
    T.onInput();
  }, true);
  document.addEventListener('input', function (e) {
    if (T.editing && e.target && e.target.closest && e.target.closest('.kh-body') === T.body(T.editing)) T.onInput();
  });
  // Keep the saved selection visible while focus is in the inspector (CSS Custom Highlight API).
  var HL = 'kh-saved-sel';
  function showSaved() {
    if (!window.CSS || !CSS.highlights || !T.lastRange || T.lastRange.collapsed) return;
    try { CSS.highlights.set(HL, new Highlight(T.lastRange)); } catch (e) {}
  }
  T.clearSaved = function () { if (window.CSS && CSS.highlights) CSS.highlights.delete(HL); };
  document.addEventListener('focusout', function (e) {
    if (T.editing && e.target === T.body(T.editing)) showSaved();
  }, true);
  document.addEventListener('focusin', function (e) {
    if (T.editing && e.target === T.body(T.editing)) T.clearSaved();
  }, true);
  document.addEventListener('selectionchange', function () {
    if (!T.editing) return;
    var s = window.getSelection();
    if (s && s.rangeCount) { var r = s.getRangeAt(0); var body = T.body(T.editing); if (body && body.contains(r.commonAncestorContainer)) T.lastRange = r.cloneRange(); }
    KH.emit('selectionchange');
  });
  return T;
})();
