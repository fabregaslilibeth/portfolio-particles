/** Splits statements into words that rise in one after another on scroll. */
export function setupReveals(elements: Iterable<HTMLElement>): void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.35 },
  );

  for (const el of elements) {
    const words = (el.textContent ?? '').trim().split(/\s+/);
    el.setAttribute('aria-label', words.join(' '));
    el.textContent = '';
    words.forEach((word, i) => {
      const outer = document.createElement('span');
      outer.className = 'word';
      outer.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('span');
      inner.textContent = word;
      inner.style.setProperty('--i', String(i));
      outer.append(inner);
      el.append(outer, ' ');
    });
    observer.observe(el);
  }
}
