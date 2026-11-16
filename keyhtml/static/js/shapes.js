/* keyhtml editor — shape helpers. Rect/ellipse/polygon shapes are pure CSS; lines are SVG
   regenerated from data-* attributes whenever the box or its properties change. */
KH.shapes = (function () {
  var S = {};
  S.types = [
    { id: 'rect', name: 'Rectangle', svg: '<rect x="3" y="5" width="22" height="18" rx="1"/>' },
    { id: 'rounded', name: 'Rounded rectangle', svg: '<rect x="3" y="5" width="22" height="18" rx="5"/>' },
    { id: 'ellipse', name: 'Ellipse', svg: '<ellipse cx="14" cy="14" rx="11" ry="9"/>' },
    { id: 'triangle', name: 'Triangle', svg: '<path d="M14 4l11 20H3z"/>' },
    { id: 'diamond', name: 'Diamond', svg: '<path d="M14 3l11 11-11 11L3 14z"/>' },
    { id: 'pentagon', name: 'Pentagon', svg: '<path d="M14 3l11 8-4 13H7L3 11z"/>' },
    { id: 'hexagon', name: 'Hexagon', svg: '<path d="M8 4h12l6 10-6 10H8L2 14z"/>' },
    { id: 'star', name: 'Star', svg: '<path d="M14 3l3 7.5 8 .6-6 5.2 1.9 7.7L14 19.8 7.1 24l1.9-7.7-6-5.2 8-.6z"/>' },
    { id: 'rarrow', name: 'Arrow right', svg: '<path d="M3 10h12V5l10 9-10 9v-5H3z"/>' },
    { id: 'larrow', name: 'Arrow left', svg: '<path d="M25 10H13V5L3 14l10 9v-5h12z"/>' },
    { id: 'chevron', name: 'Chevron', svg: '<path d="M3 5h16l6 9-6 9H3l6-9z"/>' },
    { id: 'line', name: 'Line', svg: '<path d="M4 22L24 6"/>' },
    { id: 'arrow', name: 'Arrow line', svg: '<path d="M4 22L23 7M14 6h9v9"/>' },
    { id: 'darrow', name: 'Double arrow', svg: '<path d="M4 22L24 6M5 13V22h9M23 15V6h-9"/>' },
  ];
  S.renderLine = function (el) {
    var w = KH.px(el.style.width) || 600, h = KH.px(el.style.height) || 40;
    var stroke = el.getAttribute('data-stroke') || '#1d1d1f';
    var sw = parseFloat(el.getAttribute('data-stroke-width')) || 6;
    var arrow = el.getAttribute('data-arrow') || 'none';
    var dash = el.getAttribute('data-dash') || '';
    var y = h / 2, head = Math.max(sw * 3.2, 12);
    var x1 = 0, x2 = w, heads = '';
    if (arrow === 'end' || arrow === 'both') {
      x2 = w - head * 0.85;
      heads += '<path d="M' + w + ',' + y + ' L' + (w - head) + ',' + (y - head * 0.5) + ' L' + (w - head) + ',' + (y + head * 0.5) + ' Z" fill="' + stroke + '" stroke="none"/>';
    }
    if (arrow === 'start' || arrow === 'both') {
      x1 = head * 0.85;
      heads += '<path d="M0,' + y + ' L' + head + ',' + (y - head * 0.5) + ' L' + head + ',' + (y + head * 0.5) + ' Z" fill="' + stroke + '" stroke="none"/>';
    }
    var dashAttr = '';
    if (dash === 'dashed') dashAttr = ' stroke-dasharray="' + (sw * 3) + ' ' + (sw * 2) + '"';
    else if (dash === 'dotted') dashAttr = ' stroke-dasharray="0.1 ' + (sw * 2) + '" stroke-linecap="round"';
    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + dashAttr + '/>' + heads + '</svg>';
  };
  S.isLine = function (el) { return el.classList.contains('kh-shape-line'); };
  S.shapeType = function (el) {
    var m = /kh-shape-([a-z]+)/.exec(el.className);
    return m ? m[1] : 'rect';
  };
  S.setShapeType = function (el, type) {
    el.className = el.className.replace(/kh-shape-[a-z]+/g, '').replace(/\s+/g, ' ').trim() + ' kh-shape-' + type;
    if (type === 'rounded') { el.classList.remove('kh-shape-rounded'); el.classList.add('kh-shape-rect'); if (!el.style.borderRadius) el.style.borderRadius = '28px'; }
  };
  return S;
})();
