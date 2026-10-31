// Живой фон окна. Поток трафика упирается в заслон, пока обход выключен,
// и проходит сквозь него, когда обход работает. Все величины плавно догоняют цель:
// заслон расходится постепенно, и первыми проходят линии у центра.
const FX = (() => {
  let canvas, ctx, w = 0, h = 0, mode = 'off', dimTarget = 0, raf = 0, last = 0, tick = 0;
  let particles = [], sparks = [], pulse = null;
  let reduced = false;

  const palette = { off: [[63, 125, 255], [255, 61, 83]], scan: [[63, 125, 255], [255, 193, 77]], on: [[47, 139, 255], [47, 233, 255]] };
  const v = { open: 0, speed: 0.8, spread: 0, glow: 0.12, dim: 0, c0: [...palette.off[0]], c1: [...palette.off[1]] };

  function resize() {
    w = canvas.parentElement.offsetWidth; h = canvas.parentElement.offsetHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(p, anywhere) {
    p.lane = Math.random() * 2 - 1;
    p.x = anywhere ? Math.random() * w : -60 - Math.random() * 200;
    p.v = 3 + Math.random() * 5;
    p.len = 26 + Math.random() * 90;
    p.a = 0.25 + Math.random() * 0.6;
    p.through = false;
    return p;
  }

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const ease = (cur, to, rate, f) => cur + (to - cur) * (1 - Math.pow(1 - rate, f));

  function step(f) {
    const scanning = mode === 'scan';
    const breathe = scanning ? 0.34 + 0.22 * Math.sin(tick * 0.045) : 0;
    v.open = ease(v.open, mode === 'on' ? 1 : breathe, 0.05, f);
    v.speed = ease(v.speed, mode === 'on' ? 2.1 : scanning ? 1.35 : 0.8, 0.035, f);
    v.spread = ease(v.spread, mode === 'off' ? 0 : 1, 0.04, f);
    v.glow = ease(v.glow, mode === 'on' ? 0.22 : 0.12, 0.04, f);
    v.dim = ease(v.dim, dimTarget, 0.09, f);
    const pal = palette[mode];
    for (let i = 0; i < 3; i++) {
      v.c0[i] = ease(v.c0[i], pal[0][i], 0.05, f);
      v.c1[i] = ease(v.c1[i], pal[1][i], 0.05, f);
    }
  }

  function draw(f) {
    const bx = w * 0.7, cy = h * 0.5, gap = 8 + v.open * h * 0.2;
    const yAt = (lane, x) => {
      const t = Math.abs(x - bx) / bx;
      const shut = 0.32 + 0.68 * t, free = 0.06 + 0.94 * Math.pow(t, 1.25);
      return cy + lane * 0.5 * h * (shut + (free - shut) * v.spread);
    };

    ctx.lineCap = 'round';
    for (const p of particles) {
      const prevX = p.x;
      p.x += p.v * v.speed * f;
      if (!p.through && prevX < bx && p.x >= bx) {
        if (Math.abs(yAt(p.lane, bx) - cy) < gap) p.through = true;
        else {
          for (let i = 0; i < 3; i++) sparks.push({ x: bx - 2, y: yAt(p.lane, bx), vx: -1 - Math.random() * 4, vy: (Math.random() - 0.5) * 5, life: 1 });
          spawn(p); continue;
        }
      }
      if (p.x - p.len > w + 40) { spawn(p); continue; }
      const col = p.through ? v.c1 : v.c0;
      const x0 = Math.max(p.x - p.len * v.speed * 0.7, p.through ? bx : -40), y0 = yAt(p.lane, x0), y1 = yAt(p.lane, p.x);
      const g = ctx.createLinearGradient(x0, y0, p.x, y1);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(1, rgba(col, p.a));
      ctx.strokeStyle = g;
      ctx.lineWidth = p.through ? 2 : 1.4;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(p.x, y1); ctx.stroke();
    }

    for (const dir of [-1, 1]) {
      const yStart = cy + dir * gap, yEnd = dir < 0 ? -10 : h + 10;
      const g = ctx.createLinearGradient(0, yStart, 0, yEnd);
      g.addColorStop(0, rgba(v.c1, 0.95)); g.addColorStop(1, rgba(v.c1, 0));
      ctx.strokeStyle = g; ctx.lineWidth = 3;
      ctx.shadowColor = rgba(v.c1, 1); ctx.shadowBlur = 26;
      ctx.beginPath(); ctx.moveTo(bx, yStart); ctx.lineTo(bx, yEnd); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    const glow = ctx.createRadialGradient(bx, cy, 0, bx, cy, h * 0.55);
    glow.addColorStop(0, rgba(v.c1, v.glow));
    glow.addColorStop(1, rgba(v.c1, 0));
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);

    // Одна мягкая волна в момент подключения
    if (pulse !== null) {
      pulse += 0.012 * f;
      if (pulse >= 1) pulse = null;
      else {
        const r = 40 + pulse * h * 0.9;
        ctx.strokeStyle = rgba(v.c1, 0.28 * (1 - pulse) * (1 - pulse));
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, cy, r, 0, 7); ctx.stroke();
      }
    }

    for (const s of sparks) {
      s.x += s.vx * f; s.y += s.vy * f; s.vy *= 0.97; s.life -= 0.035 * f;
      ctx.fillStyle = rgba(v.c1, Math.max(s.life, 0) * 0.9);
      ctx.fillRect(s.x, s.y, 2, 2);
    }
    sparks = sparks.filter(s => s.life > 0).slice(-160);
  }

  function frame(now) {
    const f = Math.min((now - last) / 16.67 || 1, 3);
    last = now; tick += f;
    step(f);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1 - v.dim;
    draw(f);
    ctx.globalAlpha = 1;
    if (!reduced) raf = requestAnimationFrame(frame);
  }

  function still() {
    Object.assign(v, { open: mode === 'on' ? 1 : mode === 'scan' ? 0.4 : 0, speed: 1, spread: mode === 'off' ? 0 : 1, dim: dimTarget, glow: mode === 'on' ? 0.22 : 0.12 });
    for (const [i, c] of palette[mode].entries()) (i ? v.c1 : v.c0).splice(0, 3, ...c);
    for (let i = 0; i < 90; i++) frame(last + 16.67);
  }

  return {
    init(el, startMode, motion) {
      canvas = el; ctx = canvas.getContext('2d');
      mode = startMode || 'off'; reduced = !motion;
      resize();
      particles = Array.from({ length: 150 }, () => spawn({}, true));
      Object.assign(v, { open: mode === 'on' ? 1 : 0, spread: mode === 'off' ? 0 : 1, speed: mode === 'on' ? 2.1 : 0.8 });
      v.c0 = [...palette[mode][0]]; v.c1 = [...palette[mode][1]];
      if (reduced) still(); else raf = requestAnimationFrame(t => { last = t; frame(t); });
    },
    set(next) {
      if (next.mode && next.mode !== mode) { if (next.mode === 'on' && !reduced) pulse = 0; mode = next.mode; }
      if ('dim' in next) dimTarget = next.dim;
      if ('motion' in next && next.motion === reduced) {
        reduced = !next.motion;
        cancelAnimationFrame(raf);
        if (!reduced) raf = requestAnimationFrame(t => { last = t; frame(t); });
      }
      if (reduced) still();
    },
    get values() { return v; },
  };
})();
