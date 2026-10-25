import * as THREE from "./three.module.js";

const canvas = document.querySelector("#view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false });
renderer.setPixelRatio(1);
renderer.setClearColor(0xfffdf8, 1);

const scene = new THREE.Scene();
const square = new THREE.Mesh(
  new THREE.BoxGeometry(1.15, 1.15, 0.08),
  new THREE.MeshBasicMaterial({ color: 0xd0892c }),
);
square.position.x = -0.85;
const circle = new THREE.Mesh(
  new THREE.CylinderGeometry(0.58, 0.58, 0.08, 16),
  new THREE.MeshBasicMaterial({ color: 0x2f5d73 }),
);
circle.rotation.x = Math.PI / 2;
circle.position.x = 0.85;
scene.add(square, circle);

const front = new THREE.OrthographicCamera(-2.1, 2.1, 1.35, -1.35, 0.1, 20);
front.position.set(0, 0, 4);
front.lookAt(0, 0, 0);

const side = new THREE.OrthographicCamera(-2.1, 2.1, 1.35, -1.35, 0.1, 20);
side.position.set(4, 0, 0);
side.lookAt(0, 0, 0);

let split = false;
let viewWidth = 320;
let viewHeight = 180;

function draw() {
  if (!split) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewWidth, viewHeight);
    renderer.render(scene, front);
    return;
  }
  const half = Math.floor(viewWidth / 2);
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, half, viewHeight);
  renderer.setScissor(0, 0, half, viewHeight);
  renderer.clear();
  renderer.render(scene, front);
  renderer.setViewport(half, 0, viewWidth - half, viewHeight);
  renderer.setScissor(half, 0, viewWidth - half, viewHeight);
  renderer.clear();
  renderer.render(scene, side);
  renderer.autoClear = true;
}

function fit() {
  viewWidth = canvas.clientWidth || 320;
  viewHeight = canvas.clientHeight || 180;
  renderer.setSize(viewWidth, viewHeight, false);
  draw();
}

fit();

document.querySelector("[data-shape=a]").addEventListener("click", function () {
  const dimension = window.ArtifactKit.params.dimension;
  square.rotation.z += Math.PI / 4;
  const same = dimension === "3d";
  if (same) {
    split = true;
    document.querySelector("#side-note").hidden = false;
  }
  draw();
  document.querySelector("#readout").textContent = same
    ? "Same square and circle. The side view shows a thin edge, not new sides."
    : "The square still has 4 corners. The circle has 0. They are not the same.";
  window.ArtifactKit.emit("shape_rotated", { shape: "a", dimension: dimension });
  window.ArtifactKit.emit("shapes_compared", { dimension: dimension, same: same });
});
