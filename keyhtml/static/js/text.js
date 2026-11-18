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
    KH.emit('selectionchange'); // the inspector shows the format at the selection, which typing or formatting just changed
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

  /* The link around the selection (or the caret) while editing, else null. */
  T.linkAt = function () {
    var el = T.editing; if (!el) return null;
    var body = T.body(el), r = T.lastRange;
    var s = window.getSelection();
    if (s && s.rangeCount && body.contains(s.getRangeAt(0).commonAncestorContainer)) r = s.getRangeAt(0);
    if (!r) return null;
    var n = r.commonAncestorContainer;
    if (n.nodeType === 3) n = n.parentNode;
    var a = n.closest && n.closest('a');
    return a && body.contains(a) && a !== body ? a : null;
  };
  /* Hyperlink the selected text: ask for a URL, wrap the selection in <a>, or edit / remove the link
     the caret is in. With a box selected (not editing) the whole text of the box is linked. */
  T.link = function () {
    var el = T.editing;
    if (!el) {
      el = KH.canvas.single();
      if (!el || !T.canEdit(el) || M.type(el) === 'html') return;
      T.enter(el);
      selectAllIn(T.body(el));
      T.lastRange = window.getSelection().getRangeAt(0).cloneRange();
    }
    T.restoreRange();
    var a = T.linkAt();
    if (!a && selectionCollapsed()) { KH.toast('Select the text to link first', 'warn', 2000); return; }
    var input = h('input', { type: 'text', value: a ? a.getAttribute('href') || '' : '', placeholder: 'https://…  or  #3 for slide 3', spellcheck: 'false' });
    var body = h('div', {}, h('div', { class: 'hint', style: { marginBottom: '6px' } }, 'Links open in a new tab when the deck is played; a "#" link jumps to that slide.'), input);
    var buttons = [{ label: 'Cancel' }];
    if (a) buttons.push({ label: 'Remove link', action: function () { apply(''); } });
    buttons.push({ label: a ? 'Update' : 'Add link', primary: true, action: function () { apply(input.value); } });
    KH.ui.modal({ title: a ? 'Edit link' : 'Add link', body: body, selectAll: true, buttons: buttons });
    function apply(url) {
      url = (url || '').trim();
      if (url && !/^(#|\/|\.|[a-z][a-z0-9+.-]*:)/i.test(url)) url = 'https://' + url; // "example.com" → https://example.com
      T.restoreRange();
      if (a && a.isConnected) {
        if (!url) { while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a); a.parentNode.removeChild(a); }
        else setHref(a, url);
      } else if (url) {
        document.execCommand('styleWithCSS', false, false);
        document.execCommand('createLink', false, url);
        KH.$$('a', T.body(T.editing)).forEach(function (x) { if (x.getAttribute('href') === url) setHref(x, url); });
      }
      T.onInput();
    }
    function setHref(x, url) {
      x.setAttribute('href', url);
      if (url.charAt(0) === '#') { x.removeAttribute('target'); x.removeAttribute('rel'); }
      else { x.setAttribute('target', '_blank'); x.setAttribute('rel', 'noopener'); }
    }
  };

  /* Wrap the text a range covers in spans carrying one style, without touching focus or the
     selection: the color picker paints its colors this way, so the native panel can stay open and
     the result does not depend on whether the box is still being edited. Returns the spans, which a
     later call can restyle in place. */
  T.styleRange = function (range, prop, value) {
    var ec = range.endContainer, sc = range.startContainer;
    if (ec.nodeType === 3 && range.endOffset < ec.nodeValue.length) ec.splitText(range.endOffset);
    if (sc.nodeType === 3 && range.startOffset > 0) sc.splitText(range.startOffset); // the range now ends at this node's end, the rest follows it
    var root = range.commonAncestorContainer; if (root.nodeType === 3) root = root.parentNode;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    for (var t = w.nextNode(); t; t = w.nextNode()) {
      if (!t.nodeValue.length || !range.intersectsNode(t)) continue;
      if (t === range.startContainer && range.startOffset >= t.nodeValue.length) continue;
      if (t === range.endContainer && range.endOffset === 0) continue;
      nodes.push(t);
    }
    return nodes.map(function (t) {
      var p = t.parentNode, span;
      if (p.tagName === 'SPAN' && p.childNodes.length === 1 && p.getAttribute('style') && !p.className) span = p;
      else { span = h('span'); p.insertBefore(span, t); span.appendChild(t); }
      span.style[prop] = value;
      return span;
    });
  };
  /* Remember a range as the editing selection (restored by the next formatting command) and show it
     while focus is elsewhere, e.g. in the color picker. */
  T.setRange = function (r) {
    T.lastRange = r.cloneRange();
    if (!T.editing) return;
    if (document.activeElement !== T.body(T.editing)) showSaved();
    else { var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
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
        // sizes set earlier on parts of this text would win over the new one
        KH.$$('[style*="font-size"]', f).forEach(function (x) { x.style.fontSize = ''; if (!x.getAttribute('style')) x.removeAttribute('style'); });
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
      else if (M.type(el) === 'code') KH.code.setFontSize(el, px);
      else el.style.fontSize = px + 'px';
    });
    KH.canvas.renderSelection();
    M.history.push();
  };

  /* The element around the first selected character (or the caret): its size and color are what the
     inspector shows and steps from. The selection's own end points will not do: after a size change
     they sit outside the new span, in the box, and the next step would start from the box's size. */
  function selectionElement(body) {
    var s = window.getSelection(); if (!body || !s || !s.rangeCount) return null;
    var r = s.getRangeAt(0), root = r.commonAncestorContainer, n = null;
    if (!body.contains(root)) return null;
    if (root.nodeType === 3) n = root;
    else if (!r.collapsed) {
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (var t = w.nextNode(); t && !n; t = w.nextNode()) {
        if (!t.nodeValue.length || !r.intersectsNode(t)) continue;
        if (t === r.startContainer && r.startOffset >= t.nodeValue.length) continue; // selection starts after this text
        if (t === r.endContainer && r.endOffset === 0) continue;                    // or ends before it
        n = t;
      }
    }
    n = n || r.startContainer;
    return n.nodeType === 1 ? n : n.parentNode;
  }

  /* Current formatting state for the inspector */
  T.state = function (el) {
    var st = { bold: false, italic: false, underline: false, strike: false, align: 'left', fontSize: 40, fontFamily: '', color: '#000000', ul: false, ol: false, sup: false, sub: false, link: false };
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
        st.link = !!T.linkAt();
        var n = selectionElement(T.body(el));
        if (n) {
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
  /* Only a selection that really moved inside the text is announced. The browser also fires
     'selectionchange' (bubbling up from the field) whenever an <input> is given a value, so rebuilding
     the inspector fired it a dozen times; announcing those made the inspector rebuild again, without
     end, and a click on one of its buttons was lost whenever a rebuild fell between press and release. */
  function sameRange(a, b) {
    return !!a && !!b && a.startContainer === b.startContainer && a.startOffset === b.startOffset && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
  }
  T.sameRange = sameRange;
  document.addEventListener('selectionchange', function (e) {
    if (!T.editing || (e.target && e.target !== document)) return;
    var s = window.getSelection();
    if (!s || !s.rangeCount) return;
    var r = s.getRangeAt(0), body = T.body(T.editing);
    if (!body || !body.contains(r.commonAncestorContainer)) return;
    var moved = !sameRange(r, T.lastRange);
    T.lastRange = r.cloneRange();
    if (moved) KH.emit('selectionchange');
  });
  return T;
})();
