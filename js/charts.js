// Hand-drawn SVG charts: single-series bars and lines with hairline grid, thin marks and hover tooltips.
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
function niceTicks(max, count = 3) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}
function niceRangeTicks(lo, hi, count = 3) {
  const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function compact(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(Math.round(n * 10) / 10); }
function tooltipFor(container) {
  let t = container.querySelector('.tooltip');
  if (!t) { t = document.createElement('div'); t.className = 'tooltip'; t.hidden = true; container.appendChild(t); }
  return t;
}
function observe(el, fn) {
  if (el._ro) el._ro.disconnect();
  if (window.ResizeObserver) {
    let last = el.clientWidth;
    el._ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - last) > 8) { last = el.clientWidth; fn(); } });
    el._ro.observe(el);
  }
}

// data: [{ label, value, key, hl, dim, tip }]
export function barChart(el, opts) {
  const draw = () => {
    const { data, yFormat = compact, tipFormat, goal, height = 190, labelEvery } = opts;
    el.innerHTML = ''; el.classList.add('chart');
    const W = Math.max(240, el.clientWidth || 600), H = height;
    const padL = 34, padR = 8, padT = 14, padB = 24;
    const iw = W - padL - padR, ih = H - padT - padB;
    const max = Math.max(goal || 0, ...data.map(d => d.value || 0));
    const ticks = niceTicks(max, 3);
    const yMax = ticks[ticks.length - 1] || 1;
    const y = v => padT + ih - (v / yMax) * ih;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    const grid = svgEl('g', { class: 'grid' }), axis = svgEl('g', { class: 'axis' });
    for (const t of ticks) {
      grid.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t) }));
      const tx = svgEl('text', { x: padL - 6, y: y(t) + 4, 'text-anchor': 'end' }); tx.textContent = yFormat(t); axis.appendChild(tx);
    }
    svg.appendChild(grid); svg.appendChild(axis);
    const n = data.length, slot = iw / Math.max(1, n);
    const bw = Math.min(24, slot * 0.62);
    const every = labelEvery || Math.max(1, Math.ceil(n / Math.floor(iw / 44)));
    const tip = tooltipFor(el);
    data.forEach((d, i) => {
      const cx = padL + slot * i + slot / 2;
      const v = Math.max(0, d.value || 0);
      const top = y(v), base = y(0), h = Math.max(0, base - top);
      const r = Math.min(4, h);
      const x0 = cx - bw / 2;
      const path = h > 0
        ? `M${x0},${base} V${top + r} a${r},${r} 0 0 1 ${r},-${r} h${bw - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${base} Z`
        : `M${x0},${base} h${bw} v0 h-${bw} Z`;
      const bar = svgEl('path', { d: path, class: 'bar' + (d.hl ? ' hl' : '') + (d.dim ? ' dim' : '') });
      svg.appendChild(bar);
      if (i % every === 0 || i === n - 1) {
        const tx = svgEl('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }); tx.textContent = d.label; axis.appendChild(tx);
      }
      const hit = svgEl('rect', { x: padL + slot * i, y: padT, width: slot, height: ih, class: 'hit' });
      const show = () => {
        tip.innerHTML = tipFormat ? tipFormat(d) : `<b>${yFormat(d.value)}</b> ${d.label}`;
        tip.hidden = false; tip.style.left = `${(cx / W) * 100}%`; tip.style.top = `${Math.max(0, top - 6)}px`;
        bar.style.filter = 'brightness(1.15)';
      };
      const hide = () => { tip.hidden = true; bar.style.filter = ''; };
      hit.addEventListener('pointerenter', show); hit.addEventListener('pointermove', show); hit.addEventListener('pointerleave', hide);
      hit.addEventListener('click', () => { show(); if (opts.onSelect) opts.onSelect(d); });
      svg.appendChild(hit);
    });
    if (goal) {
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(goal), y2: y(goal), class: 'goal' }));
      const t = svgEl('text', { x: W - padR, y: y(goal) - 4, 'text-anchor': 'end', class: 'label' }); t.textContent = opts.goalLabel || 'goal'; svg.appendChild(t);
    }
    el.appendChild(svg);
  };
  draw(); observe(el, draw);
}

// data: [{ x: Date, y, label, tip }], sorted by x
export function lineChart(el, opts) {
  const draw = () => {
    const { data, yFormat = compact, tipFormat, height = 190, goal, goalLabel, lowerIsBetter = false, xFormat } = opts;
    el.innerHTML = ''; el.classList.add('chart');
    if (!data.length) return;
    const W = Math.max(240, el.clientWidth || 600), H = height;
    const padL = 40, padR = 14, padT = 14, padB = 24;
    const iw = W - padL - padR, ih = H - padT - padB;
    const ys = data.map(d => d.y).concat(goal ? [goal] : []);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = hi - lo; lo -= span * 0.15; hi += span * 0.15;
    const xs = data.map(d => +new Date(d.x));
    let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) { x0 -= 86400000; x1 += 86400000; }
    const x = v => padL + ((v - x0) / (x1 - x0)) * iw;
    const y = v => padT + ih - ((v - lo) / (hi - lo)) * ih;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    const grid = svgEl('g', { class: 'grid' }), axis = svgEl('g', { class: 'axis' });
    const tickVals = niceRangeTicks(lo, hi, 3);
    for (const t of tickVals) {
      grid.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t) }));
      const tx = svgEl('text', { x: padL - 6, y: y(t) + 4, 'text-anchor': 'end' }); tx.textContent = yFormat(t); axis.appendChild(tx);
    }
    svg.appendChild(grid); svg.appendChild(axis);
    const fmtX = xFormat || (d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const nx = Math.max(2, Math.floor(iw / 90));
    for (let i = 0; i < nx; i++) {
      const v = x0 + ((x1 - x0) * i) / (nx - 1);
      const tx = svgEl('text', { x: x(v), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle' }); tx.textContent = fmtX(v); axis.appendChild(tx);
    }
    const pts = data.map(d => [x(+new Date(d.x)), y(d.y)]);
    const dPath = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    svg.appendChild(svgEl('path', { d: `${dPath} L${pts[pts.length - 1][0].toFixed(1)},${padT + ih} L${pts[0][0].toFixed(1)},${padT + ih} Z`, class: 'area' }));
    if (goal) {
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(goal), y2: y(goal), class: 'goal' }));
      const t = svgEl('text', { x: padL + 4, y: y(goal) - 4, 'text-anchor': 'start', class: 'label' }); t.textContent = goalLabel || 'goal'; svg.appendChild(t);
    }
    svg.appendChild(svgEl('path', { d: dPath, class: 'line' }));
    const dots = data.map((d, i) => { const c = svgEl('circle', { cx: pts[i][0], cy: pts[i][1], r: data.length > 40 ? 2.5 : 4, class: 'dot' }); svg.appendChild(c); return c; });
    const last = data[data.length - 1];
    const lbl = svgEl('text', { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] - 10, 'text-anchor': 'end', class: 'label' });
    lbl.textContent = yFormat(last.y); svg.appendChild(lbl);
    const cross = svgEl('line', { class: 'crosshair', y1: padT, y2: padT + ih, x1: 0, x2: 0 }); cross.style.display = 'none'; svg.appendChild(cross);
    const tip = tooltipFor(el);
    const hit = svgEl('rect', { x: padL, y: padT, width: iw, height: ih, class: 'hit' });
    const move = ev => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.abs(p[0] - px); if (d < bd) { bd = d; best = i; } });
      const d = data[best], p = pts[best];
      cross.setAttribute('x1', p[0]); cross.setAttribute('x2', p[0]); cross.style.display = '';
      dots.forEach((c, i) => c.setAttribute('r', i === best ? 6 : data.length > 40 ? 2.5 : 4));
      tip.innerHTML = tipFormat ? tipFormat(d) : `<b>${yFormat(d.y)}</b> ${d.label || fmtX(d.x)}`;
      tip.hidden = false; tip.style.left = `${(p[0] / W) * 100}%`; tip.style.top = `${Math.max(0, p[1] - 8)}px`;
    };
    const leave = () => { tip.hidden = true; cross.style.display = 'none'; dots.forEach(c => c.setAttribute('r', data.length > 40 ? 2.5 : 4)); };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', leave);
    svg.appendChild(hit);
    el.appendChild(svg);
    void lowerIsBetter;
  };
  draw(); observe(el, draw);
}

// Tiny inline sparkline for stat tiles. values: numbers.
export function sparkline(values, { width = 90, height = 26 } = {}) {
  if (values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - lo) / span) * (height - 4)}`);
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pts[pts.length - 1].split(',')[0]}" cy="${pts[pts.length - 1].split(',')[1]}" r="3" fill="var(--accent)"/></svg>`;
}
