// Page wiring: toolbox, buttons, status messages, help and saving.
(function () {
  'use strict';

  const SL = window.SparkLab;
  const STORE = 'sparklab-board-v1';

  const svg = document.getElementById('board');
  const toolbox = document.getElementById('toolbox');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const help = document.getElementById('help');
  const btnExample = document.getElementById('btn-example');
  const btnClear = document.getElementById('btn-clear');
  const btnSound = document.getElementById('btn-sound');
  const btnHelp = document.getElementById('btn-help');

  function loadSaved() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE));
      return data && Array.isArray(data.pieces) ? data : null;
    } catch (e) {
      return null;
    }
  }

  const saved = loadSaved();
  const portrait = window.innerHeight > window.innerWidth;
  const cols = saved && saved.cols >= 6 ? saved.cols : portrait ? 8 : 12;
  const rows = saved && saved.rows >= 6 ? saved.rows : portrait ? 10 : 7;

  let previousLit = 0;
  let previousShort = false;

  const board = new SL.Board(svg, { cols, rows, toolbox, onChange });

  function onChange(analysis) {
    const [tone, message, litCount] = describe(board.pieces, analysis);
    if (statusText.textContent !== message) statusText.textContent = message;
    statusEl.dataset.tone = tone;

    const shorted = analysis.shorted.size > 0;
    if (litCount > 0 && previousLit === 0) SL.sound.play('lit');
    if (shorted && !previousShort) SL.sound.play('buzz');
    previousLit = litCount;
    previousShort = shorted;

    try {
      localStorage.setItem(STORE, JSON.stringify({ cols, rows, pieces: board.serialize() }));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------- Friendly explanations ----------

  function describe(pieces, a) {
    const of = (type) => pieces.filter((p) => p.type === type);
    const bulbs = of('bulb');
    const levels = bulbs.map((b) => a.bulbs.get(b.id) || 0);
    const lit = levels.filter((v) => v > SL.LIT);
    const broken = bulbs.filter((b) => b.broken).length;

    if (!pieces.length) {
      return ['idle', 'Drag a battery and a bulb from the toolbox onto the board.', 0];
    }
    if (a.blown.length) {
      return ['warn', 'Pop! Too many batteries gave the bulb too much power and it burned out. Tap the bulb to put in a new one.', lit.length];
    }
    if (a.shorted.size) {
      return ['danger', 'Short circuit! The electrons found a shortcut that skips the bulbs, so the battery is getting hot. Take away the shortcut wire.', lit.length];
    }
    if (lit.length) {
      const max = Math.max(...lit);
      const min = Math.min(...lit);
      let msg = lit.length === 1
        ? 'The circuit is closed! Electrons flow all the way round, so the bulb lights up.'
        : `The circuit is closed! Electrons flow round and ${lit.length} bulbs light up.`;
      if (max > 2) msg = 'Super bright! More batteries give the electrons a bigger push.';
      else if (min < 0.5) msg += ' Bulbs in the same line share the push, so they glow dimmer.';
      const dark = bulbs.length - broken - lit.length;
      if (dark > 0) msg += dark === 1 ? ' One bulb is not in the loop yet.' : ` ${dark} bulbs are not in the loop yet.`;
      return ['good', msg, lit.length];
    }
    if (broken) return ['warn', 'A bulb is burned out. Tap it to put in a new one.', 0];
    if (!of('battery').length) return ['idle', 'Add a battery. It is what pushes the electrons around.', 0];
    if (!bulbs.length) return ['idle', 'Add a bulb so you can see the electricity working.', 0];

    const switches = of('switch');
    if (switches.some((s) => !s.on)) {
      const test = pieces.map((p) => ({ ...p, on: true }));
      const tryIt = SL.analyze(test);
      if ([...tryIt.bulbs.values()].some((v) => v > SL.LIT)) {
        return ['idle', 'The switch is open, so there is a gap in the loop. Tap the switch to close it!', 0];
      }
    }
    return ['idle', 'The circuit is open. Slide your finger from dot to dot to draw wires: from the battery\'s + end, through the bulb, back to the − end.', 0];
  }

  // ---------- Toolbox ----------

  for (const tool of toolbox.querySelectorAll('.tool')) {
    const type = tool.dataset.type;
    tool.querySelector('.tool-icon').appendChild(SL.makeIcon(type, SL.WIRE_COLORS[0]));
    tool.setAttribute('aria-label', `Add a ${SL.TYPES[type].name.toLowerCase()}`);
    tool.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      board.startNew(type, e);
    });
    tool.addEventListener('click', (e) => {
      if (e.detail === 0) board.placeAnywhere(type); // keyboard activation
    });
  }

  // ---------- Header buttons ----------

  function example() {
    const dx = Math.floor(cols / 2) - 4;
    const dy = Math.floor(rows / 2) - 4;
    const parts = [
      { type: 'battery', x: 2, y: 6, dir: 3 },
      { type: 'wire', x: 2, y: 4, dir: 3, len: 2, color: '#ef4444' },
      { type: 'switch', x: 2, y: 2, dir: 0, on: false },
      { type: 'wire', x: 4, y: 2, dir: 0, len: 2, color: '#ef4444' },
      { type: 'bulb', x: 6, y: 2, dir: 1 },
      { type: 'wire', x: 6, y: 4, dir: 1, len: 2, color: '#2563eb' },
      { type: 'wire', x: 6, y: 6, dir: 2, len: 4, color: '#2563eb' },
    ];
    board.load(parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })));
  }

  btnExample.addEventListener('click', () => {
    example();
    SL.sound.play('place');
  });

  let clearTimer = null;
  const clearLabel = btnClear.querySelector('.btn-label');
  function resetClear() {
    clearTimeout(clearTimer);
    clearTimer = null;
    btnClear.classList.remove('confirm');
    clearLabel.textContent = 'Clear';
  }
  btnClear.addEventListener('click', () => {
    if (!board.pieces.length) return;
    if (clearTimer) {
      resetClear();
      board.load([]);
      SL.sound.play('remove');
      return;
    }
    btnClear.classList.add('confirm');
    clearLabel.textContent = 'Tap again';
    clearTimer = setTimeout(resetClear, 2500);
  });

  const SPEAKER = '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>';
  function paintSound() {
    const on = !SL.sound.muted;
    btnSound.setAttribute('aria-pressed', String(on));
    btnSound.setAttribute('aria-label', on ? 'Sound is on' : 'Sound is off');
    btnSound.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}${
      on
        ? '<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
        : '<path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    }</svg>`;
  }
  btnSound.addEventListener('click', () => {
    SL.sound.setMuted(!SL.sound.muted);
    paintSound();
    SL.sound.play('click');
  });
  paintSound();

  function openHelp() {
    if (typeof help.showModal === 'function') help.showModal();
    else help.setAttribute('open', '');
  }
  btnHelp.addEventListener('click', openHelp);

  // ---------- Keyboard shortcuts ----------

  window.addEventListener('keydown', (e) => {
    if (help.open || board.selectedId == null) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      board.removeSelected();
    } else if (e.key === 'r' || e.key === 'R') {
      board.rotateSelected();
    } else if (e.key === 'Escape') {
      board.select(null);
    }
  });

  // ---------- Start ----------

  board.load(saved ? saved.pieces : []);
  if (!saved) openHelp();
})();
