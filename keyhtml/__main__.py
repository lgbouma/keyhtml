"""Command line entry point: ``keyhtml [deck.html]``."""
import argparse
import os
import sys
import threading
import webbrowser
import urllib.parse

from . import __version__
from .server import make_server


def main(argv=None):
    ap = argparse.ArgumentParser(prog="keyhtml", description="Keynote-like editor for HTML slide decks.")
    ap.add_argument("file", nargs="?", help="deck .html to open (created if missing)")
    ap.add_argument("--root", help="directory to serve (default: the deck's directory, or cwd)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    ap.add_argument("--version", action="version", version="keyhtml " + __version__)
    args = ap.parse_args(argv)

    file_rel = None
    if args.file:
        f = os.path.abspath(args.file)
        if not f.lower().endswith((".html", ".htm")):
            f += ".html"
        root = os.path.abspath(args.root) if args.root else os.path.dirname(f)
        file_rel = os.path.relpath(f, root).replace(os.sep, "/")
        if file_rel.startswith(".."):
            sys.exit("error: %s is not inside --root %s" % (f, root))
    else:
        root = os.path.abspath(args.root or os.getcwd())

    srv, app = make_server(root, args.host, args.port)
    host, port = srv.server_address[:2]
    url = "http://%s:%d/edit" % (host, port)
    if file_rel:
        url += "?file=" + urllib.parse.quote(file_rel)
    print("keyhtml %s" % __version__)
    print("  root:   %s" % app.root)
    print("  editor: %s" % url)
    backend = app.info()["pdf_backend"]
    print("  pdf:    %s" % (backend or "NO CONVERTER FOUND - run: pip install pymupdf"))
    print("Press Ctrl-C to stop.")
    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
