/* keyhtml hooks for decks that used to drive their own slide navigation.
 *
 * Typical hand-written decks keep a `demos` map keyed by a slide's data-demo attribute, where each
 * demo is a draw() function with optional .reset() and .step() members, and a navigation block that
 * toggles slides and calls the demos. After importing such a deck into keyhtml, delete the old
 * navigation block (keyhtml's player now handles keys, hash, overview, presenter window) and paste
 * this instead at the end of the deck's custom JavaScript (Document tab ▸ Custom JavaScript).
 */
function demoFor(slide) {
  const el = slide && slide.querySelector('[data-demo]');
  return el && typeof demos !== 'undefined' && demos[el.dataset.demo];
}
// A slide (or build step) was shown: (re)draw its demo.
document.addEventListener('kh:slide', e => {
  const dm = demoFor(e.detail.slide); if (!dm) return;
  if (!e.detail.keep && dm.reset) dm.reset();
  dm();
});
// A demo with a step() consumes "next" keypresses until step() returns false.
document.addEventListener('kh:next', e => {
  const dm = demoFor(e.detail.slide);
  if (dm && dm.step && dm.step()) e.preventDefault();
});
// Canvas demos size themselves from clientWidth: redraw on resize.
window.addEventListener('resize', () => {
  const c = window.khPlayer && khPlayer.current();
  const dm = c && demoFor(c.slide); if (dm) dm();
});
// Keep arrow keys for navigation: drop focus from sliders/buttons after use.
document.querySelectorAll('input,button').forEach(el => {
  el.addEventListener('pointerup', () => el.blur());
  el.addEventListener('change', () => el.blur());
});
