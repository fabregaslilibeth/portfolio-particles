/** A dot that tracks the pointer exactly and a ring that trails behind it. */
export function createCursor(root: HTMLElement): { update(dt: number): void } {
  const dot = root.querySelector<HTMLElement>('.cursor__dot');
  const ring = root.querySelector<HTMLElement>('.cursor__ring');
  if (!dot || !ring) return { update() {} };

  document.documentElement.classList.add('has-cursor');
  const pos = { x: innerWidth / 2, y: innerHeight / 2 };
  const trail = { ...pos };
  let hover = 0;
  let hoverTarget = 0;
  let visible = false;

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pos.x = e.clientX;
    pos.y = e.clientY;
    if (!visible) {
      trail.x = pos.x;
      trail.y = pos.y;
      visible = true;
      root.classList.add('is-visible');
    }
    hoverTarget = (e.target as Element | null)?.closest('a, button') ? 1 : 0;
  });
  document.addEventListener('pointerleave', () => {
    visible = false;
    root.classList.remove('is-visible');
  });
  window.addEventListener('pointerdown', () => root.classList.add('is-down'));
  window.addEventListener('pointerup', () => root.classList.remove('is-down'));

  return {
    update(dt) {
      const k = 1 - Math.exp(-dt / 0.09);
      trail.x += (pos.x - trail.x) * k;
      trail.y += (pos.y - trail.y) * k;
      hover += (hoverTarget - hover) * (1 - Math.exp(-dt / 0.12));
      dot.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${1 - hover * 0.6})`;
      ring.style.transform = `translate3d(${trail.x}px, ${trail.y}px, 0) scale(${1 + hover * 1.4})`;
    },
  };
}
