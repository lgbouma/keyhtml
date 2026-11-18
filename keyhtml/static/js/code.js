/* keyhtml editor — code blocks with syntax highlighting.
   Like equations, a code block is rendered once, in the editor: highlight.js (vendor/highlight, loaded by
   the editor only) turns the source into plain <span class="hljs-…"> markup that is saved in the deck and
   colored by deck.css. The deck itself needs no script for it. The source is the text of the block.
     <div class="kh-el kh-code [kh-code-light]" data-lang="python" style="…; font-size:28px"><pre><code>…</code></pre></div>
   The box is always as large as the code at its font size; resizing the box scales the font. */
KH.code = (function () {
  var K = {}, M = KH.model, h = KH.h;
  K.DEFAULT_FS = 28;
  K.LANGS = [['auto', 'Auto-detect'], ['plaintext', 'Plain text'], ['python', 'Python'], ['bash', 'Shell (bash)'], ['c', 'C'], ['cpp', 'C++'],
    ['fortran', 'Fortran'], ['julia', 'Julia'], ['matlab', 'MATLAB'], ['r', 'R'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'],
    ['json', 'JSON'], ['yaml', 'YAML'], ['ini', 'TOML / INI'], ['sql', 'SQL'], ['latex', 'LaTeX'], ['markdown', 'Markdown'], ['xml', 'HTML / XML'],
    ['css', 'CSS'], ['makefile', 'Makefile'], ['diff', 'Diff'], ['rust', 'Rust'], ['go', 'Go'], ['java', 'Java'], ['swift', 'Swift'],
    ['ruby', 'Ruby'], ['lua', 'Lua'], ['perl', 'Perl'], ['php', 'PHP'], ['kotlin', 'Kotlin'], ['csharp', 'C#']];

  K.ready = function () { return !!(window.hljs && window.hljs.highlight); };
  /* Highlighted markup for a source text. Without the highlighter (or on an error) the text is shown plain. */
  K.html = function (code, lang) {
    if (K.ready() && lang !== 'plaintext') {
      try {
        if (lang && lang !== 'auto' && window.hljs.getLanguage(lang)) return window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return window.hljs.highlightAuto(code).value;
      } catch (e) { console.error('keyhtml code', e); }
    }
    return KH.escapeHtml(code);
  };
  K.clean = function (code) { return String(code == null ? '' : code).replace(/\r\n?/g, '\n').replace(/\s+$/, ''); };
  K.codeEl = function (el) { return el.querySelector(':scope > pre > code'); };
  K.source = function (el) { var c = K.codeEl(el); return c ? c.textContent : ''; };
  K.lang = function (el) { return el.getAttribute('data-lang') || 'auto'; };
  K.theme = function (el, v) {
    if (v === undefined) return el.classList.contains('kh-code-light') ? 'light' : 'dark';
    el.classList.toggle('kh-code-light', v === 'light');
  };
  K.fontSize = function (el) { return parseFloat(el.style.fontSize) || K.DEFAULT_FS; };

  /* (Re)build the block's markup from a source text (default: the text it already holds). */
  K.render = function (el, code) {
    code = K.clean(code == null ? K.source(el) : code);
    var pre = el.querySelector(':scope > pre');
    if (!pre) { el.innerHTML = ''; pre = h('pre', {}, h('code')); el.appendChild(pre); }
    var c = pre.querySelector('code') || pre.appendChild(h('code'));
    c.innerHTML = K.html(code, K.lang(el));
    if (!el.style.fontSize) el.style.fontSize = K.DEFAULT_FS + 'px';
    K.fit(el);
  };
  /* Size of the code at the block's font size (the <pre> is as wide as its longest line). */
  function natural(el) {
    var pre = el.querySelector(':scope > pre'); if (!pre) return null;
    var host = null;
    if (!el.isConnected) { // not on a slide yet: measure inside the deck, where the deck styles apply
      var slide = M.slide(); if (!slide) return null;
      host = h('div', { style: { position: 'absolute', left: '0', top: '0', visibility: 'hidden' } });
      slide.appendChild(host); host.appendChild(el);
    }
    var s = { w: Math.ceil(pre.offsetWidth), h: Math.ceil(pre.offsetHeight) };
    if (host) { host.removeChild(el); host.remove(); }
    return s.w && s.h ? s : null;
  }
  /* Make the box exactly as large as the code. */
  K.fit = function (el) {
    var s = natural(el); if (!s) return;
    M.setGeom(el, { w: s.w, h: s.h });
  };
  /* After the box was resized: scale the font so that the code fills the new width. */
  K.syncSizeFromBox = function (el) {
    var s = natural(el), w = KH.px(el.style.width); if (!s || !(w > 0)) return;
    var fs = Math.max(6, KH.round(K.fontSize(el) * w / s.w, 1));
    el.style.fontSize = fs + 'px';
    K.fit(el);
  };
  K.setFontSize = function (el, px) { el.style.fontSize = Math.max(6, px) + 'px'; K.fit(el); };
  return K;
})();
