/* keyhtml editor — slide layouts (master-like templates used when adding a slide). */
KH.layouts = (function () {
  var L = {};
  var defs = [
    { id: 'title', name: 'Title', preview: [[160, 420, 1600, 110], [360, 580, 1200, 50]] },
    { id: 'title-bullets', name: 'Title & Bullets', preview: [[110, 80, 1700, 90], [110, 240, 1700, 720]] },
    { id: 'title-only', name: 'Title Only', preview: [[110, 80, 1700, 90]] },
    { id: 'two-column', name: 'Two Column', preview: [[110, 80, 1700, 90], [110, 240, 830, 720], [980, 240, 830, 720]] },
    { id: 'section', name: 'Section', preview: [[160, 440, 1600, 130]], bg: true },
    { id: 'image-caption', name: 'Image & Caption', preview: [[110, 80, 1700, 90], [360, 940, 1200, 50]] },
    { id: 'quote', name: 'Quote', preview: [[260, 360, 1400, 200], [760, 640, 900, 50]] },
    { id: 'blank', name: 'Blank', preview: [] },
  ];
  L.defs = defs;
  L.build = function (id, slide) {
    var C = KH.model.create, els = [];
    var title = function (text, y, fs) {
      return C.text({ html: text, x: 110, y: y == null ? 70 : y, w: 1700, fontSize: fs || 72, heading: true, placeholder: true });
    };
    switch (id) {
      case 'title':
        els.push(C.text({ html: 'Presentation Title', x: 160, y: 380, w: 1600, fontSize: 96, align: 'center', heading: true, placeholder: true }));
        els.push(C.text({ html: 'Subtitle, author, date', x: 360, y: 580, w: 1200, fontSize: 44, align: 'center', color: 'var(--kh-muted)', placeholder: true }));
        break;
      case 'title-bullets':
        els.push(title('Slide Title'));
        els.push(C.text({ html: '<ul><li>First point</li><li>Second point</li><li>Third point</li></ul>', x: 110, y: 240, w: 1700, h: 720, fontSize: 44, placeholder: true }));
        break;
      case 'title-only':
        els.push(title('Slide Title'));
        break;
      case 'two-column':
        els.push(title('Slide Title'));
        els.push(C.text({ html: '<ul><li>Left column</li></ul>', x: 110, y: 240, w: 830, h: 720, fontSize: 40, placeholder: true }));
        els.push(C.text({ html: '<ul><li>Right column</li></ul>', x: 980, y: 240, w: 830, h: 720, fontSize: 40, placeholder: true }));
        break;
      case 'section':
        els.push(C.text({ html: 'Section Title', x: 160, y: 440, w: 1600, fontSize: 110, align: 'center', heading: true, placeholder: true, color: '#ffffff' }));
        if (slide) slide.style.background = 'var(--kh-accent)';
        break;
      case 'image-caption':
        els.push(title('Figure Title'));
        els.push(C.text({ html: 'Caption — drop an image or PDF onto the slide', x: 360, y: 950, w: 1200, fontSize: 32, align: 'center', color: 'var(--kh-muted)', placeholder: true }));
        break;
      case 'quote':
        els.push(C.text({ html: '<i>“A memorable quotation goes here.”</i>', x: 260, y: 360, w: 1400, fontSize: 64, align: 'center', placeholder: true }));
        els.push(C.text({ html: '— Attribution', x: 760, y: 640, w: 900, fontSize: 36, align: 'right', color: 'var(--kh-muted)', placeholder: true }));
        break;
      default:
        break;
    }
    return els;
  };
  return L;
})();
