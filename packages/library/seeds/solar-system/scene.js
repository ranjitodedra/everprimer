import * as THREE from "./three.module.js";

const ORDER = ["mercury", "venus", "earth", "mars"];
const NAMES = { mercury: "Mercury", venus: "Venus", earth: "Earth", mars: "Mars" };

const PLANETS = [
  { id: "mercury", color: 0xd5d3cf, radius: 1.5, size: 0.12, days: 88, start: 0.5 },
  { id: "venus", color: 0xe6c27a, radius: 2.15, size: 0.18, days: 225, start: 1.7 },
  { id: "earth", color: 0x8ec5ff, radius: 2.85, size: 0.2, days: 365, start: 2.8 },
  { id: "mars", color: 0xe08a6a, radius: 3.6, size: 0.16, days: 687, start: 4.2 },
];

const canvas = document.querySelector("#sky");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: "low-power",
});
renderer.setPixelRatio(1);
renderer.setSize(canvas.width, canvas.height, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10182b);
const camera = new THREE.PerspectiveCamera(42, canvas.width / canvas.height, 0.1, 50);
camera.position.set(0, 8.2, 6.4);
camera.lookAt(0, 0, 0);

scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshBasicMaterial({ color: 0xf0c14a })));

const bodies = PLANETS.map((planet) => {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(planet.size, 10, 8),
    new THREE.MeshBasicMaterial({ color: planet.color }),
  );
  scene.add(mesh);
  const points = [];
  for (let i = 0; i <= 48; i++) {
    const turn = (i / 48) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(turn) * planet.radius, 0, Math.sin(turn) * planet.radius));
  }
  scene.add(
    new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x4c5d82 })),
  );
  return { planet, mesh };
});

function place(spin) {
  for (const body of bodies) {
    const turn = body.planet.start + spin / (body.planet.days / 88);
    body.mesh.position.set(Math.cos(turn) * body.planet.radius, 0, Math.sin(turn) * body.planet.radius);
  }
}

place(0);
renderer.render(scene, camera);

let spin = 0;
function frame() {
  const still = document.documentElement.getAttribute("data-reduced-motion") === "true";
  if (!still) {
    spin += 0.012;
    place(spin);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function listedPlanets(raw) {
  if (Array.isArray(raw)) return raw.filter((item) => typeof item === "string" && item.length > 0);
  if (typeof raw === "string") return raw.split(",").map((part) => part.trim()).filter(Boolean);
  return ORDER.slice();
}

function daysOf(id) {
  const planet = PLANETS.find((item) => item.id === id);
  return planet ? planet.days : 0;
}

document.querySelectorAll("[data-planet]").forEach((button) => {
  button.addEventListener("click", () => {
    const planet = button.getAttribute("data-planet");
    if (!planet || !NAMES[planet]) return;
    const raw = window.ArtifactKit.params.planets;
    const listed = listedPlanets(raw);
    const known = ORDER.filter((id) => listed.indexOf(id) !== -1);
    if (known.indexOf(planet) === -1) known.push(planet);
    known.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    const at = known.indexOf(planet);
    const neighbor = at < known.length - 1 ? known[at + 1] : known[Math.max(0, at - 1)];
    const other = neighbor && neighbor !== planet ? neighbor : planet === "mars" ? "earth" : "mars";
    const inner = ORDER.indexOf(planet) < ORDER.indexOf(other) ? planet : other;
    const outer = inner === planet ? other : planet;
    window.ArtifactKit.emit("planet_selected", { planet });
    window.ArtifactKit.emit("orbit_comparison_completed", { inner, outer, days: daysOf(outer) });
    for (const body of bodies) body.mesh.scale.setScalar(body.planet.id === planet ? 1.6 : 1);
    document.querySelectorAll("[data-planet]").forEach((item) => {
      const id = item.getAttribute("data-planet");
      const on = id === inner || id === outer;
      item.classList.toggle("is-on", on);
      item.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.querySelector("#note").textContent =
      NAMES[inner] +
      " is closer to the Sun than " +
      NAMES[outer] +
      ". " +
      NAMES[inner] +
      " takes " +
      daysOf(inner) +
      " days. " +
      NAMES[outer] +
      " takes " +
      daysOf(outer) +
      " days.";
    renderer.render(scene, camera);
  });
});
