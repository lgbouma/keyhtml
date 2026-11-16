"""Local HTTP server that backs the keyhtml editor.

Everything is served from 127.0.0.1 only. The server exposes:

  GET  /edit                  editor UI
  GET  /static/<path>         editor assets
  GET  /files/<path>          files under the root directory (decks, assets) with Range support
  GET  /api/info              server info
  GET  /api/list?dir=<rel>    list .html decks and sub-directories
  GET  /api/load?file=<rel>   {html, mtime, exists}
  GET  /api/stat?file=<rel>   {mtime, size, exists}  cheap poll for changes made outside the editor
  POST /api/save              {file, html, mtime} -> {mtime}
  POST /api/upload?file=<deck>&name=<filename>[&page=N]   raw body = file bytes
  POST /api/import            {file, path, page}  copy a local file into the deck's assets
  POST /api/pdfpage           {file, pdf, page}   convert another page of an imported PDF
  POST /api/export            {file, html, inline_video} write a single-file standalone copy
  POST /api/reveal            {file} reveal a file in the Finder (macOS)
"""
import base64
import hashlib
import json
import mimetypes
import os
import posixpath
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__, pdfconvert

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".avif", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".m4v", ".webm", ".mov", ".ogv", ".mkv"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"}

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("video/mp4", ".m4v")
mimetypes.add_type("video/quicktime", ".mov")
mimetypes.add_type("image/avif", ".avif")
mimetypes.add_type("application/javascript", ".js")


class AppError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class App:
    def __init__(self, root):
        self.root = os.path.realpath(os.path.abspath(root))

    # ---- paths -----------------------------------------------------------
    def resolve(self, rel):
        """Map a root-relative path to an absolute path, refusing escapes."""
        rel = (rel or "").replace("\\", "/")
        rel = urllib.parse.unquote(rel)
        p = os.path.realpath(os.path.join(self.root, rel.lstrip("/")))
        try:
            common = os.path.commonpath([self.root, p])
        except ValueError:
            common = None
        if common != self.root:
            raise AppError("path escapes the root directory", 403)
        return p

    def relpath(self, abs_path):
        return os.path.relpath(abs_path, self.root).replace(os.sep, "/")

    def assets_dir(self, deck_rel):
        deck_abs = self.resolve(deck_rel)
        stem = os.path.splitext(os.path.basename(deck_abs))[0]
        d = os.path.join(os.path.dirname(deck_abs), stem + "_assets")
        os.makedirs(d, exist_ok=True)
        return d

    @staticmethod
    def asset_url(deck_rel, asset_abs):
        """URL of an asset relative to the deck file's directory."""
        deck_dir = os.path.dirname(os.path.abspath(deck_rel))
        rel = os.path.relpath(asset_abs, os.path.dirname(asset_abs))
        return posixpath.join(os.path.basename(os.path.dirname(asset_abs)), rel)

    # ---- api -------------------------------------------------------------
    def info(self):
        return {
            "version": __version__,
            "root": self.root,
            "pdf_backend": pdfconvert.available_backend(),
            "platform": sys.platform,
        }

    def list_dir(self, rel):
        d = self.resolve(rel or ".")
        if not os.path.isdir(d):
            raise AppError("not a directory", 404)
        decks, dirs = [], []
        for name in sorted(os.listdir(d), key=str.lower):
            if name.startswith("."):
                continue
            p = os.path.join(d, name)
            if os.path.isdir(p):
                if not name.endswith("_assets") and name not in ("node_modules", "__pycache__"):
                    dirs.append(name)
            elif name.lower().endswith((".html", ".htm")):
                st = os.stat(p)
                decks.append({"name": name, "size": st.st_size, "mtime": st.st_mtime})
        return {"dir": self.relpath(d) if d != self.root else "", "dirs": dirs, "decks": decks, "root": self.root}

    def load(self, rel):
        p = self.resolve(rel)
        if not os.path.exists(p):
            return {"html": "", "mtime": 0, "exists": False, "file": rel}
        with open(p, "r", encoding="utf-8", errors="replace") as fh:
            html = fh.read()
        return {"html": html, "mtime": os.stat(p).st_mtime, "exists": True, "file": rel}

    def stat(self, rel):
        p = self.resolve(rel)
        if not os.path.exists(p):
            return {"mtime": 0, "size": 0, "exists": False, "file": rel}
        st = os.stat(p)
        return {"mtime": st.st_mtime, "size": st.st_size, "exists": True, "file": rel}

    def save(self, rel, html, expected_mtime=None, force=False):
        p = self.resolve(rel)
        if not rel.lower().endswith((".html", ".htm")):
            raise AppError("deck file name must end in .html")
        if os.path.exists(p) and expected_mtime is not None and not force:
            actual = os.stat(p).st_mtime
            if abs(actual - float(expected_mtime)) > 1e-3 and float(expected_mtime) != 0:
                raise AppError("file changed on disk since it was loaded", 409)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if os.path.exists(p):
            try:
                shutil.copy2(p, p + ".bak")
            except OSError:
                pass
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(html)
        os.replace(tmp, p)
        return {"mtime": os.stat(p).st_mtime, "file": rel, "size": len(html)}

    # ---- assets ----------------------------------------------------------
    @staticmethod
    def sanitize_name(name):
        name = os.path.basename(name or "file")
        name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._") or "file"
        return name

    @staticmethod
    def _digest(data):
        return hashlib.sha1(data).hexdigest()

    def _place_bytes(self, assets, name, data):
        """Write bytes into the assets dir, reusing identical files, renaming on clash."""
        base, ext = os.path.splitext(name)
        candidate = os.path.join(assets, name)
        i = 1
        digest = self._digest(data)
        while os.path.exists(candidate):
            with open(candidate, "rb") as fh:
                if self._digest(fh.read()) == digest:
                    return candidate
            i += 1
            candidate = os.path.join(assets, "%s-%d%s" % (base, i, ext))
        with open(candidate, "wb") as fh:
            fh.write(data)
        return candidate

    def _describe_asset(self, deck_rel, abs_path, page=1):
        assets = os.path.dirname(abs_path)
        name = os.path.basename(abs_path)
        ext = os.path.splitext(name)[1].lower()
        url_dir = os.path.basename(assets)
        out = {"name": name, "url": posixpath.join(url_dir, name), "size": os.path.getsize(abs_path)}
        if ext == ".pdf":
            n = pdfconvert.page_count(abs_path)
            page = max(1, min(int(page or 1), n))
            svg_abs = self._pdf_page_svg(abs_path, page)
            out.update({"kind": "pdf", "pdf": out["url"], "pages": n, "page": page,
                        "url": posixpath.join(url_dir, os.path.basename(svg_abs))})
            size = pdfconvert.svg_size(svg_abs)
            if size:
                out["width"], out["height"] = size
        elif ext in IMAGE_EXT:
            out["kind"] = "image"
            if ext == ".svg":
                size = pdfconvert.svg_size(abs_path)
                if size:
                    out["width"], out["height"] = size
        elif ext in VIDEO_EXT:
            out["kind"] = "video"
        elif ext in AUDIO_EXT:
            out["kind"] = "audio"
        else:
            out["kind"] = "file"
        return out

    @staticmethod
    def _pdf_page_svg(pdf_abs, page):
        stem = os.path.splitext(pdf_abs)[0]
        svg_abs = "%s.p%d.svg" % (stem, page)
        if not os.path.exists(svg_abs) or os.path.getmtime(svg_abs) < os.path.getmtime(pdf_abs):
            pdfconvert.pdf_to_svg(pdf_abs, page, svg_abs)
        return svg_abs

    def upload(self, deck_rel, name, data, page=1):
        if not deck_rel:
            raise AppError("missing deck file")
        assets = self.assets_dir(deck_rel)
        name = self.sanitize_name(name)
        abs_path = self._place_bytes(assets, name, data)
        return self._describe_asset(deck_rel, abs_path, page)

    def import_path(self, deck_rel, path, page=1):
        path = os.path.expanduser(path or "")
        if not os.path.isabs(path):
            path = os.path.join(self.root, path)
        if not os.path.isfile(path):
            raise AppError("no such file: %s" % path, 404)
        with open(path, "rb") as fh:
            data = fh.read()
        return self.upload(deck_rel, os.path.basename(path), data, page)

    def pdf_page(self, deck_rel, pdf_url, page):
        deck_dir = os.path.dirname(self.resolve(deck_rel))
        pdf_abs = os.path.realpath(os.path.join(deck_dir, pdf_url))
        if os.path.commonpath([self.root, pdf_abs]) != self.root:
            raise AppError("bad path", 403)
        if not os.path.isfile(pdf_abs):
            raise AppError("pdf not found: %s" % pdf_url, 404)
        return self._describe_asset(deck_rel, pdf_abs, page)

    # ---- export ----------------------------------------------------------
    def export_standalone(self, deck_rel, html, inline_video=True):
        deck_abs = self.resolve(deck_rel)
        deck_dir = os.path.dirname(deck_abs)
        skipped = []

        def to_data_uri(rel_url):
            if re.match(r"^(data:|https?:|//|blob:|#)", rel_url):
                return None
            p = os.path.realpath(os.path.join(deck_dir, urllib.parse.unquote(rel_url.split("?")[0].split("#")[0])))
            if not os.path.isfile(p):
                return None
            ext = os.path.splitext(p)[1].lower()
            if ext in VIDEO_EXT | AUDIO_EXT and not inline_video:
                skipped.append(rel_url)
                return None
            mime = mimetypes.guess_type(p)[0] or "application/octet-stream"
            with open(p, "rb") as fh:
                b = fh.read()
            return "data:%s;base64,%s" % (mime, base64.b64encode(b).decode("ascii"))

        def repl_attr(m):
            uri = to_data_uri(m.group(3))
            if uri is None:
                return m.group(0)
            return "%s%s%s%s" % (m.group(1), m.group(2), uri, m.group(2))

        out = re.sub(r'((?:src|poster|href)=)(["\'])([^"\']+)\2', repl_attr, html)

        def repl_url(m):
            uri = to_data_uri(m.group(2))
            if uri is None:
                return m.group(0)
            return "url(%s%s%s)" % (m.group(1), uri, m.group(1))

        out = re.sub(r"url\((['\"]?)([^)'\"]+)\1\)", repl_url, out)
        stem = os.path.splitext(deck_abs)[0]
        target = stem + "_standalone.html"
        with open(target, "w", encoding="utf-8") as fh:
            fh.write(out)
        return {"file": self.relpath(target), "path": target, "size": os.path.getsize(target), "skipped": skipped}

    def reveal(self, rel):
        p = self.resolve(rel)
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", p])
        elif sys.platform.startswith("win"):
            subprocess.Popen(["explorer", "/select,", p])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(p)])
        return {"ok": True}


class Handler(BaseHTTPRequestHandler):
    app = None  # type: App
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("KEYHTML_DEBUG"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---- helpers ---------------------------------------------------------
    def _send(self, status, body, ctype="text/plain; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, status=200):
        self._send(status, json.dumps(obj), "application/json; charset=utf-8")

    def _error(self, message, status=400):
        self._json({"error": message}, status)

    def _read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _read_json(self):
        body = self._read_body()
        try:
            return json.loads(body.decode("utf-8") or "{}")
        except ValueError:
            raise AppError("invalid JSON body")

    def _send_file(self, path, download_name=None):
        if not os.path.isfile(path):
            return self._error("not found", 404)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        size = os.path.getsize(path)
        start, end = 0, size - 1
        status = 200
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                s, e = m.group(1), m.group(2)
                if s:
                    start = int(s)
                    end = int(e) if e else size - 1
                elif e:
                    start = max(0, size - int(e))
                    end = size - 1
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % size)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(path)))
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        if download_name:
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % download_name)
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as fh:
            fh.seek(start)
            remaining = length
            try:
                while remaining > 0:
                    chunk = fh.read(min(1 << 16, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    # ---- routing ---------------------------------------------------------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            self._route_get()
        except AppError as e:
            self._error(str(e), e.status)
        except Exception as e:  # pragma: no cover
            self._error("%s: %s" % (type(e).__name__, e), 500)

    def do_POST(self):
        try:
            self._route_post()
        except AppError as e:
            self._error(str(e), e.status)
        except Exception as e:  # pragma: no cover
            import traceback
            traceback.print_exc()
            self._error("%s: %s" % (type(e).__name__, e), 500)

    def _route_get(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        q = lambda k, d=None: qs.get(k, [d])[0]

        if path in ("/", "/edit", "/edit/"):
            if path == "/":
                self.send_response(302)
                self.send_header("Location", "/edit" + ("?" + parsed.query if parsed.query else ""))
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            return self._send_file(os.path.join(STATIC_DIR, "editor.html"))

        if path.startswith("/static/"):
            rel = urllib.parse.unquote(path[len("/static/"):])
            p = os.path.realpath(os.path.join(STATIC_DIR, rel))
            if os.path.commonpath([STATIC_DIR, p]) != STATIC_DIR:
                return self._error("forbidden", 403)
            return self._send_file(p)

        if path.startswith("/files/"):
            p = self.app.resolve(path[len("/files/"):])
            if os.path.isdir(p):
                return self._error("is a directory", 404)
            return self._send_file(p)

        if path == "/api/info":
            return self._json(self.app.info())
        if path == "/api/list":
            return self._json(self.app.list_dir(q("dir", "")))
        if path == "/api/load":
            f = q("file")
            if not f:
                raise AppError("missing file")
            return self._json(self.app.load(f))
        if path == "/api/stat":
            f = q("file")
            if not f:
                raise AppError("missing file")
            return self._json(self.app.stat(f))
        if path == "/favicon.ico":
            return self._send(204, b"")
        return self._error("not found", 404)

    def _route_post(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        q = lambda k, d=None: qs.get(k, [d])[0]

        if path == "/api/save":
            data = self._read_json()
            return self._json(self.app.save(data.get("file"), data.get("html", ""), data.get("mtime"), data.get("force", False)))
        if path == "/api/upload":
            body = self._read_body()
            return self._json(self.app.upload(q("file"), q("name", "upload"), body, q("page", 1)))
        if path == "/api/import":
            data = self._read_json()
            return self._json(self.app.import_path(data.get("file"), data.get("path"), data.get("page", 1)))
        if path == "/api/pdfpage":
            data = self._read_json()
            return self._json(self.app.pdf_page(data.get("file"), data.get("pdf"), int(data.get("page", 1))))
        if path == "/api/export":
            data = self._read_json()
            return self._json(self.app.export_standalone(data.get("file"), data.get("html", ""), data.get("inline_video", True)))
        if path == "/api/reveal":
            data = self._read_json()
            return self._json(self.app.reveal(data.get("file")))
        return self._error("not found", 404)


def make_server(root, host="127.0.0.1", port=8765, max_tries=20):
    app = App(root)
    handler = type("KeyhtmlHandler", (Handler,), {"app": app})
    last = None
    for i in range(max_tries):
        try:
            srv = ThreadingHTTPServer((host, port + i), handler)
            srv.daemon_threads = True
            return srv, app
        except OSError as e:
            last = e
    raise last
