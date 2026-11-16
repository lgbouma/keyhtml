"""PDF -> SVG conversion with several interchangeable backends.

Preferred backend is PyMuPDF (``pip install pymupdf``) because it needs no
system packages. Fallbacks are command-line tools: pdftocairo (poppler),
mutool (mupdf), inkscape, pdf2svg.
"""
import os
import re
import shutil
import subprocess


def _pymupdf():
    try:
        import pymupdf  # noqa: F401
        return pymupdf
    except ImportError:
        try:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                import fitz  # older PyMuPDF
            return fitz
        except ImportError:
            return None


CLI_TOOLS = ("pdftocairo", "mutool", "inkscape", "pdf2svg")


def available_backend():
    if _pymupdf() is not None:
        return "pymupdf"
    for tool in CLI_TOOLS:
        if shutil.which(tool):
            return tool
    return None


def page_count(pdf_path):
    mod = _pymupdf()
    if mod is not None:
        with mod.open(pdf_path) as doc:
            return doc.page_count
    if shutil.which("pdfinfo"):
        try:
            out = subprocess.run(["pdfinfo", pdf_path], capture_output=True, text=True, check=True).stdout
            m = re.search(r"^Pages:\s+(\d+)", out, re.M)
            if m:
                return int(m.group(1))
        except Exception:
            pass
    with open(pdf_path, "rb") as fh:
        data = fh.read()
    n = len(re.findall(rb"/Type\s*/Page(?![s/\w])", data))
    return max(n, 1)


def page_size(pdf_path, page=1):
    """Return (width, height) in PDF points if known, else None."""
    mod = _pymupdf()
    if mod is not None:
        with mod.open(pdf_path) as doc:
            p = doc[page - 1]
            return (p.rect.width, p.rect.height)
    return None


def pdf_to_svg(pdf_path, page, out_path):
    """Render 1-based ``page`` of ``pdf_path`` to an SVG file at ``out_path``.

    Text is converted to outlines so the result is self-contained and renders
    identically everywhere. Returns a dict with ``backend`` and, if known,
    ``width``/``height`` in points.
    """
    page = int(page)
    mod = _pymupdf()
    if mod is not None:
        with mod.open(pdf_path) as doc:
            if page < 1 or page > doc.page_count:
                raise ValueError("page %d out of range (1..%d)" % (page, doc.page_count))
            p = doc[page - 1]
            svg = p.get_svg_image(text_as_path=True)
            with open(out_path, "w", encoding="utf-8") as fh:
                fh.write(svg)
            return {"backend": "pymupdf", "width": p.rect.width, "height": p.rect.height}

    if shutil.which("pdftocairo"):
        subprocess.run(["pdftocairo", "-svg", "-f", str(page), "-l", str(page), pdf_path, out_path], check=True)
        return {"backend": "pdftocairo"}

    if shutil.which("mutool"):
        # mutool wants a %d pattern for multi-page output; with a single page it
        # writes the file directly if no pattern is present.
        subprocess.run(["mutool", "draw", "-F", "svg", "-O", "text=path", "-o", out_path, pdf_path, str(page)], check=True)
        return {"backend": "mutool"}

    if shutil.which("inkscape"):
        subprocess.run(["inkscape", "--pdf-page=%d" % page, "--export-type=svg", "--export-plain-svg",
                        "--export-text-to-path", "--export-filename=%s" % out_path, pdf_path], check=True)
        return {"backend": "inkscape"}

    if shutil.which("pdf2svg"):
        subprocess.run(["pdf2svg", pdf_path, out_path, str(page)], check=True)
        return {"backend": "pdf2svg"}

    raise RuntimeError(
        "No PDF->SVG converter available. Install one with:  pip install pymupdf   "
        "(or: brew install poppler, which provides pdftocairo)")


def svg_size(svg_path):
    """Best-effort intrinsic size of an SVG file (width, height) in user units."""
    try:
        with open(svg_path, "r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(4096)
    except OSError:
        return None
    m = re.search(r"<svg[^>]*>", head, re.S)
    if not m:
        return None
    tag = m.group(0)
    vb = re.search(r'viewBox="([^"]+)"', tag)
    if vb:
        parts = vb.group(1).replace(",", " ").split()
        if len(parts) == 4:
            try:
                return (float(parts[2]), float(parts[3]))
            except ValueError:
                pass
    w = re.search(r'\swidth="([\d.]+)', tag)
    h = re.search(r'\sheight="([\d.]+)', tag)
    if w and h:
        return (float(w.group(1)), float(h.group(1)))
    return None
