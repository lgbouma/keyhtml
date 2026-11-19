/* keyhtml editor — small utilities and a global namespace */
window.KH = window.KH || {};
KH.version = '0.1.0';
KH.isMac = /Mac|iPhone|iPad/.test(navigator.platform);
KH.$ = function (sel, root) { return (root || document).querySelector(sel); };
KH.$$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };
KH.h = function (tag, attrs) {
  var e = document.createElement(tag);
  if (attrs) {
    for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') { for (var d in v) e.dataset[d] = v[d]; }
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c == null || c === false) continue;
    if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
    else e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
};
KH.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
KH.round = function (v, d) { var m = Math.pow(10, d || 0); return Math.round(v * m) / m; };
KH.px = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
KH.debounce = function (fn, ms) {
  var t = null;
  var f = function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { t = null; fn.apply(self, a); }, ms); };
  f.cancel = function () { clearTimeout(t); t = null; };
  f.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
  return f;
};
KH.getRotation = function (el) {
  var m = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform || '');
  return m ? parseFloat(m[1]) : 0;
};
KH.escapeHtml = function (s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
KH.uid = function () { return Math.random().toString(36).slice(2, 9); };
KH.fmtBytes = function (n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
};
KH.toast = function (msg, kind, ms) {
  var layer = KH.$('#toast-layer');
  var t = KH.h('div', { class: 'toast ' + (kind || '') , text: msg });
  layer.appendChild(t);
  setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 320); }, ms || (kind === 'error' ? 5000 : 2200));
  return t;
};
/* tiny event bus */
KH._handlers = {};
KH.on = function (evt, fn) { (KH._handlers[evt] = KH._handlers[evt] || []).push(fn); };
KH.emit = function (evt, data) { (KH._handlers[evt] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error('handler for ' + evt, e); } }); };
/* colors */
KH.toHex = function (css) {
  if (!css) return null;
  css = css.trim();
  if (/^#([0-9a-f]{3}){1,2}$/i.test(css)) {
    if (css.length === 4) css = '#' + css[1] + css[1] + css[2] + css[2] + css[3] + css[3];
    return css.toLowerCase();
  }
  var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css);
  if (m) return '#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + parseInt(x, 10).toString(16)).slice(-2); }).join('');
  if (css === 'transparent' || css === 'none') return null;
  // named colors: resolve via a scratch element
  var s = KH.toHex._scratch || (KH.toHex._scratch = document.createElement('span'));
  s.style.color = ''; s.style.color = css;
  if (!s.style.color) return null;
  document.body.appendChild(s);
  var rgb = getComputedStyle(s).color; s.remove();
  m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(rgb);
  return m ? '#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + parseInt(x, 10).toString(16)).slice(-2); }).join('') : null;
};
// Editor appearance (the chrome around the slides, not the deck theme): 'light', 'dark' or 'system'.
// editor.html sets data-ui-theme before first paint; this keeps it in step with the setting and the OS.
KH.uiTheme = (function () {
  var T = {}, mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  T.pref = 'system';
  try { T.pref = localStorage.getItem('keyhtml.uiTheme') || 'system'; } catch (e) {}
  T.resolved = function () { return T.pref === 'system' ? (mq && mq.matches ? 'dark' : 'light') : T.pref; };
  T.apply = function () { document.documentElement.setAttribute('data-ui-theme', T.resolved()); };
  T.set = function (v) {
    T.pref = v === 'light' || v === 'dark' ? v : 'system';
    try { localStorage.setItem('keyhtml.uiTheme', T.pref); } catch (e) {}
    T.apply();
  };
  if (mq) (mq.addEventListener ? mq.addEventListener('change', T.apply) : mq.addListener(T.apply));
  T.apply();
  return T;
})();
KH.isTransparent = function (css) { return !css || css === 'transparent' || css === 'none' || /rgba\([^)]*,\s*0\)/.test(css); };
