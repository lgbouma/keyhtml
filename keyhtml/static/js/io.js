/* keyhtml editor — talking to the local server: load/save decks, upload media, export. */
KH.io = (function () {
  var IO = { dirty: false, saving: false, autosave: true };
  var M = KH.model, C = null, h = KH.h;

  IO.api = function (path, body, raw) {
    var opts = { method: body === undefined ? 'GET' : 'POST' };
    if (body !== undefined) {
      if (raw) opts.body = body; else { opts.body = JSON.stringify(body); opts.headers = { 'Content-Type': 'application/json' }; }
    }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return { error: r.statusText }; }).then(function (j) {
        if (!r.ok || j.error) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  };

  IO.init = function () {
    C = KH.canvas;
    try { IO.autosave = localStorage.getItem('keyhtml.autosave') !== '0'; } catch (e) {}
    KH.on('change', function () { IO.markDirty(); });
    window.addEventListener('beforeunload', function (e) { if (IO.dirty) { e.preventDefault(); e.returnValue = ''; } });
    var fi = KH.$('#file-input');
    fi.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fi.files || []);
      var cb = fi._cb; fi._cb = null; fi.value = '';
      if (cb) cb(files); else IO.insertFiles(files);
    });
  };
  IO.setAutosave = function (on) { IO.autosave = on; try { localStorage.setItem('keyhtml.autosave', on ? '1' : '0'); } catch (e) {} IO.status(); };

  IO.loadAssets = function () {
    return Promise.all(['/static/deck.css', '/static/player.css', '/static/player.js'].map(function (p) { return fetch(p).then(function (r) { return r.text(); }); }))
      .then(function (t) { KH.assets = { deckCss: t[0].trim(), playerCss: t[1].trim(), playerJs: t[2].trim() }; });
  };

  // ---------------------------------------------------------------- files
  IO.setFile = function (file) {
    file = file.replace(/^\/+/, '');
    M.file = file;
    M.dir = file.indexOf('/') >= 0 ? file.slice(0, file.lastIndexOf('/')) : '';
    var base = KH.$('base');
    base.href = '/files/' + (M.dir ? M.dir.split('/').map(encodeURIComponent).join('/') + '/' : '');
    document.title = file.replace(/^.*\//, '') + ' — keyhtml';
    try { var u = new URL(location.href); u.searchParams.set('file', file); history.replaceState(null, '', u.toString()); } catch (e) {}
  };
  IO.openFile = function (file) {
    if (KH.text.editing) KH.text.exit(true);
    return IO.api('/api/load?file=' + encodeURIComponent(file)).then(function (res) {
      IO.setFile(file);
      M.exists = res.exists; M.mtime = res.mtime || 0;
      var imported = false;
      if (res.exists && res.html.trim()) {
        M.loadHtml(res.html);
        imported = !/class="kh-deck/.test(res.html);
      } else {
        M.newDeck(file.replace(/^.*\//, '').replace(/\.html?$/i, ''));
      }
      IO.applyCustomCss();
      C.mount(M.deck);
      M.setCurrent(0);
      KH.nav.selected = [0];
      M.history.reset();
      KH.sync.setBase(res.exists ? res.html : '', M.mtime);
      IO.dirty = false;
      KH.emit('load');
      KH.nav.refresh();
      KH.inspector.refresh();
      IO.status();
      // a keyhtml deck whose slides had no data-kh-id yet: write the ids so outside edits can be merged
      if (res.exists && res.html.trim() && !imported && M.idsAssigned) IO.markDirty();
      if (imported) KH.toast('Imported a non-keyhtml HTML file: each section became a slide. Save to write it in keyhtml format (a .bak of the original is kept).', 'ok', 7000);
      else if (!res.exists) KH.toast('New presentation. It will be written to ' + file + ' on save.', '', 3500);
      // re-render equations once MathJax is up if the deck has none yet rendered (older files)
      return res;
    }).catch(function (e) { KH.toast('Could not open ' + file + ': ' + e.message, 'error'); throw e; });
  };
  IO.applyCustomCss = function () {
    var st = KH.$('#custom-css');
    if (!st) { st = h('style', { id: 'custom-css' }); document.head.appendChild(st); }
    st.textContent = M.customCss ? M.scopeCss(M.customCss) : '';
  };

  var autosaveTimer = KH.debounce(function () {
    if (!(IO.autosave && IO.dirty && !IO.saving && M.file)) return;
    // Saving exits text editing (and drops the text selection), so wait until the user is done
    // editing and no color picker is open; leaving edit mode marks the deck dirty again anyway.
    if (KH.text.editing || (KH.inspector && KH.inspector.pickerOpen)) return autosaveTimer();
    IO.save({ quiet: true });
  }, 1500);
  IO.markDirty = function () { IO.dirty = true; IO.status(); autosaveTimer(); };
  IO.status = function (text) {
    var el = KH.$('#tb-status');
    if (!el) return;
    if (text) { el.textContent = text; el.className = 'tb-status'; return; }
    if (IO.saving) { el.textContent = 'Saving…'; el.className = 'tb-status'; }
    else if (IO.dirty) { el.textContent = IO.autosave ? 'Edited' : 'Unsaved changes'; el.className = 'tb-status dirty'; }
    else { el.textContent = M.file ? 'Saved' : ''; el.className = 'tb-status'; }
    var sb = KH.$('#sb-left'); if (sb) sb.textContent = (M.file || '') + (M.deck ? '  ·  ' + M.slides().length + ' slides' : '');
  };
  IO.save = function (opts) {
    opts = opts || {};
    if (!M.file) return IO.saveAs();
    if (KH.sync.busy) return KH.sync.whenIdle().then(function () { return IO.save(opts); }); // a disk merge is in progress
    if (KH.text.editing) KH.text.exit();
    if (IO.saving) { IO._again = true; return Promise.resolve(); }
    IO.saving = true; IO.status();
    var snap = KH.sync.capture(); // what is being written becomes the merge base
    var html = M.buildHtml();
    return IO.api('/api/save', { file: M.file, html: html, mtime: M.mtime, force: !!opts.force }).then(function (res) {
      M.mtime = res.mtime; M.exists = true; IO.dirty = false; IO.saving = false;
      KH.sync.setBase(html, res.mtime, snap);
      IO.status();
      if (!opts.quiet) KH.toast('Saved ' + M.file + ' (' + KH.fmtBytes(res.size) + ')', 'ok', 1500);
      if (IO._again) { IO._again = false; if (IO.dirty) autosaveTimer(); }
    }).catch(function (e) {
      IO.saving = false; IO.status();
      if (e.status === 409 && (opts._merges || 0) < 3) {
        // changed outside the editor: merge slide by slide, then save the result
        return KH.sync.resolveConflict().then(function (ok) {
          if (ok) return IO.save(Object.assign({}, opts, { _merges: (opts._merges || 0) + 1 }));
          return KH.ui.confirm('File changed on disk', M.file + ' was modified outside keyhtml and the changes could not be merged slide by slide. Overwrite it with the version in the editor? (The current file is kept as ' + M.file.replace(/^.*\//, '') + '.bak.)', 'Overwrite')
            .then(function (yes) { if (yes) return IO.save({ force: true }); });
        });
      }
      if (e.status === 409) {
        return KH.ui.confirm('File changed on disk', M.file + ' was modified outside keyhtml since it was loaded. Overwrite it with the version in the editor?', 'Overwrite')
          .then(function (ok) { if (ok) return IO.save({ force: true }); });
      }
      KH.toast('Save failed: ' + e.message, 'error');
    });
  };
  IO.saveAs = function () {
    return KH.ui.prompt('Save a copy as', 'File name (relative to ' + (KH.info ? KH.info.root : 'the root') + ')', M.file || 'talk.html').then(function (name) {
      if (!name) return;
      if (!/\.html?$/i.test(name)) name += '.html';
      IO.setFile(name); M.mtime = 0; M.exists = false;
      return IO.save();
    });
  };
  IO.newDeck = function () { KH.ui.openDialog(); };

  // ---------------------------------------------------------------- media
  IO.pickFiles = function (accept, multiple, cb) {
    var fi = KH.$('#file-input');
    fi.accept = accept || ''; fi.multiple = !!multiple; fi._cb = cb || null;
    fi.click();
  };
  IO.upload = function (file, page) {
    if (!M.file) return Promise.reject(new Error('open or create a presentation first'));
    var url = '/api/upload?file=' + encodeURIComponent(M.file) + '&name=' + encodeURIComponent(file.name) + '&page=' + (page || 1);
    return IO.api(url, file, true);
  };
  function imageSize(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 }); };
      img.onerror = function () { resolve({ w: 800, h: 600 }); };
      img.src = src;
    });
  }
  function mediaSize(src, kind) {
    return new Promise(function (resolve) {
      if (kind === 'audio') return resolve({ w: 900, h: 60 });
      var v = document.createElement('video');
      var done = false;
      var finish = function (w, hh) { if (done) return; done = true; v.remove(); resolve({ w: w, h: hh }); };
      v.preload = 'metadata'; v.muted = true;
      v.addEventListener('loadedmetadata', function () { finish(v.videoWidth || 1280, v.videoHeight || 720); });
      v.addEventListener('error', function () { finish(1280, 720); });
      setTimeout(function () { finish(1280, 720); }, 4000);
      v.src = src;
    });
  }
  IO.insertAsset = function (res, point) {
    var kind = res.kind;
    if (kind === 'image' || kind === 'pdf') {
      return imageSize(res.url).then(function (nat) {
        if (res.width && res.height) nat = { w: res.width, h: res.height };
        var vector = kind === 'pdf' || /\.svg$/i.test(res.url);
        var fit = C.fitSize(nat.w, nat.h, vector ? 0.78 : 0.8, vector);
        var el = M.create.image({ src: res.url, pdf: res.pdf, page: res.page, pages: res.pages, x: 0, y: 0, w: fit.w, h: fit.h, alt: res.name });
        C.centerAt(el, fit.w, fit.h, point);
        C.insert(el);
        return el;
      });
    }
    if (kind === 'video' || kind === 'audio') {
      return mediaSize(res.url, kind).then(function (nat) {
        var fit = kind === 'audio' ? nat : C.fitSize(nat.w, nat.h, 0.8, true);
        var el = M.create.video({ src: res.url, kind: kind, x: 0, y: 0, w: fit.w, h: fit.h });
        C.centerAt(el, fit.w, fit.h, point);
        var v = el.querySelector('video,audio'); if (v) v.muted = true;
        C.insert(el);
        return el;
      });
    }
    KH.toast('Unsupported file type: ' + res.name, 'error');
    return Promise.resolve(null);
  };
  IO.insertFiles = function (files, point) {
    if (!files || !files.length) return Promise.resolve();
    if (!M.file) { KH.toast('Open or create a presentation first', 'error'); return Promise.resolve(); }
    var p = Promise.resolve(), n = 0;
    files.forEach(function (f) {
      p = p.then(function () {
        KH.ui.progress((n + 0.2) / files.length);
        IO.status('Importing ' + f.name + '…');
        return IO.upload(f).then(function (res) {
          return IO.insertAsset(res, point ? { x: point.x + n * 30, y: point.y + n * 30 } : null);
        }).then(function () { n++; KH.ui.progress(n / files.length); });
      });
    });
    return p.then(function () { KH.ui.progress(null); IO.status(); })
      .catch(function (e) { KH.ui.progress(null); IO.status(); KH.toast('Import failed: ' + e.message, 'error'); });
  };
  IO.importPath = function (path, point) {
    return IO.api('/api/import', { file: M.file, path: path }).then(function (res) { return IO.insertAsset(res, point); })
      .catch(function (e) { KH.toast('Import failed: ' + e.message, 'error'); });
  };
  IO.replaceMedia = function (el) {
    var img = el.querySelector('img');
    IO.pickFiles(img ? 'image/*,.pdf,.svg' : 'video/*,audio/*', false, function (files) {
      if (!files.length) return;
      IO.upload(files[0]).then(function (res) {
        if (img && (res.kind === 'image' || res.kind === 'pdf')) {
          img.src = res.url;
          if (res.pdf) { img.setAttribute('data-pdf', res.pdf); img.setAttribute('data-page', String(res.page)); img.setAttribute('data-pages', String(res.pages)); }
          else { img.removeAttribute('data-pdf'); img.removeAttribute('data-page'); img.removeAttribute('data-pages'); }
          return imageSize(res.url).then(function (nat) {
            if (res.width && res.height) nat = { w: res.width, h: res.height };
            var g = M.geom(el); M.setGeom(el, { h: g.w * nat.h / nat.w });
            C.renderSelection(); M.history.push();
          });
        }
        var v = el.querySelector('video,audio');
        if (v && (res.kind === 'video' || res.kind === 'audio')) { v.src = res.url; M.history.push(); return; }
        KH.toast('That file is not a ' + (img ? 'picture/PDF' : 'movie'), 'error');
      }).catch(function (e) { KH.toast('Import failed: ' + e.message, 'error'); });
    });
  };
  IO.pdfPage = function (el, page) {
    var img = el.querySelector('img'); if (!img || !img.getAttribute('data-pdf')) return Promise.resolve();
    IO.status('Extracting page ' + page + '…');
    return IO.api('/api/pdfpage', { file: M.file, pdf: img.getAttribute('data-pdf'), page: page }).then(function (res) {
      img.src = res.url; img.setAttribute('data-page', String(res.page)); if (res.pages) img.setAttribute('data-pages', String(res.pages));
      return imageSize(res.url).then(function (nat) {
        if (res.width && res.height) nat = { w: res.width, h: res.height };
        var g = M.geom(el); M.setGeom(el, { h: g.w * nat.h / nat.w });
        C.renderSelection(); M.history.push(); IO.status();
      });
    }).catch(function (e) { IO.status(); KH.toast('Page extraction failed: ' + e.message, 'error'); });
  };
  IO.naturalSize = function (el) {
    var img = el.querySelector('img'); if (!img) return;
    imageSize(img.src).then(function (nat) {
      var vector = /\.svg($|\?)/i.test(img.src) || img.getAttribute('data-pdf');
      var fit = vector ? C.fitSize(nat.w, nat.h, 0.78, true) : C.fitSize(nat.w, nat.h, 1, false);
      var g = M.geom(el); M.setGeom(el, { w: fit.w, h: fit.h });
      C.renderSelection(); M.history.push();
    });
  };

  // ---------------------------------------------------------------- play / export
  IO.deckUrl = function () { return '/files/' + M.file.split('/').map(encodeURIComponent).join('/'); };
  /* Slideshow. Play shows the deck fullscreen in an overlay of this window. With an extended second
     display (Chrome's Window Management API, asked for once), the slides go fullscreen on the external
     display and the presenter window opens on the built-in one. With one display, or when mirroring,
     the slides go fullscreen on this display. Exiting fullscreen (Esc) ends the show. */
  var showing = null;
  function pickScreens() {
    if (!window.getScreenDetails || !(window.screen && window.screen.isExtended)) return Promise.resolve(null);
    return window.getScreenDetails().then(function (d) {
      var ss = d.screens; if (ss.length < 2) return null;
      var presenter = ss.filter(function (s) { return s.isInternal; })[0] || d.currentScreen;
      var audience = ss.filter(function (s) { return s !== presenter; })
        .sort(function (a, b) { return b.width * b.height - a.width * a.height; })[0];
      return audience && presenter ? { audience: audience, presenter: presenter } : null;
    }).catch(function () { return null; });
  }
  function endShow() {
    if (!showing) return;
    var sh = showing; showing = null;
    if (document.fullscreenElement === sh.ov && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    sh.ov.remove();
    if (sh.pres) try { sh.pres.close(); } catch (e) {}
    window.focus();
  }
  function attachPresenter() { // the presenter window's opener is this editor; link it to the player in the overlay
    var tries = 0;
    (function go() {
      if (!showing || !showing.pres) return;
      var pl = showing.fr.contentWindow && showing.fr.contentWindow.khPlayer;
      if (pl && pl.attachPresenter) pl.attachPresenter(showing.pres);
      else if (tries++ < 50) setTimeout(go, 100);
    })();
  }
  function startShow(n, scr) {
    var url = IO.deckUrl();
    var ov = document.createElement('div'); ov.id = 'kh-show';
    var fr = document.createElement('iframe'); fr.src = url + '#' + n; fr.setAttribute('allow', 'fullscreen');
    fr.addEventListener('load', function () { if (showing && showing.fr === fr && document.fullscreenElement === ov) fr.contentWindow.focus(); });
    ov.appendChild(fr); document.body.appendChild(ov);
    showing = { ov: ov, fr: fr, pres: null, n: n };
    var opts = scr ? { screen: scr.audience, navigationUI: 'hide' } : { navigationUI: 'hide' };
    var go = function () {
      var p; try { p = ov.requestFullscreen(opts); } catch (e) { p = Promise.reject(e); }
      // The presenter window must open in the same user activation as the fullscreen request.
      if (scr && !showing.pres) {
        var s = scr.presenter;
        showing.pres = window.open(url + '?presenter&fs#' + n, 'khpresenter',
          'popup,left=' + s.availLeft + ',top=' + s.availTop + ',width=' + s.availWidth + ',height=' + s.availHeight);
      }
      return Promise.resolve(p).then(function () { fr.focus(); if (fr.contentWindow) fr.contentWindow.focus(); });
    };
    go().catch(function () {
      // No user activation left (e.g. it was used up by the permission prompt): ask for one more click.
      if (!showing) return;
      var b = document.createElement('button'); b.className = 'kh-show-start';
      b.textContent = 'Click to start the slideshow  ·  Esc cancels';
      ov.appendChild(b); b.focus();
      b.addEventListener('click', function () { b.remove(); go().catch(endShow); });
      b.addEventListener('keydown', function (e) { if (e.key === 'Escape') endShow(); });
    });
  }
  document.addEventListener('fullscreenchange', function () {
    if (showing && document.fullscreenElement !== showing.ov) endShow();
  });
  window.addEventListener('message', function (ev) { // relay between the presenter window and the player
    var d = ev.data;
    if (!showing || !showing.pres || ev.source !== showing.pres || !d || !d.kh) return;
    if (d.kh === 'hello') attachPresenter();
    else if (d.kh === 'nav' && showing.fr.contentWindow) showing.fr.contentWindow.postMessage(d, '*');
  });
  IO.showing = function () { return !!showing; };
  IO.endShow = endShow;
  IO.play = function (fromStart) {
    if (showing) return Promise.resolve();
    var n = fromStart ? 1 : M.cur + 1;
    return IO.save({ quiet: true }).then(pickScreens).then(function (scr) { startShow(n, scr); });
  };
  IO.playInTab = function (fromStart) {
    return IO.save({ quiet: true }).then(function () {
      window.open(IO.deckUrl() + '#' + (fromStart ? 1 : M.cur + 1), 'keyhtml-play');
    });
  };
  IO.print = function () { return IO.save({ quiet: true }).then(function () { window.open(IO.deckUrl() + '?print', '_blank'); }); };
  IO.exportStandalone = function () {
    return KH.ui.confirm('Export standalone HTML', 'Write a single self-contained copy next to the deck (images, PDFs-as-SVG and movies embedded as data URIs). Large movies make large files.', 'Export')
      .then(function (ok) {
        if (!ok) return;
        return IO.save({ quiet: true }).then(function () {
          IO.status('Exporting…');
          return IO.api('/api/export', { file: M.file, html: M.buildHtml(), inline_video: true });
        }).then(function (res) {
          IO.status();
          KH.toast('Exported ' + res.file + ' (' + KH.fmtBytes(res.size) + ')', 'ok', 5000);
        }).catch(function (e) { IO.status(); KH.toast('Export failed: ' + e.message, 'error'); });
      });
  };
  IO.reveal = function () { return IO.api('/api/reveal', { file: M.file }).catch(function (e) { KH.toast(e.message, 'error'); }); };
  return IO;
})();
