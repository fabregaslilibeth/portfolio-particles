/**
 * Hovering a link breaks its text into particles that drift apart, then
 * pulls them back together on leave. Plain 2D canvas — cheap enough for
 * every link on the page.
 */

const PAD = 28;

interface Dot {
  x: number;
  y: number;
  dx: number;
  dy: number;
  phase: number;
}

export function attachDissolve(link: HTMLElement): void {
  const label = document.createElement('span');
  label.className = 'dissolve__text';
  label.append(...Array.from(link.childNodes));
  const canvas = document.createElement('canvas');
  canvas.className = 'dissolve__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  // Zero-size until first hover; the default 300×150 would overflow the page.
  canvas.width = 0;
  canvas.height = 0;
  link.classList.add('dissolve');
  link.append(label, canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let dots: Dot[] = [];
  let color = '#fff';
  let progress = 0;
  let target = 0;
  let raf = 0;
  let last = 0;

  const build = () => {
    const ratio = Math.min(window.devicePixelRatio, 2);
    const w = label.offsetWidth + PAD * 2;
    const h = label.offsetHeight + PAD * 2;
    canvas.width = Math.ceil(w * ratio);
    canvas.height = Math.ceil(h * ratio);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const style = getComputedStyle(label);
    color = style.color;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    const m = ctx.measureText(label.textContent ?? '');
    const ascent = m.fontBoundingBoxAscent;
    const descent = m.fontBoundingBoxDescent;
    ctx.fillText(label.textContent ?? '', PAD, PAD + (label.offsetHeight - ascent - descent) / 2 + ascent);

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const step = Math.max(1, Math.round(1.6 * ratio));
    dots = [];
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        if (data[(y * canvas.width + x) * 4 + 3] < 110) continue;
        const angle = Math.random() * Math.PI * 2;
        const dist = 6 + Math.random() * 26;
        dots.push({
          x: x / ratio,
          y: y / ratio,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist * 0.6 - 8 * Math.random(),
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    ctx.clearRect(0, 0, w, h);
  };

  const draw = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    // Break apart quickly, reassemble a little slower.
    const rate = target > progress ? 7 : 4.5;
    progress += (target - progress) * (1 - Math.exp(-dt * rate));
    if (Math.abs(target - progress) < 0.002) progress = target;

    const e = 1 - Math.pow(1 - progress, 3);
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.restore();
    ctx.fillStyle = color;
    ctx.globalAlpha = 1 - 0.55 * e;
    const t = now / 1000;
    for (const d of dots) {
      const wobble = Math.sin(t * 2 + d.phase) * 1.5 * e;
      ctx.fillRect(d.x + d.dx * e + wobble, d.y + d.dy * e + wobble * 0.5, 1.15, 1.15);
    }
    // Hand the text over to the particles almost immediately.
    label.style.opacity = String(1 - Math.min(progress * 6, 1));
    canvas.style.opacity = progress > 0.001 ? '1' : '0';

    if (progress !== target) raf = requestAnimationFrame(draw);
    else raf = 0;
  };

  const kick = () => {
    if (!dots.length) build();
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(draw);
    }
  };

  link.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    target = 1;
    kick();
  });
  link.addEventListener('pointerleave', () => {
    target = 0;
    kick();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => (dots = []), 150);
  });
}
