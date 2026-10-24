/**
 * Counts to 100 while the particle shapes are built. The count eases toward
 * 90 on its own and only completes once `finish()` is called.
 */
export function createPreloader(root: HTMLElement, minSeconds: number): { finish(): Promise<void> } {
  const counter = root.querySelector<HTMLElement>('[data-preloader-count]');
  const bar = root.querySelector<HTMLElement>('[data-preloader-bar]');
  const start = performance.now();
  let last = start;
  let shown = 0;
  let ceiling = 90;
  let done: (() => void) | null = null;

  const tick = (now: number) => {
    const elapsed = (now - start) / 1000;
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    const allowed = elapsed >= minSeconds ? ceiling : Math.min(ceiling, (elapsed / minSeconds) * 100);
    shown += (allowed - shown) * (1 - Math.exp(-dt / 0.12));
    if (ceiling === 100 && shown > 99.5) shown = 100;
    const value = Math.round(shown);
    if (counter) counter.textContent = String(value).padStart(3, '0');
    if (bar) bar.style.transform = `scaleX(${shown / 100})`;

    if (value >= 100 && done) {
      root.classList.add('is-done');
      window.setTimeout(done, 450);
      done = null;
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    finish() {
      ceiling = 100;
      return new Promise((resolve) => (done = resolve));
    },
  };
}
