// The board: drawing, touch/mouse interaction and the electron animation.
(function () {
  'use strict';

  const SL = window.SparkLab;
  const { CELL, DIRS, el } = SL;

  const MARGIN = 0.6;          // empty space around the grid, in cells
  const SPACING = 25;          // distance between electrons (divides every edge length)
  const SPEED_PER_AMP = 150;
  const MIN_SPEED = 12;
  const MAX_SPEED = 420;
  const TAP_PX = 10;
  const TERMINAL_GRAB = 0.32;  // pressing this close to a terminal draws a wire instead of moving the part
  const HIDDEN = { battery: [0.2, 0.83], bulb: [0.3, 0.7] }; // electrons pass "inside" these bodies

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sameNode = (a, b) => a[0] === b[0] && a[1] === b[1];

  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  function paintBulb(g, level) {
    const lit = level > SL.LIT;
    const v = clamp(level, 0, 1);
    const glow = g.querySelector('.glow');
    glow.setAttribute('opacity', lit ? (0.35 + 0.65 * v).toFixed(3) : 0);
    glow.setAttribute('r', (70 + 24 * clamp(level, 0, 2.5)).toFixed(1));
    g.querySelector('.rays').setAttribute('opacity', clamp((level - 0.4) / 0.6, 0, 1).toFixed(3));
    g.querySelector('.globe').setAttribute('fill', lit ? mix('#f1f5f9', '#fde047', 0.35 + 0.65 * v) : '#eef2f7');
    g.querySelector('.filament').setAttribute('stroke', lit ? mix('#94a3b8', '#ea580c', 0.4 + 0.6 * v) : '#64748b');
  }

  class Board {
    constructor(svg, options) {
      this.svg = svg;
      this.cols = options.cols;
      this.rows = options.rows;
      this.toolbox = options.toolbox;
      this.onChange = options.onChange || (() => {});
      this.pieces = [];
      this.groups = new Map();
      this.nextId = 1;
      this.selectedId = null;
      this.drag = null;
      this.colorIndex = 0;
      this.flows = [];
      this.analysis = SL.analyze([]);
      this.build();

      svg.addEventListener('pointerdown', (e) => this.onDown(e));
      window.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
      window.addEventListener('pointerup', (e) => this.onUp(e));
      window.addEventListener('pointercancel', (e) => this.onCancel(e));
      svg.addEventListener('contextmenu', (e) => e.preventDefault());

      this.lastFrame = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }

    // ---------- Setup ----------

    build() {
      const s = this.svg;
      const W = this.cols * CELL;
      const H = this.rows * CELL;
      const m = MARGIN * CELL;
      s.setAttribute('viewBox', `${-m} ${-m} ${W + 2 * m} ${H + 2 * m}`);
      s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      s.textContent = '';

      const defs = el('defs', null, s);
      const grad = el('radialGradient', { id: 'bulbGlow' }, defs);
      el('stop', { offset: '0%', 'stop-color': '#fffbe6', 'stop-opacity': 1 }, grad);
      el('stop', { offset: '45%', 'stop-color': '#fde047', 'stop-opacity': 0.7 }, grad);
      el('stop', { offset: '100%', 'stop-color': '#fde047', 'stop-opacity': 0 }, grad);
      const blur = el('filter', { id: 'heatBlur', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
      el('feGaussianBlur', { stdDeviation: 10 }, blur);

      const pad = 0.45 * CELL;
      el('rect', { class: 'board-bg', x: -pad, y: -pad, width: W + 2 * pad, height: H + 2 * pad, rx: 36 }, s);
      const grid = el('g', { class: 'grid' }, s);
      for (let x = 0; x <= this.cols; x++) {
        for (let y = 0; y <= this.rows; y++) el('circle', { class: 'grid-dot', cx: x * CELL, cy: y * CELL, r: 6 }, grid);
      }

      this.pieceLayer = el('g', null, s);
      this.electronLayer = el('g', { class: 'electrons' }, s);
      this.previewLayer = el('g', { class: 'preview' }, s);
      this.wirePreview = el('g', null, this.previewLayer);
      this.uiLayer = el('g', null, s);
    }

    // ---------- Helpers ----------

    toGrid(e) {
      const ctm = this.svg.getScreenCTM();
      if (!ctm) return [0, 0];
      const pt = this.svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      return [p.x / CELL, p.y / CELL];
    }

    scale() {
      const ctm = this.svg.getScreenCTM();
      return ctm ? ctm.a : 0.6;
    }

    byId(id) {
      return this.pieces.find((p) => p.id === id) || null;
    }

    isTerminal(node) {
      return this.pieces.some((p) => !p.lifted && SL.ends(p).some((n) => sameNode(n, node)));
    }

    isFree(p, ignoreId, extra = []) {
      if (!SL.inBounds(p, this.cols, this.rows)) return false;
      for (const q of this.pieces) if (q.id !== ignoreId && SL.conflicts(p, q)) return false;
      for (const q of extra) if (SL.conflicts(p, q)) return false;
      return true;
    }

    overBoard(g) {
      return g[0] >= -MARGIN && g[1] >= -MARGIN && g[0] <= this.cols + MARGIN && g[1] <= this.rows + MARGIN;
    }

    overToolbox(e) {
      const r = this.toolbox.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }

    wireColor() {
      return SL.WIRE_COLORS[this.colorIndex % SL.WIRE_COLORS.length];
    }

    select(id) {
      this.selectedId = id;
      this.refreshStates();
      this.renderSelectionUI();
    }

    // ---------- Pointer handling ----------

    onDown(e) {
      if (this.drag || e.button > 0) return;
      e.preventDefault();

      const button = e.target.closest('[data-action]');
      if (button) {
        if (button.dataset.action === 'rotate') this.rotateSelected();
        else this.removeSelected();
        return;
      }

      const g = this.toGrid(e);
      const node = [clamp(Math.round(g[0]), 0, this.cols), clamp(Math.round(g[1]), 0, this.rows)];
      const nearNode = Math.hypot(g[0] - node[0], g[1] - node[1]) < TERMINAL_GRAB;
      const pieceEl = e.target.closest('.piece');
      const piece = pieceEl ? this.byId(Number(pieceEl.dataset.id)) : null;
      const base = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };

      if (piece && !(nearNode && this.isTerminal(node))) {
        const c = SL.center(piece);
        this.drag = { ...base, mode: 'move', piece, offset: [c[0] - g[0], c[1] - g[1]], candidate: null, valid: false, removing: false };
        this.select(piece.id);
      } else {
        this.drag = { ...base, mode: 'wire', start: node, end: node, axis: null, piece };
        this.select(null);
        this.drawWirePreview();
      }
    }

    onMove(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      e.preventDefault();
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < TAP_PX) return;
        d.moved = true;
        if (d.mode === 'move') this.liftPiece(d);
      }
      const g = this.toGrid(e);
      if (d.mode === 'wire') this.dragWire(d, g);
      else this.dragPiece(d, e, g);
    }

    onUp(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      this.drag = null;
      this.toolbox.classList.remove('show-trash', 'trash-hot');
      if (d.mode === 'move') this.finishMove(d);
      else if (d.mode === 'wire') this.finishWire(d);
      else this.finishNew(d);
    }

    onCancel(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      this.drag = null;
      this.toolbox.classList.remove('show-trash', 'trash-hot');
      if (d.mode === 'new') {
        d.group.remove();
        d.ghost.remove();
      } else if (d.mode === 'wire') {
        this.wirePreview.textContent = '';
      } else {
        d.piece.lifted = false;
        this.commit();
      }
    }

    // ---------- Moving and adding parts ----------

    liftPiece(d) {
      d.piece.lifted = true;
      d.group = this.groups.get(d.piece.id).g;
      d.group.classList.add('dragging');
      this.previewLayer.appendChild(d.group);
      this.toolbox.classList.add('show-trash');
      this.renderSelectionUI();
      this.reanalyze();
      SL.sound.play('pick');
    }

    dragPiece(d, e, g) {
      const removing = d.mode === 'move' && this.overToolbox(e);
      if (d.mode === 'new') {
        const over = this.overBoard(g) && !this.overToolbox(e);
        this.showGhost(d, e, !over);
        d.group.style.display = over ? '' : 'none';
        if (!over) {
          d.valid = false;
          d.candidate = null;
          return;
        }
      }
      const cand = SL.clampIn(SL.placeAt(d.piece, g[0] + d.offset[0], g[1] + d.offset[1]), this.cols, this.rows);
      d.candidate = cand;
      d.removing = removing;
      d.valid = !removing && this.isFree(cand, d.piece.id);
      SL.setPlacement(d.group, cand);
      d.group.classList.toggle('invalid', !d.valid && !removing);
      d.group.classList.toggle('removing', removing);
      this.toolbox.classList.toggle('trash-hot', removing);
    }

    showGhost(d, e, visible) {
      d.ghost.style.display = visible ? 'block' : 'none';
      if (!visible) return;
      const s = this.scale();
      d.ghost.style.width = `${260 * s}px`;
      d.ghost.style.height = `${128 * s}px`;
      d.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY + d.offset[1] * CELL * s}px) translate(-50%, -50%)`;
    }

    finishMove(d) {
      const p = d.piece;
      if (!d.moved) {
        this.tap(p);
        return;
      }
      p.lifted = false;
      if (d.removing) {
        this.remove(p.id);
        SL.sound.play('remove');
      } else if (d.valid && d.candidate) {
        p.x = d.candidate.x;
        p.y = d.candidate.y;
        SL.sound.play('place');
      }
      this.commit();
    }

    tap(p) {
      if (p.type === 'switch') {
        p.on = !p.on;
        this.animateLever(p);
        SL.sound.play('click');
      } else if (p.type === 'bulb' && p.broken) {
        p.broken = false;
        SL.sound.play('place');
      }
      this.selectedId = p.id;
      this.commit();
    }

    animateLever(p) {
      const entry = this.groups.get(p.id);
      if (!entry) return;
      const g = entry.g;
      const lever = g.querySelector('.lever');
      const from = p.on ? SL.LEVER_OPEN : 0;
      const to = p.on ? 0 : SL.LEVER_OPEN;
      const start = performance.now();
      g._animating = true;
      const step = (now) => {
        const t = Math.min(1, (now - start) / 150);
        const eased = 1 - Math.pow(1 - t, 3);
        lever.setAttribute('transform', `rotate(${from + (to - from) * eased})`);
        if (t < 1) requestAnimationFrame(step);
        else g._animating = false;
      };
      requestAnimationFrame(step);
    }

    startNew(type, e) {
      if (this.drag) return;
      const piece = { id: 0, type, x: 0, y: 0, dir: 0, len: SL.TYPES[type].len, on: false, color: this.wireColor() };
      const group = SL.drawPiece(piece);
      group.classList.add('dragging');
      group.style.display = 'none';
      this.previewLayer.appendChild(group);

      const ghost = document.createElement('div');
      ghost.className = 'ghost';
      ghost.style.display = 'none';
      ghost.appendChild(SL.makeIcon(type, piece.color));
      document.body.appendChild(ghost);

      this.select(null);
      this.drag = {
        pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, mode: 'new',
        piece, group, ghost, candidate: null, valid: false,
        offset: [0, e.pointerType === 'touch' ? -0.6 : 0], // keep the part visible above the finger
      };
      SL.sound.play('pick');
    }

    finishNew(d) {
      d.group.remove();
      d.ghost.remove();
      if (!d.moved) {
        this.placeAnywhere(d.piece.type);
        return;
      }
      if (!d.valid || !d.candidate) return;
      this.add({ ...d.candidate });
    }

    add(p) {
      p.id = this.nextId++;
      if (p.type === 'wire') {
        p.color = this.wireColor();
        this.colorIndex++;
      }
      this.pieces.push(p);
      this.selectedId = p.id;
      SL.sound.play('place');
      this.commit();
    }

    // Used for a plain tap (or keyboard) on a toolbox button.
    placeAnywhere(type) {
      const len = SL.TYPES[type].len;
      const used = new Set(this.pieces.flatMap((p) => SL.nodesOf(p).map(SL.nodeKey)));
      const mid = [this.cols / 2, this.rows / 2];
      let best = null;
      let bestScore = Infinity;
      for (let x = 0; x <= this.cols; x++) {
        for (let y = 0; y <= this.rows; y++) {
          for (const dir of [0, 1]) {
            const p = { type, x, y, dir, len, on: false };
            if (!this.isFree(p, null)) continue;
            const c = SL.center(p);
            const touches = SL.nodesOf(p).some((n) => used.has(SL.nodeKey(n)));
            const score = Math.hypot(c[0] - mid[0], c[1] - mid[1]) + (touches ? 100 : 0) + dir * 0.01;
            if (score < bestScore) { best = p; bestScore = score; }
          }
        }
      }
      if (best) this.add(best);
      else SL.sound.play('buzz');
    }

    rotateSelected() {
      const p = this.byId(this.selectedId);
      if (!p) return;
      for (let k = 1; k <= 3; k++) {
        const cand = SL.clampIn(SL.rotated(p, (p.dir + k) % 4), this.cols, this.rows);
        if (this.isFree(cand, p.id)) {
          Object.assign(p, { x: cand.x, y: cand.y, dir: cand.dir });
          SL.sound.play('place');
          this.commit();
          return;
        }
      }
      SL.sound.play('buzz');
    }

    removeSelected() {
      if (this.selectedId == null) return;
      this.remove(this.selectedId);
      SL.sound.play('remove');
      this.commit();
    }

    remove(id) {
      this.pieces = this.pieces.filter((p) => p.id !== id);
      if (this.selectedId === id) this.selectedId = null;
    }

    // ---------- Drawing wires dot-to-dot ----------

    dragWire(d, g) {
      d.end = [clamp(Math.round(g[0]), 0, this.cols), clamp(Math.round(g[1]), 0, this.rows)];
      const dx = Math.abs(g[0] - d.start[0]);
      const dy = Math.abs(g[1] - d.start[1]);
      if (sameNode(d.end, d.start) && Math.max(dx, dy) < 0.35) d.axis = null;
      else if (!d.axis && Math.max(dx, dy) > 0.35) d.axis = dx >= dy ? 'h' : 'v';
      this.drawWirePreview();
    }

    route(start, end, axis) {
      const corner = axis === 'v' ? [start[0], end[1]] : [end[0], start[1]];
      const nodes = [start.slice()];
      const walk = (to) => {
        let [x, y] = nodes[nodes.length - 1];
        while (x !== to[0] || y !== to[1]) {
          if (x !== to[0]) x += Math.sign(to[0] - x);
          else y += Math.sign(to[1] - y);
          nodes.push([x, y]);
        }
      };
      walk(corner);
      walk(end);
      return nodes;
    }

    drawWirePreview() {
      const d = this.drag;
      const layer = this.wirePreview;
      layer.textContent = '';
      if (!d || d.mode !== 'wire') return;
      const nodes = this.route(d.start, d.end, d.axis);
      if (nodes.length > 1) {
        el('polyline', {
          class: 'wire-preview',
          stroke: this.wireColor(),
          points: nodes.map((n) => `${n[0] * CELL},${n[1] * CELL}`).join(' '),
        }, layer);
      }
      el('circle', { class: 'wire-preview-node', cx: d.start[0] * CELL, cy: d.start[1] * CELL, r: 22 }, layer);
      if (!sameNode(d.start, d.end)) el('circle', { class: 'wire-preview-node', cx: d.end[0] * CELL, cy: d.end[1] * CELL, r: 22 }, layer);
    }

    finishWire(d) {
      this.wirePreview.textContent = '';
      if (!d.moved && d.piece) {
        this.tap(d.piece);
        return;
      }
      if (sameNode(d.start, d.end)) {
        this.commit();
        return;
      }
      const nodes = this.route(d.start, d.end, d.axis);
      const color = this.wireColor();
      const made = [];
      let current = null;
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1];
        const b = nodes[i];
        const dir = SL.dirOf(b[0] - a[0], b[1] - a[1]);
        const unit = { type: 'wire', x: a[0], y: a[1], dir, len: 1 };
        if (!this.isFree(unit, null, made)) {
          current = null;
          continue;
        }
        if (current && current.dir === dir) current.len++;
        else {
          current = { id: this.nextId++, type: 'wire', x: a[0], y: a[1], dir, len: 1, color };
          made.push(current);
        }
      }
      if (made.length) {
        this.colorIndex++;
        this.pieces.push(...made);
        SL.sound.play('place');
      }
      this.commit();
    }

    // ---------- State, rendering and saving ----------

    load(list) {
      for (const entry of this.groups.values()) entry.g.remove();
      this.groups.clear();
      this.pieces = [];
      this.selectedId = null;
      for (const raw of Array.isArray(list) ? list : []) {
        if (!raw || !SL.TYPES[raw.type]) continue;
        const p = {
          type: raw.type,
          x: raw.x | 0,
          y: raw.y | 0,
          dir: (((raw.dir | 0) % 4) + 4) % 4,
          len: raw.type === 'wire' ? Math.max(1, raw.len | 0) : SL.TYPES[raw.type].len,
          on: !!raw.on,
          broken: !!raw.broken,
          color: SL.WIRE_COLORS.includes(raw.color) ? raw.color : SL.WIRE_COLORS[0],
        };
        if (!this.isFree(p, null)) continue;
        p.id = this.nextId++;
        this.pieces.push(p);
      }
      this.commit();
    }

    serialize() {
      return this.pieces.map(({ type, x, y, dir, len, on, broken, color }) => ({ type, x, y, dir, len, on: !!on, broken: !!broken, color }));
    }

    commit() {
      this.render();
      this.reanalyze();
      this.onChange(this.analysis);
    }

    reanalyze() {
      this.analysis = SL.analyze(this.pieces.filter((p) => !p.lifted));
      if (this.analysis.blown.length) SL.sound.play('pop');
      this.refreshStates();
      this.rebuildFlows();
    }

    render() {
      const seen = new Set();
      const ordered = [...this.pieces].sort((a, b) => (a.type === 'wire' ? 0 : 1) - (b.type === 'wire' ? 0 : 1));
      for (const p of ordered) {
        const sig = [p.type, p.dir, p.len, p.color].join('|');
        let entry = this.groups.get(p.id);
        if (!entry || entry.sig !== sig) {
          if (entry) entry.g.remove();
          entry = { g: SL.drawPiece(p), sig };
          this.groups.set(p.id, entry);
        }
        SL.setPlacement(entry.g, p);
        entry.g.classList.remove('dragging', 'invalid', 'removing');
        this.pieceLayer.appendChild(entry.g);
        seen.add(p.id);
      }
      for (const [id, entry] of this.groups) {
        if (!seen.has(id)) {
          entry.g.remove();
          this.groups.delete(id);
        }
      }
      this.renderSelectionUI();
    }

    refreshStates() {
      for (const p of this.pieces) {
        const entry = this.groups.get(p.id);
        if (!entry) continue;
        const g = entry.g;
        g.classList.toggle('selected', p.id === this.selectedId && !p.lifted);
        g.classList.toggle('on', !!p.on);
        g.classList.toggle('broken', !!p.broken);
        g.classList.toggle('hot', this.analysis.shorted.has(p.id));
        if (p.type === 'switch' && !g._animating) {
          g.querySelector('.lever').setAttribute('transform', `rotate(${p.on ? 0 : SL.LEVER_OPEN})`);
        }
        if (p.type === 'bulb') paintBulb(g, this.analysis.bulbs.get(p.id) || 0);
      }
    }

    renderSelectionUI() {
      this.uiLayer.textContent = '';
      const p = this.byId(this.selectedId);
      if (!p || p.lifted) return;
      const c = SL.center(p);
      const [dx, dy] = DIRS[p.dir];
      let px = -dy;
      let py = dx;
      const OFF = 0.8;
      const SPREAD = 0.36;
      const outside = (x, y) => x < -0.3 || y < -0.3 || x > this.cols + 0.3 || y > this.rows + 0.3;
      if (outside(c[0] + px * OFF, c[1] + py * OFF)) { px = -px; py = -py; }
      const bx = c[0] + px * OFF;
      const by = c[1] + py * OFF;
      this.selButton('rotate', bx - dx * SPREAD, by - dy * SPREAD, 'Turn', 'M-11.3 6.5 A13 13 0 1 1 0 13 M6 7 L0 13 L6 19');
      this.selButton('delete', bx + dx * SPREAD, by + dy * SPREAD, 'Put away', 'M-9 -9 L9 9 M9 -9 L-9 9');
    }

    selButton(action, gx, gy, title, d) {
      const g = el('g', { class: `sel-btn ${action}`, 'data-action': action, transform: `translate(${gx * CELL} ${gy * CELL})` }, this.uiLayer);
      el('title', null, g).textContent = title;
      el('circle', { r: 30 }, g);
      el('path', { d }, g);
    }

    // ---------- Electrons ----------

    rebuildFlows() {
      this.electronLayer.textContent = '';
      this.flows = [];
      for (const e of this.analysis.elements) {
        const amps = e.current;
        if (!(Math.abs(amps) > 1e-3)) continue;
        const a = [e.a[0] * CELL, e.a[1] * CELL];
        const b = [e.b[0] * CELL, e.b[1] * CELL];
        const reversed = amps > 0; // electrons move the opposite way to conventional current
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const flow = {
          from: reversed ? b : a,
          to: reversed ? a : b,
          reversed,
          length,
          phase: 0,
          speed: clamp(Math.abs(amps) * SPEED_PER_AMP, MIN_SPEED, MAX_SPEED),
          hide: HIDDEN[e.piece.type],
          dots: [],
        };
        const count = Math.round(length / SPACING);
        for (let k = 0; k < count; k++) flow.dots.push(el('circle', { class: 'electron', r: 7, cx: -999, cy: -999 }, this.electronLayer));
        this.flows.push(flow);
      }
    }

    frame(now) {
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      for (const f of this.flows) {
        f.phase = (f.phase + f.speed * dt) % SPACING;
        for (let k = 0; k < f.dots.length; k++) {
          const s = (f.phase + k * SPACING) / f.length;
          const along = f.reversed ? 1 - s : s;
          const dot = f.dots[k];
          dot.setAttribute('cx', (f.from[0] + (f.to[0] - f.from[0]) * s).toFixed(1));
          dot.setAttribute('cy', (f.from[1] + (f.to[1] - f.from[1]) * s).toFixed(1));
          dot.style.visibility = f.hide && along > f.hide[0] && along < f.hide[1] ? 'hidden' : 'visible';
        }
      }
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  SL.Board = Board;
})();
