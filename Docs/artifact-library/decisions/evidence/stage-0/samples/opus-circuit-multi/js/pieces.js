// Grid geometry and SVG drawings for the circuit parts.
// Every part is a straight piece lying between two grid dots ("terminals").
(function () {
  'use strict';

  const SL = (window.SparkLab = window.SparkLab || {});
  const NS = 'http://www.w3.org/2000/svg';
  const CELL = 100;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const LEVER_OPEN = -32;
  const WIRE_COLORS = ['#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#9333ea'];
  const TYPES = {
    battery: { len: 2, name: 'Battery' },
    wire: { len: 2, name: 'Wire' },
    switch: { len: 2, name: 'Switch' },
    bulb: { len: 2, name: 'Bulb' },
  };

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  const nodeKey = (n) => n[0] + ',' + n[1];

  function ends(p) {
    const [dx, dy] = DIRS[p.dir];
    return [[p.x, p.y], [p.x + dx * p.len, p.y + dy * p.len]];
  }

  function center(p) {
    const [dx, dy] = DIRS[p.dir];
    return [p.x + (dx * p.len) / 2, p.y + (dy * p.len) / 2];
  }

  function nodesOf(p) {
    const [dx, dy] = DIRS[p.dir];
    const out = [];
    for (let i = 0; i <= p.len; i++) out.push([p.x + dx * i, p.y + dy * i]);
    return out;
  }

  // Dots hidden under a part's body: nothing may connect there.
  function interiorNodes(p) {
    return p.type === 'wire' ? [] : nodesOf(p).slice(1, -1);
  }

  function edgeKeys(p) {
    const n = nodesOf(p);
    const keys = [];
    for (let i = 1; i < n.length; i++) {
      const a = nodeKey(n[i - 1]);
      const b = nodeKey(n[i]);
      keys.push(a < b ? a + '|' + b : b + '|' + a);
    }
    return keys;
  }

  function conflicts(p, q) {
    const edges = new Set(edgeKeys(p));
    if (edgeKeys(q).some((k) => edges.has(k))) return true;
    const pNodes = new Set(nodesOf(p).map(nodeKey));
    const qNodes = new Set(nodesOf(q).map(nodeKey));
    if (interiorNodes(p).some((n) => qNodes.has(nodeKey(n)))) return true;
    if (interiorNodes(q).some((n) => pNodes.has(nodeKey(n)))) return true;
    return false;
  }

  function inBounds(p, cols, rows) {
    return ends(p).every(([x, y]) => x >= 0 && y >= 0 && x <= cols && y <= rows);
  }

  function clampIn(p, cols, rows) {
    const [a, b] = ends(p);
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    const sx = minX < 0 ? -minX : maxX > cols ? cols - maxX : 0;
    const sy = minY < 0 ? -minY : maxY > rows ? rows - maxY : 0;
    return { ...p, x: p.x + sx, y: p.y + sy };
  }

  function placeAt(p, cx, cy) {
    const [dx, dy] = DIRS[p.dir];
    return { ...p, x: Math.round(cx - (dx * p.len) / 2), y: Math.round(cy - (dy * p.len) / 2) };
  }

  function rotated(p, dir) {
    const c = center(p);
    return placeAt({ ...p, dir }, c[0], c[1]);
  }

  function dirOf(dx, dy) {
    return DIRS.findIndex(([x, y]) => x === Math.sign(dx) && y === Math.sign(dy));
  }

  function setPlacement(g, p) {
    g.setAttribute('transform', `translate(${p.x * CELL} ${p.y * CELL}) rotate(${p.dir * 90})`);
  }

  // ---------- Drawing (local frame: terminal A at 0,0 and terminal B at len*CELL,0) ----------

  function lead(g, x1, x2) {
    el('line', { x1, y1: 0, x2, y2: 0, stroke: '#94a3b8', 'stroke-width': 9, 'stroke-linecap': 'round' }, g);
  }

  function terminal(g, x) {
    el('circle', { cx: x, cy: 0, r: 11, fill: '#e2e8f0', stroke: '#475569', 'stroke-width': 4 }, g);
    el('circle', { cx: x, cy: 0, r: 3.5, fill: '#475569' }, g);
  }

  // Text stays upright however the part is turned.
  function label(g, text, x, size, fill, dir) {
    const t = el('text', {
      x, y: 0, dy: '0.35em',
      'font-size': size, 'font-weight': 800, fill,
      'text-anchor': 'middle',
      transform: `rotate(${-dir * 90} ${x} 0)`,
    }, g);
    t.textContent = text;
  }

  function drawBattery(g, dir) {
    lead(g, 0, 40);
    lead(g, 166, 200);
    el('rect', { class: 'heat', x: 24, y: -46, width: 152, height: 92, rx: 34, fill: '#ef4444', filter: 'url(#heatBlur)' }, g);
    el('rect', { x: 40, y: -30, width: 116, height: 60, rx: 12, fill: '#f59e0b' }, g);
    el('path', { d: 'M52 -30 H124 V30 H52 A12 12 0 0 1 40 18 V-18 A12 12 0 0 1 52 -30 Z', fill: '#1f2937' }, g);
    el('rect', { x: 156, y: -13, width: 11, height: 26, rx: 4, fill: '#cbd5e1', stroke: '#64748b', 'stroke-width': 3 }, g);
    el('rect', { x: 48, y: -24, width: 100, height: 8, rx: 4, fill: '#fff', opacity: 0.18 }, g);
    label(g, '−', 60, 40, '#fff', dir);
    label(g, '1.5V', 95, 19, '#fde68a', dir);
    label(g, '+', 140, 40, '#1f2937', dir);
  }

  function drawBulb(g) {
    el('circle', { class: 'glow', cx: 100, cy: 0, r: 80, fill: 'url(#bulbGlow)', opacity: 0 }, g);
    const rays = el('g', { class: 'rays', opacity: 0 }, g);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + Math.PI / 8;
      el('line', {
        x1: 100 + Math.cos(a) * 54, y1: Math.sin(a) * 54,
        x2: 100 + Math.cos(a) * 76, y2: Math.sin(a) * 76,
        stroke: '#f59e0b', 'stroke-width': 7, 'stroke-linecap': 'round',
      }, rays);
    }
    lead(g, 0, 58);
    lead(g, 142, 200);
    el('circle', { cx: 100, cy: 0, r: 44, fill: '#475569', stroke: '#334155', 'stroke-width': 3 }, g);
    el('circle', { class: 'globe', cx: 100, cy: 0, r: 35, fill: '#eef2f7', stroke: '#94a3b8', 'stroke-width': 3 }, g);
    el('path', {
      class: 'filament',
      d: 'M58 0 H76 L80 -9 L86 9 L92 -9 L98 9 L104 -9 L110 9 L116 -9 L120 9 L124 0 H142',
      fill: 'none', stroke: '#64748b', 'stroke-width': 4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }, g);
    const crack = el('g', { class: 'crack', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    el('path', { d: 'M58 0 H76 L80 -9 L86 9 L90 0 M112 2 L116 -9 L120 9 L124 0 H142', stroke: '#64748b', 'stroke-width': 4 }, crack);
    el('path', { d: 'M84 -31 L95 -15 L89 -6 M114 -30 L107 -14 L113 -8 M98 30 L102 16', stroke: '#475569', 'stroke-width': 3 }, crack);
    el('ellipse', { cx: 88, cy: -16, rx: 9, ry: 6, fill: '#fff', opacity: 0.75, transform: 'rotate(-30 88 -16)' }, g);
  }

  function drawSwitch(g) {
    lead(g, 0, 46);
    lead(g, 154, 200);
    el('rect', { class: 'switch-base', x: 30, y: -30, width: 140, height: 60, rx: 16 }, g);
    el('circle', { cx: 56, cy: 0, r: 11, fill: '#94a3b8', stroke: '#475569', 'stroke-width': 3 }, g);
    el('circle', { cx: 144, cy: 0, r: 11, fill: '#94a3b8', stroke: '#475569', 'stroke-width': 3 }, g);
    const pivot = el('g', { transform: 'translate(56 0)' }, g);
    const lever = el('g', { class: 'lever', transform: `rotate(${LEVER_OPEN})` }, pivot);
    el('line', { x1: 0, y1: 0, x2: 90, y2: 0, stroke: '#475569', 'stroke-width': 11, 'stroke-linecap': 'round' }, lever);
    el('circle', { class: 'knob', cx: 70, cy: 0, r: 13 }, lever);
    el('circle', { cx: 0, cy: 0, r: 6, fill: '#e2e8f0' }, pivot);
  }

  function drawWire(g, L, color) {
    el('line', { x1: 0, y1: 0, x2: L, y2: 0, stroke: color, 'stroke-width': 14, 'stroke-linecap': 'round' }, g);
    el('line', { x1: 10, y1: -3, x2: L - 10, y2: -3, stroke: '#fff', 'stroke-opacity': 0.35, 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
  }

  function drawPiece(p) {
    const L = p.len * CELL;
    const half = p.type === 'wire' ? 32 : 54;
    const g = el('g', { class: `piece piece-${p.type}`, 'data-id': p.id });
    el('rect', { class: 'sel-ring', x: -28, y: -half, width: L + 56, height: half * 2, rx: half }, g);
    if (p.type === 'battery') drawBattery(g, p.dir);
    else if (p.type === 'bulb') drawBulb(g);
    else if (p.type === 'switch') drawSwitch(g);
    else drawWire(g, L, p.color || WIRE_COLORS[0]);
    el('rect', { class: 'hit', x: -14, y: -(half - 6), width: L + 28, height: (half - 6) * 2 }, g);
    terminal(g, 0);
    terminal(g, L);
    setPlacement(g, p);
    return g;
  }

  function makeIcon(type, color) {
    const svg = el('svg', { viewBox: '-30 -64 260 128', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(drawPiece({ id: 0, type, x: 0, y: 0, dir: 0, len: TYPES[type].len, on: false, color }));
    return svg;
  }

  Object.assign(SL, {
    CELL, DIRS, TYPES, WIRE_COLORS, LEVER_OPEN,
    el, nodeKey, ends, center, nodesOf, conflicts, inBounds, clampIn, placeAt, rotated, dirOf,
    setPlacement, drawPiece, makeIcon,
  });
})();
