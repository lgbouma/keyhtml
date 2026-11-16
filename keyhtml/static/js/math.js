/* keyhtml editor — LaTeX via MathJax (SVG output, glyphs inlined as paths).
   Equations are rendered at edit time; saved decks contain plain SVG and need no runtime. */
KH.math = (function () {
  var EX_PER_EM = 0.442; // MathJax TeX font x-height: width="N ex" means N*0.442 em
  var readyPromise = null;
  var M = { EX_PER_EM: EX_PER_EM };

  M.ready = function () {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise(function (resolve) {
      var tries = 0;
      (function wait() {
        if (window.MathJax && MathJax.startup && MathJax.startup.promise) {
          MathJax.startup.promise.then(function () { resolve(true); });
        } else if (++tries > 600) { resolve(false); }
        else setTimeout(wait, 50);
      })();
    });
    return readyPromise;
  };
  M.isReady = function () { return !!(window.MathJax && MathJax.tex2svg); };

  function macros() { return (KH.model && KH.model.macros) ? KH.model.macros + '\n' : ''; }

  /* Render TeX to an <svg> element. Returns {svg, error, wEx, hEx, valign}. Never throws. */
  M.svg = function (tex, display) {
    if (!M.isReady()) {
      return { svg: fallbackSvg(tex), error: 'MathJax is still loading', wEx: 10, hEx: 2 };
    }
    var error = null, node;
    try {
      if (MathJax.texReset) MathJax.texReset();
      node = MathJax.tex2svg(macros() + tex, { display: !!display });
    } catch (e) {
      return { svg: fallbackSvg(tex), error: String(e && e.message || e), wEx: 10, hEx: 2 };
    }
    var err = node.querySelector('[data-mjx-error]');
    if (err) error = err.getAttribute('data-mjx-error') || 'TeX error';
    var svg = node.querySelector('svg');
    if (!svg) return { svg: fallbackSvg(tex), error: error || 'no output', wEx: 10, hEx: 2 };
    svg.removeAttribute('role'); svg.removeAttribute('focusable');
    svg.removeAttribute('aria-hidden');
    var wEx = parseFloat(svg.getAttribute('width')) || 1, hEx = parseFloat(svg.getAttribute('height')) || 1;
    var valign = (svg.style && svg.style.verticalAlign) || '';
    return { svg: svg, error: error, wEx: wEx, hEx: hEx, valign: valign };
  };
  function fallbackSvg(tex) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    s.setAttribute('viewBox', '0 0 400 60'); s.setAttribute('width', '20ex'); s.setAttribute('height', '3ex');
    var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', '4'); t.setAttribute('y', '42'); t.setAttribute('font-size', '36'); t.setAttribute('fill', '#c00'); t.setAttribute('font-family', 'monospace');
    t.textContent = tex;
    s.appendChild(t);
    return s;
  }

  /* Render a block equation element (.kh-math): size follows data-fs (px "font size"). */
  M.renderElement = function (el, keepSize) {
    var tex = el.getAttribute('data-tex') || '';
    var fs = parseFloat(el.getAttribute('data-fs')) || 60;
    var r = M.svg(tex, true);
    var s = r.svg;
    s.setAttribute('width', '100%'); s.setAttribute('height', '100%');
    s.removeAttribute('style');
    s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    el.innerHTML = '';
    el.appendChild(s);
    el.setAttribute('data-hex', String(KH.round(r.hEx, 3)));
    el.setAttribute('data-wex', String(KH.round(r.wEx, 3)));
    el.classList.toggle('kh-math-error', !!r.error);
    if (r.error) el.setAttribute('data-error', r.error); else el.removeAttribute('data-error');
    if (!keepSize) {
      var k = fs * EX_PER_EM;
      KH.model.setGeom(el, { w: Math.max(20, r.wEx * k), h: Math.max(20, r.hEx * k) });
    }
    return r;
  };
  /* After a manual resize, derive the font size from the new height. */
  M.syncSizeFromBox = function (el) {
    var hEx = parseFloat(el.getAttribute('data-hex')) || 1;
    var h = KH.px(el.style.height) || el.offsetHeight;
    el.setAttribute('data-fs', String(KH.round(h / (hEx * EX_PER_EM), 1)));
  };

  /* ---- inline math inside text bodies: $...$, $$...$$, \(...\), \[...\] ---- */
  var RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(^|[^\\\w$])\$(?=\S)((?:\\.|[^$\\\n])+?)(?<=\S)\$(?!\d)/g;

  function makeInline(tex, display) {
    var span = KH.h('span', { class: 'kh-mi', 'data-tex': tex, 'data-display': display ? '1' : '0' });
    var r = M.svg(tex, display);
    if (r.error) span.setAttribute('title', r.error);
    span.appendChild(r.svg);
    return span;
  }
  M.renderBody = function (body) {
    if (!body) return 0;
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) {
      if (n.parentNode.closest && n.parentNode.closest('.kh-mi')) continue;
      if (n.nodeValue.indexOf('$') >= 0 || n.nodeValue.indexOf('\\(') >= 0 || n.nodeValue.indexOf('\\[') >= 0) nodes.push(n);
    }
    var count = 0;
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      RE.lastIndex = 0;
      var frag = document.createDocumentFragment(), last = 0, m, any = false;
      while ((m = RE.exec(text))) {
        any = true;
        var start = m.index, prefix = '';
        var tex, display;
        if (m[1] != null) { tex = m[1]; display = true; }
        else if (m[2] != null) { tex = m[2]; display = true; }
        else if (m[3] != null) { tex = m[3]; display = false; }
        else { prefix = m[4] || ''; tex = m[5]; display = false; }
        if (start + prefix.length > last) frag.appendChild(document.createTextNode(text.slice(last, start) + prefix));
        else if (prefix) frag.appendChild(document.createTextNode(prefix));
        tex = tex.replace(/ /g, ' ').trim();
        frag.appendChild(makeInline(tex, display));
        count++;
        last = start + m[0].length;
      }
      if (!any) return;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    return count;
  };
  M.unrenderBody = function (body) {
    if (!body) return;
    KH.$$('.kh-mi', body).forEach(function (span) {
      var tex = span.getAttribute('data-tex') || '';
      var display = span.getAttribute('data-display') === '1';
      var t = document.createTextNode(display ? '$$' + tex + '$$' : '$' + tex + '$');
      span.parentNode.replaceChild(t, span);
    });
    body.normalize();
  };
  /* Re-render every equation in the deck (after macros change). */
  M.rerenderAll = function () {
    if (!KH.model.deck) return;
    KH.$$('.kh-math', KH.model.deck).forEach(function (el) { M.renderElement(el, true); });
    KH.$$('.kh-mi', KH.model.deck).forEach(function (span) {
      var r = M.svg(span.getAttribute('data-tex') || '', span.getAttribute('data-display') === '1');
      span.innerHTML = ''; span.appendChild(r.svg);
      if (r.error) span.setAttribute('title', r.error); else span.removeAttribute('title');
    });
  };
  return M;
})();
