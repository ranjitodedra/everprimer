// Electrical model: nodal analysis on the grid dots.
// Wires and closed switches are tiny resistors, bulbs are resistors,
// and each battery is a 1.5 V source with a little internal resistance.
(function () {
  'use strict';

  const SL = window.SparkLab;

  const PARAMS = {
    volts: 1.5,
    batteryOhms: 0.25,
    bulbOhms: 3,
    wireOhms: 0.01,
    shortAmps: 3,   // more than this through a battery counts as a short circuit
    blowRatio: 5,   // a bulb burns out above 5x its normal power
  };

  const LIT = 0.02;

  // Power of one bulb on one battery is "normal brightness" (1.0).
  const NORMAL_POWER = (() => {
    const amps = PARAMS.volts / (PARAMS.bulbOhms + PARAMS.batteryOhms);
    return amps * amps * PARAMS.bulbOhms;
  })();

  function buildElements(pieces) {
    const out = [];
    for (const p of pieces) {
      const [dx, dy] = SL.DIRS[p.dir];
      if (p.type === 'wire') {
        for (let i = 0; i < p.len; i++) {
          out.push({
            kind: 'R', R: PARAMS.wireOhms, piece: p,
            a: [p.x + dx * i, p.y + dy * i],
            b: [p.x + dx * (i + 1), p.y + dy * (i + 1)],
          });
        }
        continue;
      }
      const [a, b] = SL.ends(p);
      if (p.type === 'battery') {
        out.push({ kind: 'V', V: PARAMS.volts, r: PARAMS.batteryOhms, a, b, piece: p }); // b is the + end
      } else if (p.type === 'bulb' && !p.broken) {
        out.push({ kind: 'R', R: PARAMS.bulbOhms, a, b, piece: p });
      } else if (p.type === 'switch' && p.on) {
        out.push({ kind: 'R', R: PARAMS.wireOhms, a, b, piece: p });
      }
    }
    return out;
  }

  function gauss(A, rhs) {
    const n = rhs.length;
    for (let c = 0; c < n; c++) {
      let pivot = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
      if (Math.abs(A[pivot][c]) < 1e-12) continue;
      [A[c], A[pivot]] = [A[pivot], A[c]];
      [rhs[c], rhs[pivot]] = [rhs[pivot], rhs[c]];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        if (!f) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        rhs[r] -= f * rhs[c];
      }
    }
    const x = new Float64Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = rhs[r];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
      x[r] = Math.abs(A[r][r]) < 1e-12 ? 0 : s / A[r][r];
    }
    return x;
  }

  // Sets element.current = conventional current flowing from end a to end b.
  function solve(elements) {
    const index = new Map();
    const idOf = (n) => {
      const k = SL.nodeKey(n);
      if (!index.has(k)) index.set(k, index.size);
      return index.get(k);
    };
    for (const e of elements) {
      e.na = idOf(e.a);
      e.nb = idOf(e.b);
    }
    const n = index.size;

    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    for (const e of elements) parent[find(e.na)] = find(e.nb);

    // One grounded node per separate group of parts keeps the system solvable.
    const col = new Array(n);
    const grounded = new Set();
    let m = 0;
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (grounded.has(root)) col[i] = m++;
      else { grounded.add(root); col[i] = -1; }
    }

    const G = Array.from({ length: m }, () => new Float64Array(m));
    const I = new Float64Array(m);
    const stamp = (a, b, g) => {
      const ca = col[a];
      const cb = col[b];
      if (ca >= 0) G[ca][ca] += g;
      if (cb >= 0) G[cb][cb] += g;
      if (ca >= 0 && cb >= 0) { G[ca][cb] -= g; G[cb][ca] -= g; }
    };
    const inject = (node, amps) => { if (col[node] >= 0) I[col[node]] += amps; };

    for (const e of elements) {
      if (e.kind === 'R') {
        stamp(e.na, e.nb, 1 / e.R);
      } else {
        stamp(e.na, e.nb, 1 / e.r);
        inject(e.nb, e.V / e.r);
        inject(e.na, -e.V / e.r);
      }
    }

    const x = gauss(G, I);
    const volt = (node) => (col[node] < 0 ? 0 : x[col[node]]);
    for (const e of elements) {
      const dv = volt(e.na) - volt(e.nb);
      e.current = e.kind === 'R' ? dv / e.R : (e.V + dv) / e.r;
    }
  }

  function solveOnce(pieces) {
    const elements = buildElements(pieces);
    solve(elements);
    const bulbs = new Map();
    const shorted = new Set();
    for (const e of elements) {
      if (e.piece.type === 'bulb') bulbs.set(e.piece.id, (e.current * e.current * e.R) / NORMAL_POWER);
      if (e.piece.type === 'battery' && Math.abs(e.current) > PARAMS.shortAmps) shorted.add(e.piece.id);
    }
    return { elements, bulbs, shorted };
  }

  // Bulbs that get far too much power burn out (one at a time, brightest first).
  function analyze(pieces) {
    const blown = [];
    let result = solveOnce(pieces);
    for (let guard = 0; guard < pieces.length; guard++) {
      let worst = null;
      for (const p of pieces) {
        if (p.type !== 'bulb' || p.broken) continue;
        const level = result.bulbs.get(p.id) || 0;
        if (level > PARAMS.blowRatio && (!worst || level > result.bulbs.get(worst.id))) worst = p;
      }
      if (!worst) break;
      worst.broken = true;
      blown.push(worst.id);
      result = solveOnce(pieces);
    }
    result.blown = blown;
    return result;
  }

  Object.assign(SL, { analyze, LIT, CIRCUIT_PARAMS: PARAMS });
})();
