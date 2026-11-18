"""Browser smoke test: the editor and the player load a deck without JavaScript errors.
Needs Playwright with Chromium (pip install playwright && playwright install chromium);
skipped otherwise.  Run:  python -m unittest tests.test_ui_smoke
"""
import os
import shutil
import socket
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from keyhtml.server import make_server  # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

EXAMPLES = os.path.join(os.path.dirname(__file__), '..', 'examples')


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


@unittest.skipUnless(sync_playwright, 'playwright not installed')
class UiSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.mkdtemp(prefix='keyhtml-ui-')
        shutil.copy(os.path.join(EXAMPLES, 'demo.html'), cls.root)
        shutil.copytree(os.path.join(EXAMPLES, 'demo_assets'), os.path.join(cls.root, 'demo_assets'))
        cls.port = free_port()
        cls.srv, _ = make_server(cls.root, '127.0.0.1', cls.port)
        cls.thread = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:%d' % cls.port
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.srv.shutdown()
        cls.srv.server_close()
        shutil.rmtree(cls.root, ignore_errors=True)

    def page(self):
        page = self.browser.new_page(viewport={'width': 1400, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        return page, errors

    def test_editor_loads_deck(self):
        page, errors = self.page()
        page.goto(self.base + '/edit?file=demo.html')
        page.wait_for_selector('#canvas .kh-deck .kh-slide')
        page.wait_for_timeout(500)
        n = page.evaluate("document.querySelectorAll('#canvas .kh-slide').length")
        self.assertGreater(n, 1)
        self.assertGreater(page.evaluate("document.querySelectorAll('.nav-item').length"), 1)
        # a model operation works end to end: insert a shape, undo it
        before = page.evaluate("KH.model.elements().length")
        page.evaluate("KH.toolbar.insertShape('rect')")
        self.assertEqual(page.evaluate("KH.model.elements().length"), before + 1)
        page.keyboard.press('Escape')
        page.evaluate("KH.model.history.undo()")
        self.assertEqual(page.evaluate("KH.model.elements().length"), before)
        self.assertEqual(errors, [])

    def test_player_advances(self):
        page, errors = self.page()
        page.goto(self.base + '/files/demo.html')
        page.wait_for_selector('.kh-slide')
        page.wait_for_timeout(300)
        page.keyboard.press('ArrowRight')
        page.wait_for_timeout(300)
        self.assertEqual(page.evaluate("location.hash"), '#2')
        self.assertEqual(errors, [])
