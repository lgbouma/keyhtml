/* keyhtml player runtime. Embedded in every saved deck; no external dependencies.
   Keys: → ↓ space PgDn: next · ← ↑ PgUp: prev · Home/End · f: fullscreen · o/Esc: overview
         b: black · n: presenter window (notes) · ?: help · digits+Enter: go to slide
   URL: deck.html#7 opens slide 7 · ?presenter presenter view · ?print one slide per page
        ?rehearse slides in this window, presenter view in a second one beside it (the editor's Rehearse)
   The editor's live preview sets window.__khPreview = {slide, step} before this script runs: one slide,
   all builds shown, no input handling (mode 'preview'). */
(function () {
  'use strict';
  if (window.__khPlayer) return;
  var deck = document.querySelector('.kh-deck');
  if (!deck) return;
  window.__khPlayer = true;

  var W = parseInt(deck.getAttribute('data-width'), 10) || 1920;
  var H = parseInt(deck.getAttribute('data-height'), 10) || 1080;
  var params = new URLSearchParams(location.search);
  var preview = window.__khPreview || null;
  var mode = params.has('print') ? 'print' : params.has('presenter') ? 'presenter' : preview ? 'preview' : 'play';
  var rehearse = mode === 'play' && params.has('rehearse'), loadId = Date.now();
  var allSlides = Array.prototype.slice.call(deck.querySelectorAll('.kh-slide'));
  var slides = (mode === 'print' || mode === 'preview') ? allSlides : allSlides.filter(function (s) { return !s.hasAttribute('data-skip'); });
  if (!slides.length) slides = allSlides;
  var cur = 0, step = 0;
  var presenterWin = null, overviewEl = null, blackEl = null, helpEl = null, numEl = null;
  var digitBuffer = '', digitTimer = null, cursorTimer = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  // ---- builds -------------------------------------------------------------
  function buildEls(slide) {
    return Array.prototype.slice.call(slide.querySelectorAll('.kh-el[data-build]')).filter(function (e) {
      return (parseInt(e.getAttribute('data-build'), 10) || 0) > 0;
    });
  }
  /* Per-bullet builds: a box with data-build-items="1" reveals one item per step, the first built
     item at step data-build. data-build-from="k" keeps items 1..k-1 always visible. Items are the
     top-level <li>s of the box, or its block children (lines) when it has no list. */
  function buildItems(e) {
    var body = e.querySelector(':scope > .kh-body'); if (!body) return [];
    var lis = Array.prototype.filter.call(body.querySelectorAll('li'), function (li) { return !li.parentElement.closest('li'); });
    if (lis.length) return lis;
    return Array.prototype.filter.call(body.children, function (c) { return !/^(BR|STYLE|SCRIPT)$/.test(c.tagName); });
  }
  function buildUnits(slide) {
    var out = [];
    buildEls(slide).forEach(function (e) {
      var b = parseInt(e.getAttribute('data-build'), 10) || 0;
      var items = e.getAttribute('data-build-items') === '1' ? buildItems(e) : [];
      if (!items.length) { out.push({ node: e, step: b }); return; }
      var from = Math.max(1, parseInt(e.getAttribute('data-build-from'), 10) || 1);
      items.forEach(function (it, i) { if (i >= from - 1) out.push({ node: it, step: b + i - (from - 1) }); });
    });
    return out;
  }
  function maxStep(slide) {
    var m = 0;
    buildUnits(slide).forEach(function (u) { m = Math.max(m, u.step); });
    return m;
  }
  function applyBuilds(slide, s, animate) {
    buildUnits(slide).forEach(function (u) {
      var e = u.node;
      var hidden = u.step > s;
      var was = e.classList.contains('kh-hidden');
      e.classList.toggle('kh-hidden', hidden);
      e.classList.remove('kh-build-in');
      if (animate && was && !hidden) { void e.offsetWidth; e.classList.add('kh-build-in'); }
    });
  }

  // ---- media ----------------------------------------------------------------
  function mediaIn(slide) {
    if (mode !== 'play') return;
    Array.prototype.forEach.call(slide.querySelectorAll('video,audio'), function (v) {
      var box = v.closest('.kh-el');
      if (box && box.classList.contains('kh-hidden')) { v.pause(); return; }
      if (v.hasAttribute('data-autoplay') && !v.__khPlayed) {
        v.__khPlayed = true;
        try { v.currentTime = parseFloat(v.getAttribute('data-start')) || 0; } catch (e) {}
        var p = v.play(); if (p && p.catch) p.catch(function () {});
      }
    });
  }
  function mediaOut(slide) {
    Array.prototype.forEach.call(slide.querySelectorAll('video,audio'), function (v) {
      v.pause(); v.__khPlayed = false;
      try { v.currentTime = parseFloat(v.getAttribute('data-start')) || 0; } catch (e) {}
    });
  }
  if (mode === 'play') {
    Array.prototype.forEach.call(deck.querySelectorAll('video'), function (v) {
      v.addEventListener('click', function (ev) {
        if (v.hasAttribute('controls')) return;
        ev.stopPropagation();
        if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
      });
    });
  } else {
    Array.prototype.forEach.call(deck.querySelectorAll('video,audio'), function (v) { v.muted = true; v.removeAttribute('autoplay'); });
  }

  // ---- imported section decks: keep their wrapper's show/hide classes in sync ----
  var wraps = Array.prototype.slice.call(deck.querySelectorAll('[data-kh-wrap]'));
  var asserting = false;
  function assertWraps() {
    if (!wraps.length || asserting) return;
    asserting = true;
    wraps.forEach(function (w) {
      var s = w.closest('.kh-slide');
      var on = !!(s && (s.classList.contains('kh-current') || mode === 'print'));
      w.classList.toggle('on', on); w.classList.toggle('active', on);
    });
    asserting = false;
  }
  if (wraps.length && window.MutationObserver) {
    new MutationObserver(function () { assertWraps(); }).observe(deck, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  // ---- navigation -----------------------------------------------------------
  var transTimer = null;
  function show(n, s, dir, silent) {
    n = Math.max(0, Math.min(slides.length - 1, n | 0));
    var slide = slides[n], prevSlide = slides[cur];
    var same = (n === cur && slide.classList.contains('kh-current'));
    if (s == null) s = 0;
    s = Math.max(0, Math.min(maxStep(slide), s | 0));
    if (!same) {
      var trans = slide.getAttribute('data-transition') || deck.getAttribute('data-transition') || 'none';
      if (dir === 0 || mode !== 'play') trans = 'none';
      allSlides.forEach(function (x) { x.classList.remove('kh-leaving', 'kh-enter'); });
      deck.setAttribute('data-kh-trans', trans);
      deck.classList.toggle('kh-back', dir < 0);
      if (prevSlide && prevSlide !== slide) {
        mediaOut(prevSlide);
        prevSlide.classList.remove('kh-current');
        if (trans !== 'none') prevSlide.classList.add('kh-leaving');
      }
      slide.classList.add('kh-current');
      assertWraps();
      if (trans !== 'none') slide.classList.add('kh-enter');
      clearTimeout(transTimer);
      transTimer = setTimeout(function () { allSlides.forEach(function (x) { x.classList.remove('kh-leaving', 'kh-enter'); }); }, 700);
    }
    var animate = same && s > step;
    var prevIndex = cur, prevStep = step;
    cur = n; step = s;
    applyBuilds(slide, s, animate);
    mediaIn(slide);
    updateHash(); updateNum();
    if (!silent) notifyPresenter();
    if (mode === 'presenter') updatePresenter();
    hook('kh:slide', { index: cur, step: step, slide: slide, keep: same, from: prevIndex, fromStep: prevStep, mode: mode });
  }
  /* Hooks for custom deck scripts: 'kh:next'/'kh:prev' are cancelable (preventDefault()
     to handle the keypress yourself, e.g. a JS-driven build); 'kh:slide' fires after a change. */
  function hook(name, detail, cancelable) {
    var ev = new CustomEvent(name, { detail: detail, cancelable: !!cancelable });
    document.dispatchEvent(ev);
    return !ev.defaultPrevented;
  }
  function next() {
    var slide = slides[cur];
    if (!hook('kh:next', { index: cur, step: step, slide: slide }, true)) return;
    if (step < maxStep(slide)) show(cur, step + 1, 1);
    else if (cur < slides.length - 1) show(cur + 1, 0, 1);
  }
  function prev() {
    if (!hook('kh:prev', { index: cur, step: step, slide: slides[cur] }, true)) return;
    if (step > 0) show(cur, step - 1, -1);
    else if (cur > 0) show(cur - 1, maxStep(slides[cur - 1]), -1);
  }
  function updateHash() {
    if (mode === 'preview') return;
    var h = '#' + (cur + 1);
    if (location.hash !== h) { try { history.replaceState(null, '', h); } catch (e) { location.hash = h; } }
  }
  function slideFromHash() {
    var m = /^#(\d+)/.exec(location.hash || '');
    return m ? Math.max(0, Math.min(slides.length - 1, parseInt(m[1], 10) - 1)) : 0;
  }
  function updateNum() {
    if (!numEl) return;
    numEl.textContent = (cur + 1) + ' / ' + slides.length;
  }

  // ---- layout ---------------------------------------------------------------
  function fitInto(container, node, pad) {
    var cw = container.clientWidth - (pad || 0) * 2, ch = container.clientHeight - (pad || 0) * 2;
    var s = Math.min(cw / W, ch / H);
    node.style.transform = 'scale(' + s + ')';
    node.style.left = Math.round((container.clientWidth - W * s) / 2) + 'px';
    node.style.top = Math.round((container.clientHeight - H * s) / 2) + 'px';
    node.style.width = W + 'px'; node.style.height = H + 'px';
  }
  function layout() {
    if (mode === 'play') {
      var s = Math.min(window.innerWidth / W, window.innerHeight / H);
      deck.style.transform = 'scale(' + s + ')';
      deck.style.left = Math.round((window.innerWidth - W * s) / 2) + 'px';
      deck.style.top = Math.round((window.innerHeight - H * s) / 2) + 'px';
    } else if (mode === 'presenter') {
      layoutPresenter();
    } else if (mode === 'preview') {
      deck.style.transform = 'none'; deck.style.left = '0'; deck.style.top = '0';
    }
  }

  // ---- fullscreen / black / help -------------------------------------------
  function toggleFullscreen() {
    var top = null;
    if (window.top !== window) try { top = window.top.document; } catch (e) {}
    if (top && top.fullscreenElement) { top.exitFullscreen(); return; } // playing inside the editor: f ends the show
    var d = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (d.requestFullscreen) d.requestFullscreen(); else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }
  function toggleBlack() {
    if (!blackEl) { blackEl = el('div'); blackEl.id = 'kh-black'; document.body.appendChild(blackEl); }
    blackEl.classList.toggle('kh-on');
  }
  function toggleHelp() {
    if (!helpEl) {
      helpEl = el('div', '', '<h3>keyhtml — keyboard</h3>' +
        '<div><kbd>→</kbd><kbd>space</kbd> next build / slide &nbsp; <kbd>←</kbd> previous</div>' +
        '<div><kbd>Home</kbd><kbd>End</kbd> first / last slide &nbsp; <kbd>1</kbd>…<kbd>⏎</kbd> go to slide</div>' +
        '<div><kbd>f</kbd> fullscreen &nbsp; <kbd>o</kbd> or <kbd>esc</kbd> slide overview</div>' +
        '<div><kbd>b</kbd> black screen &nbsp; <kbd>n</kbd> presenter window with notes</div>' +
        '<div><kbd>?</kbd> this help &nbsp; · &nbsp; add <code>?print</code> to the URL to print / save as PDF</div>');
      helpEl.id = 'kh-help'; document.body.appendChild(helpEl);
    }
    helpEl.classList.toggle('kh-on');
  }

  // ---- overview -------------------------------------------------------------
  function slideClone(i, hideBuildsAbove) {
    var d = el('div', 'kh-deck kh-ov-deck');
    d.setAttribute('style', deck.getAttribute('style') || '');
    d.style.width = W + 'px'; d.style.height = H + 'px';
    var c = slides[i].cloneNode(true);
    c.classList.add('kh-current'); c.classList.remove('kh-leaving', 'kh-enter');
    Array.prototype.forEach.call(c.querySelectorAll('video,audio'), function (v) { v.removeAttribute('autoplay'); v.muted = true; v.removeAttribute('data-autoplay'); });
    Array.prototype.forEach.call(c.querySelectorAll('[id]'), function (x) { x.removeAttribute('id'); });
    Array.prototype.forEach.call(c.querySelectorAll('[data-kh-wrap]'), function (w) { w.classList.add('on'); w.classList.add('active'); });
    if (hideBuildsAbove != null) {
      buildUnits(c).forEach(function (u) { u.node.classList.toggle('kh-hidden', u.step > hideBuildsAbove); });
    } else {
      Array.prototype.forEach.call(c.querySelectorAll('.kh-hidden'), function (e) { e.classList.remove('kh-hidden'); });
    }
    d.appendChild(c);
    return d;
  }
  function toggleOverview(force) {
    var on = force != null ? force : !(overviewEl && overviewEl.classList.contains('kh-on'));
    if (!on) { if (overviewEl) overviewEl.classList.remove('kh-on'); return; }
    if (!overviewEl) { overviewEl = el('div'); overviewEl.id = 'kh-overview'; document.body.appendChild(overviewEl); }
    overviewEl.innerHTML = '';
    var grid = el('div', 'kh-ov-grid');
    slides.forEach(function (s, i) {
      var item = el('div', 'kh-ov-item' + (i === cur ? ' kh-ov-cur' : ''));
      var frame = el('div', 'kh-ov-frame');
      var d = slideClone(i, null);
      frame.appendChild(d);
      item.appendChild(frame);
      item.appendChild(el('div', 'kh-ov-label', (i + 1) + (s.querySelector('.kh-text') ? ' · ' + (s.querySelector('.kh-text').textContent || '').trim().slice(0, 40) : '')));
      item.addEventListener('click', function () { toggleOverview(false); show(i, 0, 0); });
      grid.appendChild(item);
    });
    overviewEl.appendChild(grid);
    overviewEl.classList.add('kh-on');
    // scale clones once laid out
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(overviewEl.querySelectorAll('.kh-ov-frame'), function (frame) {
        var d = frame.firstChild; var s = frame.clientWidth / W;
        d.style.transform = 'scale(' + s + ')';
      });
    });
  }
  function overviewOpen() { return overviewEl && overviewEl.classList.contains('kh-on'); }

  // ---- presenter ------------------------------------------------------------
  function openPresenter() {
    var url = location.pathname + '?presenter' + '#' + (cur + 1), feat = 'width=1280,height=800';
    if (rehearse) {
      // Beside this window, on the same screen. The load id makes the presenter window reload whenever
      // this one does (a changed deck, Rehearse pressed again), and only then.
      var sc = window.screen, right = (sc.availLeft || 0) + sc.availWidth, left = window.screenX + window.outerWidth;
      var wd = Math.max(480, right - left); left = Math.min(left, right - wd); // no room beside: overlap from the right edge
      url = location.pathname + '?presenter&rehearse=' + loadId + '#' + (cur + 1);
      feat = 'popup,left=' + left + ',top=' + (sc.availTop || 0) + ',width=' + wd + ',height=' + sc.availHeight;
    }
    // its own window name: never a presenter window left over from Play, whose opener is another window
    var w = window.open(url, rehearse ? 'khnotes' : 'khpresenter', feat);
    if (w) presenterWin = w;
    return w;
  }
  /* Rehearse (?rehearse): the slides in this window and the presenter view in a second, ordinary window,
     e.g. to share only the slides in a video call. A window that no key or click asked for is a pop-up
     to the browser; when it is blocked, the first key or click in this window opens it instead. */
  function startRehearsal() {
    if (openPresenter()) return;
    var tip = el('div', '', 'Press any key or click to open the presenter notes window' +
      '<small>The browser blocked it as a pop-up. Allow pop-ups for this page to skip this step.</small>');
    tip.id = 'kh-rehearse-tip'; document.body.appendChild(tip);
    var once = function (e) {
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey || /^(Escape|Shift|Meta|Control|Alt|CapsLock)$/.test(e.key))) return;
      e.preventDefault(); e.stopImmediatePropagation(); // this key or click opens the window, it does not advance the slides
      if (!openPresenter()) return;
      document.removeEventListener('keydown', once, true); document.removeEventListener('click', once, true);
      tip.remove();
    };
    document.addEventListener('keydown', once, true); document.addEventListener('click', once, true);
  }
  function notifyPresenter() {
    if (mode !== 'play' || !presenterWin) return;
    try { presenterWin.postMessage({ kh: 'state', cur: cur, step: step }, '*'); } catch (e) { presenterWin = null; }
  }
  var pres = null;
  function setupPresenter() {
    document.body.classList.add('kh-presenter');
    var root = el('div'); root.id = 'kh-pres';
    root.innerHTML =
      '<div class="kh-pres-top">' +
        '<div class="kh-pres-notes"></div>' +
        '<div class="kh-pres-row">' +
          '<div class="kh-pres-panel"><div class="kh-pres-label">Current</div><div class="kh-pres-cur"></div></div>' +
          '<div class="kh-pres-panel"><div class="kh-pres-label kh-pres-nextlabel">Next</div><div class="kh-pres-nextwrap"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="kh-pres-bar">' +
        '<span class="kh-pres-time" data-role="elapsed">00:00</span>' +
        '<button data-role="reset">reset timer</button>' +
        '<span data-role="clock"></span>' +
        '<span class="kh-pres-spacer"></span>' +
        '<span data-role="counter"></span>' +
        '<button data-role="prev">◀ prev</button><button data-role="next">next ▶</button>' +
      '</div>';
    document.body.appendChild(root);
    var curBox = $('.kh-pres-cur', root);
    deck.classList.add('kh-pres-deck');
    curBox.appendChild(deck);
    var nextDeck = el('div', 'kh-deck kh-pres-deck kh-ov-deck');
    nextDeck.setAttribute('style', deck.getAttribute('style') || '');
    $('.kh-pres-nextwrap', root).appendChild(nextDeck);
    pres = { root: root, curBox: curBox, nextDeck: nextDeck, notes: $('.kh-pres-notes', root),
             elapsed: $('[data-role=elapsed]', root), clock: $('[data-role=clock]', root), counter: $('[data-role=counter]', root),
             t0: Date.now() };
    $('[data-role=reset]', root).addEventListener('click', function () { pres.t0 = Date.now(); });
    $('[data-role=prev]', root).addEventListener('click', function () { sendNav('prev'); });
    $('[data-role=next]', root).addEventListener('click', function () { sendNav('next'); });
    setInterval(function () {
      var s = Math.floor((Date.now() - pres.t0) / 1000);
      var mm = Math.floor(s / 60), ss = s % 60, hh = Math.floor(mm / 60); mm = mm % 60;
      pres.elapsed.textContent = (hh ? hh + ':' : '') + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
      var d = new Date();
      pres.clock.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }, 500);
    document.title = 'Presenter notes' + (document.title ? ' · ' + document.title : ''); // tell the two windows apart in a window list
    if (window.opener) { try { window.opener.postMessage({ kh: 'hello' }, '*'); } catch (e) {} }
    if (params.has('rehearse') && window.opener) { // Rehearse: this window closes with the slides window that opened it
      var slidesWin = window.opener;
      setInterval(function () { if (slidesWin.closed) window.close(); }, 500);
    }
  }
  function layoutPresenter() {
    if (!pres) return;
    fitInto(pres.curBox, deck, 0);
    fitInto(pres.nextDeck.parentNode, pres.nextDeck, 0);
  }
  function updatePresenter() {
    if (!pres) return;
    pres.nextDeck.innerHTML = '';
    var slide = slides[cur];
    var ni, ns, label;
    if (step < maxStep(slide)) { ni = cur; ns = step + 1; label = 'Next build'; }
    else if (cur < slides.length - 1) { ni = cur + 1; ns = 0; label = 'Next slide'; }
    else { ni = -1; }
    if (ni >= 0) {
      var c = slideClone(ni, ns).firstChild;
      pres.nextDeck.appendChild(c);
    } else {
      pres.nextDeck.appendChild(el('div', 'kh-pres-end', ''));
    }
    pres.root.querySelector('.kh-pres-nextlabel').textContent = ni >= 0 ? label : 'End of presentation';
    var notes = slide.querySelector('.kh-notes');
    pres.notes.innerHTML = notes ? notes.innerHTML.trim() : ''; // notes may carry <b>, <i> and em-sized spans
    pres.counter.textContent = 'Slide ' + (cur + 1) + ' of ' + slides.length + (maxStep(slide) ? ' · build ' + step + '/' + maxStep(slide) : '');
    layoutPresenter();
  }
  function sendNav(action, n) {
    if (window.opener) { try { window.opener.postMessage({ kh: 'nav', action: action, n: n }, '*'); return; } catch (e) {} }
    if (action === 'next') next(); else if (action === 'prev') prev(); else if (action === 'goto') show(n, 0, 0);
  }
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || !d.kh) return;
    if (mode === 'play') {
      if (d.kh === 'hello') { presenterWin = ev.source; notifyPresenter(); }
      else if (d.kh === 'nav') {
        if (d.action === 'next') next(); else if (d.action === 'prev') prev(); else if (d.action === 'goto') show(d.n, 0, 0);
      }
    } else if (mode === 'presenter' && d.kh === 'state') {
      show(d.cur, d.step, 0, true);
    }
  });

  // ---- input ----------------------------------------------------------------
  function gotoTyped() {
    if (digitBuffer) { var n = parseInt(digitBuffer, 10); digitBuffer = ''; if (n >= 1) { if (mode === 'presenter') sendNav('goto', n - 1); else show(n - 1, 0, 0); } }
  }
  if (mode !== 'preview') document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var k = e.key;
    if (overviewOpen()) {
      if (k === 'Escape' || k === 'o' || k === 'O') { toggleOverview(false); e.preventDefault(); }
      return;
    }
    if (helpEl && helpEl.classList.contains('kh-on') && k !== '?') { toggleHelp(); }
    if (/^[0-9]$/.test(k)) { digitBuffer += k; clearTimeout(digitTimer); digitTimer = setTimeout(function () { digitBuffer = ''; }, 2500); return; }
    var nav = mode === 'presenter' ? sendNav : function (a, n) { if (a === 'next') next(); else if (a === 'prev') prev(); else show(n, 0, 0); };
    switch (k) {
      case 'Enter': if (digitBuffer) { gotoTyped(); } else nav('next'); break;
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': nav('next'); break;
      case ' ': if (e.shiftKey) nav('prev'); else nav('next'); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': nav('prev'); break;
      case 'Home': nav('goto', 0); break;
      case 'End': if (mode === 'presenter') sendNav('goto', slides.length - 1); else show(slides.length - 1, maxStep(slides[slides.length - 1]), 1); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'o': case 'O': toggleOverview(); break;
      case 'Escape': if (!document.fullscreenElement && !document.webkitFullscreenElement) toggleOverview(); else return; break;
      case 'b': case 'B': case '.': if (mode === 'play') toggleBlack(); break;
      case 'n': case 'N': if (mode === 'play') openPresenter(); break;
      case '?': case 'h': case 'H': toggleHelp(); break;
      default: return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  });
  if (mode === 'play') {
    document.addEventListener('click', function (e) {
      if (e.target.closest('a,video,audio,button,input,select,textarea,#kh-overview,#kh-help,[contenteditable]')) return;
      if (blackEl && blackEl.classList.contains('kh-on')) { toggleBlack(); return; }
      next();
    });
    var tx = null, ty = null;
    document.addEventListener('touchstart', function (e) { var t = e.changedTouches[0]; tx = t.clientX; ty = t.clientY; }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (tx == null) return; var t = e.changedTouches[0]; var dx = t.clientX - tx, dy = t.clientY - ty; tx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) next(); else prev(); }
    }, { passive: true });
    document.addEventListener('mousemove', function () {
      document.body.style.cursor = '';
      clearTimeout(cursorTimer);
      cursorTimer = setTimeout(function () { document.body.style.cursor = 'none'; }, 3000);
    });
  }
  if (mode !== 'preview') window.addEventListener('hashchange', function () { var n = slideFromHash(); if (n !== cur) show(n, 0, 0); });
  window.addEventListener('resize', layout);

  // ---- init -----------------------------------------------------------------
  window.khPlayer = { next: next, prev: prev, show: show, slides: slides, overview: toggleOverview, presenter: openPresenter,
                      attachPresenter: function (w) { presenterWin = w; notifyPresenter(); },
                      current: function () { return { index: cur, step: step, slide: slides[cur] }; }, mode: mode };
  function init() {
    if (mode === 'print') {
      document.body.classList.add('kh-print');
      allSlides.forEach(function (s) { s.classList.add('kh-current'); applyBuilds(s, 9999, false); });
      assertWraps();
    } else {
      if (mode === 'presenter') {
        setupPresenter();
        if (params.has('fs')) { // opened by the editor's Play on two displays: go fullscreen on the first key or click
          var fsOnce = function () {
            document.removeEventListener('keydown', fsOnce, true); document.removeEventListener('pointerdown', fsOnce, true);
            if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
          };
          document.addEventListener('keydown', fsOnce, true); document.addEventListener('pointerdown', fsOnce, true);
        }
      }
      if (deck.getAttribute('data-slide-numbers') === '1' && mode === 'play') {
        numEl = el('div'); numEl.id = 'kh-num'; deck.appendChild(numEl);
      }
      allSlides.forEach(function (s) { applyBuilds(s, 0, false); });
      hook('kh:ready', { mode: mode, slides: slides });
      if (mode === 'preview') show(preview.slide | 0, preview.step == null ? 9999 : preview.step, 0);
      else show(slideFromHash(), 0, 0);
      layout();
      setTimeout(layout, 50);
      if (rehearse) startRehearsal();
    }
  }
  // Deferred so that custom scripts placed after the player can register kh:* listeners first.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
})();
