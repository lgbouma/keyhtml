"""Unit tests for the keyhtml server-side App (no browser needed).
Run:  python -m unittest discover tests
"""
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from keyhtml import pdfconvert  # noqa: E402
from keyhtml.server import App, AppError  # noqa: E402


class AppTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='keyhtml-test-')
        self.app = App(self.root)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_resolve_refuses_escape(self):
        with self.assertRaises(AppError):
            self.app.resolve('../etc/passwd')
        self.assertTrue(self.app.resolve('a/b.html').startswith(self.app.root))

    def test_save_load_roundtrip_and_backup(self):
        r = self.app.save('talk.html', '<html>v1</html>')
        self.assertTrue(os.path.exists(os.path.join(self.root, 'talk.html')))
        loaded = self.app.load('talk.html')
        self.assertEqual(loaded['html'], '<html>v1</html>')
        self.app.save('talk.html', '<html>v2</html>', r['mtime'])
        self.assertTrue(os.path.exists(os.path.join(self.root, 'talk.html.bak')))
        self.assertEqual(open(os.path.join(self.root, 'talk.html.bak')).read(), '<html>v1</html>')

    def test_save_conflict_detection(self):
        self.app.save('talk.html', 'a')
        with self.assertRaises(AppError) as cm:
            self.app.save('talk.html', 'b', expected_mtime=12345.0)
        self.assertEqual(cm.exception.status, 409)
        self.app.save('talk.html', 'c', expected_mtime=12345.0, force=True)
        self.assertEqual(self.app.load('talk.html')['html'], 'c')

    def test_stat_matches_load_and_save(self):
        self.assertFalse(self.app.stat('talk.html')['exists'])
        r = self.app.save('talk.html', 'hello')
        st = self.app.stat('talk.html')
        self.assertTrue(st['exists'])
        self.assertEqual(st['size'], 5)
        self.assertEqual(st['mtime'], r['mtime'])
        self.assertEqual(st['mtime'], self.app.load('talk.html')['mtime'])

    def test_list(self):
        self.app.save('talk.html', 'x')
        os.makedirs(os.path.join(self.root, 'sub'))
        os.makedirs(os.path.join(self.root, 'talk_assets'))
        res = self.app.list_dir('')
        self.assertEqual([d['name'] for d in res['decks']], ['talk.html'])
        self.assertEqual(res['dirs'], ['sub'])  # asset dirs hidden

    def test_upload_image_dedup_and_rename(self):
        self.app.save('talk.html', 'x')
        a = self.app.upload('talk.html', 'fig.png', b'PNG1')
        self.assertEqual(a['url'], 'talk_assets/fig.png')
        self.assertEqual(a['kind'], 'image')
        b = self.app.upload('talk.html', 'fig.png', b'PNG1')  # identical -> reused
        self.assertEqual(b['url'], 'talk_assets/fig.png')
        c = self.app.upload('talk.html', 'fig.png', b'PNG2')  # different -> renamed
        self.assertEqual(c['url'], 'talk_assets/fig-2.png')
        v = self.app.upload('talk.html', 'clip.mp4', b'MP4')
        self.assertEqual(v['kind'], 'video')

    @unittest.skipUnless(pdfconvert.available_backend(), 'no PDF backend installed')
    def test_pdf_to_svg(self):
        try:
            import pymupdf
        except ImportError:
            self.skipTest('pymupdf needed to generate a test PDF')
        doc = pymupdf.open()
        for i in range(2):
            page = doc.new_page(width=300, height=200)
            page.insert_text((50, 100), 'page %d' % (i + 1), fontsize=24)
        pdf_bytes = doc.tobytes()
        self.app.save('talk.html', 'x')
        res = self.app.upload('talk.html', 'fig.pdf', pdf_bytes)
        self.assertEqual(res['kind'], 'pdf')
        self.assertEqual(res['pages'], 2)
        self.assertEqual(res['url'], 'talk_assets/fig.p1.svg')
        self.assertAlmostEqual(res['width'], 300, delta=1)
        svg = open(os.path.join(self.root, 'talk_assets', 'fig.p1.svg')).read()
        self.assertIn('<svg', svg)
        self.assertNotIn('<text', svg)  # text converted to outlines
        p2 = self.app.pdf_page('talk.html', 'talk_assets/fig.pdf', 2)
        self.assertEqual(p2['url'], 'talk_assets/fig.p2.svg')

    def test_export_standalone_inlines_assets(self):
        self.app.save('talk.html', 'x')
        self.app.upload('talk.html', 'fig.svg', b'<svg xmlns="http://www.w3.org/2000/svg"/>')
        html = '<html><body><img src="talk_assets/fig.svg"><img src="https://x/y.png"></body></html>'
        res = self.app.export_standalone('talk.html', html)
        out = open(res['path']).read()
        self.assertIn('data:image/svg+xml;base64,', out)
        self.assertIn('https://x/y.png', out)
        self.assertNotIn('talk_assets/fig.svg', out)


class PdfConvertTests(unittest.TestCase):
    def test_svg_size_parsing(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, 'a.svg')
        open(p, 'w').write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 432 288" width="432" height="288"></svg>')
        self.assertEqual(pdfconvert.svg_size(p), (432.0, 288.0))
        shutil.rmtree(d)


if __name__ == '__main__':
    unittest.main()
