import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ORGANELLES, ORGANELLE_MAP } from './organelles.js';
import { buildAnimalCell } from './cellBuilder.js';

// DOM Elements
const canvas = document.getElementById('cell-canvas');
const labelsContainer = document.getElementById('labels-container');
const chipsContainer = document.getElementById('organelle-chips');
const discoveryCountEl = document.getElementById('discovery-count');

const infoPanel = document.getElementById('info-panel');
const sheetToggle = document.getElementById('sheet-toggle');
const infoSwatch = document.getElementById('info-swatch');
const infoNickname = document.getElementById('info-nickname');
const infoTitle = document.getElementById('info-title');
const infoSummary = document.getElementById('info-summary');
const infoJob = document.getElementById('info-job');
const infoAnalogy = document.getElementById('info-analogy');
const infoFact = document.getElementById('info-fact');

const btnLabels = document.getElementById('btn-labels');
const btnMembrane = document.getElementById('btn-membrane');
const btnTour = document.getElementById('btn-tour');
const btnReset = document.getElementById('btn-reset');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnCloseInfo = document.getElementById('btn-close-info');

// Application State
let selectedOrganelleId = null;
let labelsVisible = true;
let membraneVisible = true;
let autoSpin = false;
const discoveredSet = new Set();

// Scene, Camera & Renderer Setup (tuned for smooth 60fps on phones)
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
const defaultCameraPos = new THREE.Vector3(0, 5.4, 8.8);
const defaultTarget = new THREE.Vector3(0, -0.2, 0);
camera.position.copy(defaultCameraPos);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

// Orbit Controls
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.9;
controls.enablePan = false;
controls.minDistance = 2.8;
controls.maxDistance = 15.5;
controls.maxPolarAngle = Math.PI * 0.62;
controls.minPolarAngle = Math.PI * 0.08;
controls.target.copy(defaultTarget);

// Studio + Bioluminescent Microscope Lighting
const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.85);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.75);
keyLight.position.set(6, 10, 7);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
fillLight.position.set(-7, 5, -5);
scene.add(fillLight);

const rimLight = new THREE.PointLight(0xa855f7, 1.2, 16);
rimLight.position.set(0, -3.5, 0);
scene.add(rimLight);

// Build 3D Animal Cell Model
const cellModel = buildAnimalCell(scene);

// Smooth Camera Flight State
const camGoalPos = defaultCameraPos.clone();
const camGoalTarget = defaultTarget.clone();
let isCameraTransitioning = false;

controls.addEventListener('start', () => {
  isCameraTransitioning = false;
});

// Create Floating 3D Pin Labels & Bottom Dock Chips
const labelElements = new Map();
const chipElements = new Map();

function initUI() {
  discoveryCountEl.textContent = `0 / ${ORGANELLES.length}`;

  ORGANELLES.forEach((org) => {
    // 1. Floating 3D Label Button
    const labelBtn = document.createElement('button');
    labelBtn.type = 'button';
    labelBtn.className = 'cell-label';
    labelBtn.style.setProperty('--label-color', org.color);
    labelBtn.innerHTML = `<span class="cell-label-dot"></span><span>${org.name}</span>`;
    labelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectOrganelle(org.id);
    });
    labelsContainer.appendChild(labelBtn);
    labelElements.set(org.id, {
      el: labelBtn,
      worldPos: new THREE.Vector3(...org.labelPos)
    });

    // 2. Quick-Select Chip in Bottom Dock
    const chipBtn = document.createElement('button');
    chipBtn.type = 'button';
    chipBtn.className = 'organelle-chip';
    chipBtn.style.setProperty('--chip-color', org.color);
    chipBtn.innerHTML = `<span class="chip-dot"></span><span>${org.name}</span>`;
    chipBtn.addEventListener('click', () => {
      selectOrganelle(org.id);
    });
    chipsContainer.appendChild(chipBtn);
    chipElements.set(org.id, chipBtn);
  });
}

initUI();

// Select an Organelle & Focus Camera + Update Info Card
function selectOrganelle(organelleId) {
  const org = ORGANELLE_MAP.get(organelleId);
  if (!org) {
    resetToOverview();
    return;
  }

  selectedOrganelleId = organelleId;
  infoPanel.classList.remove('is-compact');

  // Track discovery progress
  discoveredSet.add(organelleId);
  discoveryCountEl.textContent = `${discoveredSet.size} / ${ORGANELLES.length}`;

  // Update Info Card UI
  infoSwatch.style.background = org.color;
  infoSwatch.style.boxShadow = `0 0 10px ${org.color}`;
  infoNickname.textContent = org.nickname;
  infoNickname.style.color = org.color;
  infoTitle.textContent = org.name;
  infoSummary.textContent = org.description;
  infoJob.textContent = org.job;
  infoAnalogy.textContent = org.analogy;
  infoFact.textContent = org.funFact;

  // Highlight active label & chip
  labelElements.forEach(({ el }, id) => {
    el.classList.toggle('is-selected', id === organelleId);
  });

  chipElements.forEach((chip, id) => {
    const isCurrent = id === organelleId;
    chip.classList.toggle('is-active', isCurrent);
    if (isCurrent) {
      chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });

  // Highlight 3D Mesh
  cellModel.setHighlightedOrganelle(organelleId);

  // Set smooth camera flight targets
  camGoalTarget.set(...org.focusPos);
  camGoalPos.set(...org.cameraOffset);
  isCameraTransitioning = true;
}

function resetToOverview() {
  selectedOrganelleId = null;
  cellModel.setHighlightedOrganelle(null);

  infoSwatch.style.background = '#38bdf8';
  infoSwatch.style.boxShadow = '0 0 10px #38bdf8';
  infoNickname.textContent = 'TAP TO EXPLORE';
  infoNickname.style.color = '#7dd3fc';
  infoTitle.textContent = 'Welcome to the Animal Cell!';
  infoSummary.textContent =
    'Every animal—including you—is built from trillions of microscopic living factories called cells. Drag to rotate in 3D, pinch or scroll to zoom, and tap any glowing part inside!';
  infoJob.textContent = 'Keep life running';
  infoAnalogy.textContent = 'Entire Mini-City';
  infoFact.textContent =
    'Your body has around 30 to 40 trillion cells, and each single cell performs thousands of chemical reactions every second!';

  labelElements.forEach(({ el }) => el.classList.remove('is-selected'));
  chipElements.forEach((chip) => chip.classList.remove('is-active'));

  camGoalTarget.copy(defaultTarget);
  camGoalPos.copy(defaultCameraPos);
  isCameraTransitioning = true;
}

function stepOrganelle(direction) {
  const currentIndex = ORGANELLES.findIndex((o) => o.id === selectedOrganelleId);
  const nextIndex =
    currentIndex === -1
      ? 0
      : (currentIndex + direction + ORGANELLES.length) % ORGANELLES.length;
  selectOrganelle(ORGANELLES[nextIndex].id);
}

// Raycasting (Distinguishes clean tap/click from orbit drag on touch screens)
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
let pointerDownPos = { x: 0, y: 0 };
let pointerDownTime = 0;

canvas.addEventListener('pointerdown', (e) => {
  pointerDownPos = { x: e.clientX, y: e.clientY };
  pointerDownTime = performance.now();
});

canvas.addEventListener('pointerup', (e) => {
  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  const dist = Math.hypot(dx, dy);
  const elapsed = performance.now() - pointerDownTime;

  // Only treat as a tap if finger/mouse moved less than 9px and lasted under 450ms
  if (dist > 9 || elapsed > 450) return;

  const rect = canvas.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(cellModel.interactiveMeshes, false);

  // Filter out invisible membrane if hidden
  const validHit = hits.find((hit) => {
    if (!membraneVisible && hit.object.userData.organelleId === 'membrane') {
      return false;
    }
    return Boolean(hit.object.userData.organelleId);
  });

  if (validHit) {
    selectOrganelle(validHit.object.userData.organelleId);
  }
});

// HUD Controls & Buttons
btnLabels.addEventListener('click', () => {
  labelsVisible = !labelsVisible;
  btnLabels.classList.toggle('is-active', labelsVisible);
  btnLabels.setAttribute('aria-pressed', String(labelsVisible));
  labelsContainer.classList.toggle('is-hidden', !labelsVisible);
});

btnMembrane.addEventListener('click', () => {
  membraneVisible = !membraneVisible;
  btnMembrane.classList.toggle('is-active', membraneVisible);
  btnMembrane.setAttribute('aria-pressed', String(membraneVisible));
  cellModel.setMembraneVisible(membraneVisible);
});

btnTour.addEventListener('click', () => {
  autoSpin = !autoSpin;
  controls.autoRotate = autoSpin;
  controls.autoRotateSpeed = 1.6;
  btnTour.classList.toggle('is-active', autoSpin);
  btnTour.setAttribute('aria-pressed', String(autoSpin));
});

btnReset.addEventListener('click', () => {
  resetToOverview();
});

btnPrev.addEventListener('click', () => stepOrganelle(-1));
btnNext.addEventListener('click', () => stepOrganelle(1));
btnCloseInfo.addEventListener('click', () => resetToOverview());

sheetToggle.addEventListener('click', () => {
  infoPanel.classList.toggle('is-compact');
});

// Responsive Resize Handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Project 3D Label Anchors to 2D Screen Coordinates
const tempProjVec = new THREE.Vector3();

function updateFloatingLabels() {
  if (!labelsVisible) return;

  const width = window.innerWidth;
  const height = window.innerHeight;

  labelElements.forEach(({ el, worldPos }, id) => {
    if (!membraneVisible && id === 'membrane') {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }

    tempProjVec.copy(worldPos).project(camera);

    // Hide if behind camera
    if (tempProjVec.z > 1) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }

    const x = (tempProjVec.x * 0.5 + 0.5) * width;
    const y = (-tempProjVec.y * 0.5 + 0.5) * height;

    el.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

    const isSelected = id === selectedOrganelleId;
    el.style.opacity = selectedOrganelleId === null || isSelected ? '1' : '0.58';
    el.style.pointerEvents = 'auto';
  });
}

// Main Animation Loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const elapsedTime = clock.getElapsedTime();

  if (isCameraTransitioning) {
    camera.position.lerp(camGoalPos, 0.08);
    controls.target.lerp(camGoalTarget, 0.09);
    if (
      camera.position.distanceTo(camGoalPos) < 0.03 &&
      controls.target.distanceTo(camGoalTarget) < 0.03
    ) {
      isCameraTransitioning = false;
    }
  }

  controls.update();
  cellModel.updateAnimation(elapsedTime, selectedOrganelleId);
  renderer.render(scene, camera);
  updateFloatingLabels();
}

animate();
