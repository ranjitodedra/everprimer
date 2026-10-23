import * as THREE from 'three';

/**
 * Builds the 3D Animal Cell cutaway model and all organelles using procedural Three.js geometries.
 * Every clickable mesh stores `userData.organelleId` for instant raycasting on touch & mouse.
 */
export function buildAnimalCell(scene) {
  const root = new THREE.Group();
  scene.add(root);

  const organelleGroups = new Map();
  const animatedItems = [];
  const interactiveMeshes = [];

  function registerOrganelleGroup(id) {
    const group = new THREE.Group();
    group.name = id;
    group.userData.organelleId = id;
    root.add(group);
    organelleGroups.set(id, group);
    return group;
  }

  function tagInteractive(object3D, organelleId) {
    object3D.traverse((child) => {
      if (child.isMesh) {
        child.userData.organelleId = organelleId;
        // Clone material if shared so individual organelle highlighting works cleanly
        child.userData.baseEmissive = child.material.emissive
          ? child.material.emissive.clone()
          : new THREE.Color(0x000000);
        child.userData.baseEmissiveIntensity =
          child.material.emissiveIntensity !== undefined ? child.material.emissiveIntensity : 0.2;
        interactiveMeshes.push(child);
      }
    });
  }

  // 1. CELL MEMBRANE & CYTOPLASM BOWL (Cutaway Hemisphere Bowl)
  const membraneGroup = registerOrganelleGroup('membrane');

  // Outer lipid bilayer bowl
  const outerBowlGeo = new THREE.SphereGeometry(4.25, 48, 32, 0, Math.PI * 2, Math.PI * 0.46, Math.PI * 0.54);
  const outerBowlMat = new THREE.MeshPhysicalMaterial({
    color: 0x14b8a6,
    emissive: 0x0d9488,
    emissiveIntensity: 0.22,
    roughness: 0.28,
    metalness: 0.05,
    transmission: 0.45,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide
  });
  const outerBowl = new THREE.Mesh(outerBowlGeo, outerBowlMat);
  outerBowl.scale.set(1.06, 0.82, 0.98);
  membraneGroup.add(outerBowl);

  // Membrane Cutaway Rim (Phospholipid cross-section ring)
  const rimRadius = Math.sin(Math.PI * 0.46) * 4.25;
  const rimY = Math.cos(Math.PI * 0.46) * 4.25 * 0.82;
  const rimGeo = new THREE.TorusGeometry(rimRadius, 0.14, 16, 72);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x2dd4bf,
    emissive: 0x14b8a6,
    emissiveIntensity: 0.4,
    roughness: 0.3
  });
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.y = rimY;
  rimMesh.scale.set(1.06, 0.98, 1);
  membraneGroup.add(rimMesh);

  // Translucent Cytoplasm Interior Surface
  const cytoSurfaceGeo = new THREE.CircleGeometry(rimRadius * 0.99, 64);
  const cytoSurfaceMat = new THREE.MeshPhysicalMaterial({
    color: 0x0ea5e9,
    emissive: 0x0284c7,
    emissiveIntensity: 0.15,
    roughness: 0.35,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide
  });
  const cytoSurface = new THREE.Mesh(cytoSurfaceGeo, cytoSurfaceMat);
  cytoSurface.rotation.x = -Math.PI / 2;
  cytoSurface.position.y = rimY - 0.04;
  cytoSurface.scale.set(1.06, 0.98, 1);
  membraneGroup.add(cytoSurface);

  tagInteractive(membraneGroup, 'membrane');

  // 2. NUCLEUS (Cutaway Double-Membrane Sphere at Center)
  const nucleusGroup = registerOrganelleGroup('nucleus');
  nucleusGroup.position.set(0, 0.35, 0);

  // Main three-quarter cutaway sphere so kids can see the nucleolus inside
  const nucShellGeo = new THREE.SphereGeometry(1.18, 40, 32, 0, Math.PI * 1.55, 0, Math.PI);
  const nucShellMat = new THREE.MeshStandardMaterial({
    color: 0xa855f7,
    emissive: 0x7e22ce,
    emissiveIntensity: 0.32,
    roughness: 0.35,
    metalness: 0.1,
    side: THREE.DoubleSide
  });
  const nucShell = new THREE.Mesh(nucShellGeo, nucShellMat);
  nucShell.rotation.y = Math.PI * 0.45;
  nucleusGroup.add(nucShell);

  // Inner nucleoplasm core (translucent)
  const nucCoreGeo = new THREE.SphereGeometry(1.08, 32, 24);
  const nucCoreMat = new THREE.MeshPhysicalMaterial({
    color: 0xc084fc,
    emissive: 0x6b21a8,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.38,
    roughness: 0.2
  });
  const nucCore = new THREE.Mesh(nucCoreGeo, nucCoreMat);
  nucleusGroup.add(nucCore);

  // Chromatin DNA spaghetti strands inside nucleus
  const chromatinMat = new THREE.MeshStandardMaterial({
    color: 0xe879f9,
    emissive: 0xc026d3,
    emissiveIntensity: 0.45,
    roughness: 0.3
  });
  for (let i = 0; i < 3; i++) {
    const knotGeo = new THREE.TorusKnotGeometry(0.55, 0.032, 64, 8, 2 + i, 3);
    const knot = new THREE.Mesh(knotGeo, chromatinMat);
    knot.rotation.set(i * 1.1, i * 0.8, i * 0.5);
    nucleusGroup.add(knot);
  }

  // Nuclear pores around the outer surface
  const poreGeo = new THREE.TorusGeometry(0.08, 0.025, 8, 16);
  const poreMat = new THREE.MeshStandardMaterial({
    color: 0xd8b4fe,
    emissive: 0x9333ea,
    emissiveIntensity: 0.4
  });
  const poreAngles = [
    [0.6, 0.4],
    [1.1, 1.2],
    [1.6, 2.1],
    [2.1, 3.0],
    [1.4, 3.8],
    [0.9, 4.4],
    [1.8, 0.7]
  ];
  for (const [theta, phi] of poreAngles) {
    const pore = new THREE.Mesh(poreGeo, poreMat);
    const r = 1.18;
    pore.position.set(
      r * Math.sin(theta) * Math.cos(phi),
      r * Math.cos(theta),
      r * Math.sin(theta) * Math.sin(phi)
    );
    pore.lookAt(0, 0, 0);
    nucleusGroup.add(pore);
  }

  tagInteractive(nucleusGroup, 'nucleus');

  // 3. NUCLEOLUS (Glowing Dense Core Inside the Nucleus Cutaway)
  const nucleolusGroup = registerOrganelleGroup('nucleolus');
  nucleolusGroup.position.set(0.15, 0.42, 0.18);

  const nucleolusGeo = new THREE.SphereGeometry(0.42, 28, 28);
  const nucleolusMat = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0xe11d48,
    emissiveIntensity: 0.65,
    roughness: 0.22
  });
  const nucleolusMesh = new THREE.Mesh(nucleolusGeo, nucleolusMat);
  nucleolusGroup.add(nucleolusMesh);

  tagInteractive(nucleolusGroup, 'nucleolus');
  animatedItems.push({
    type: 'pulse',
    mesh: nucleolusMesh,
    speed: 2.4,
    amount: 0.06
  });

  // 4. MITOCHONDRIA (3 Bean-Shaped Powerhouses with Inner Cristae Folds)
  const mitoGroup = registerOrganelleGroup('mitochondria');

  function createMitochondrion(pos, rot, scale = 1) {
    const item = new THREE.Group();
    item.position.copy(pos);
    item.rotation.set(rot[0], rot[1], rot[2]);
    item.scale.setScalar(scale);

    // Outer shell (half-cut capsule so cristae are visible on top)
    const shellGeo = new THREE.CapsuleGeometry(0.36, 0.72, 12, 24);
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 0.35,
      roughness: 0.3
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.rotation.z = Math.PI / 2;
    shell.scale.set(1, 1, 0.78);
    item.add(shell);

    // Glowing yellow-orange inner matrix + cristae folds
    const cristaMat = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.6,
      roughness: 0.25
    });

    for (let i = -3; i <= 3; i++) {
      const foldGeo = new THREE.BoxGeometry(0.08, 0.22, 0.44);
      const fold = new THREE.Mesh(foldGeo, cristaMat);
      fold.position.set(i * 0.14, 0.22, (i % 2 === 0 ? 1 : -1) * 0.04);
      fold.rotation.y = 0.25 * (i % 2 === 0 ? 1 : -1);
      item.add(fold);
    }

    return item;
  }

  const m1 = createMitochondrion(new THREE.Vector3(-2.15, 0.25, 1.05), [0.15, 0.6, 0.1], 1.05);
  const m2 = createMitochondrion(new THREE.Vector3(-1.85, 0.18, -2.05), [-0.1, -0.5, 0.08], 0.92);
  const m3 = createMitochondrion(new THREE.Vector3(0.45, 0.15, -2.55), [0.1, 0.2, -0.12], 0.95);
  mitoGroup.add(m1, m2, m3);
  tagInteractive(mitoGroup, 'mitochondria');

  animatedItems.push({ type: 'bob', mesh: m1, baseY: 0.25, speed: 1.8, phase: 0 });
  animatedItems.push({ type: 'bob', mesh: m2, baseY: 0.18, speed: 2.1, phase: 2.0 });
  animatedItems.push({ type: 'bob', mesh: m3, baseY: 0.15, speed: 1.6, phase: 4.1 });

  // 5. ROUGH ENDOPLASMIC RETICULUM (Folded Sheets Wrapping Nucleus + Studs)
  const roughErGroup = registerOrganelleGroup('rough-er');
  const roughErMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.34,
    roughness: 0.32,
    side: THREE.DoubleSide
  });

  const studGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const studMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0xeab308,
    emissiveIntensity: 0.6
  });

  const arcRadii = [1.45, 1.72, 1.98];
  arcRadii.forEach((radius, idx) => {
    const arcGeo = new THREE.CylinderGeometry(
      radius,
      radius * 0.96,
      0.72 - idx * 0.06,
      36,
      4,
      true,
      Math.PI * 0.65,
      Math.PI * 0.85
    );
    const arcMesh = new THREE.Mesh(arcGeo, roughErMat);
    arcMesh.position.set(0, 0.25, 0);
    roughErGroup.add(arcMesh);

    // Rim tubes on top of each cisterna sheet for smooth 3D volume
    const curvePoints = [];
    const startAngle = Math.PI * 0.65;
    const endAngle = startAngle + Math.PI * 0.85;
    for (let s = 0; s <= 16; s++) {
      const a = startAngle + (s / 16) * (endAngle - startAngle);
      const wave = Math.sin(s * 1.1 + idx) * 0.06;
      curvePoints.push(
        new THREE.Vector3(
          Math.sin(a) * (radius + wave),
          0.58 - idx * 0.03,
          Math.cos(a) * (radius + wave)
        )
      );
    }
    const topCurve = new THREE.CatmullRomCurve3(curvePoints);
    const topTubeGeo = new THREE.TubeGeometry(topCurve, 32, 0.09, 10, false);
    const topTube = new THREE.Mesh(topTubeGeo, roughErMat);
    roughErGroup.add(topTube);

    // Stud ribosomes along Rough ER
    for (let r = 1; r < 15; r += 2) {
      const pt = curvePoints[r];
      const stud = new THREE.Mesh(studGeo, studMat);
      stud.position.set(pt.x, pt.y + 0.09, pt.z);
      roughErGroup.add(stud);
    }
  });

  tagInteractive(roughErGroup, 'rough-er');

  // 6. SMOOTH ENDOPLASMIC RETICULUM (Coral-like Branching Tubules)
  const smoothErGroup = registerOrganelleGroup('smooth-er');
  smoothErGroup.position.set(1.85, 0.2, -1.45);

  const smoothErMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x0891b2,
    emissiveIntensity: 0.36,
    roughness: 0.28
  });

  const tubulePaths = [
    [
      [-0.5, -0.1, 0.3],
      [-0.1, 0.25, 0.1],
      [0.35, 0.1, -0.2],
      [0.65, 0.3, -0.45]
    ],
    [
      [-0.3, 0.15, -0.4],
      [0.05, 0.35, -0.1],
      [0.45, 0.2, 0.35],
      [0.75, 0.05, 0.5]
    ],
    [
      [-0.45, 0.25, 0.0],
      [-0.15, 0.05, -0.35],
      [0.25, 0.32, -0.5],
      [0.55, 0.15, -0.1]
    ],
    [
      [0.0, -0.1, 0.55],
      [0.2, 0.28, 0.2],
      [-0.2, 0.38, -0.15]
    ]
  ];

  tubulePaths.forEach((pts) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.11, 12, false);
    const tubeMesh = new THREE.Mesh(tubeGeo, smoothErMat);
    smoothErGroup.add(tubeMesh);

    // Rounded end caps
    const capGeo = new THREE.SphereGeometry(0.11, 12, 12);
    const startCap = new THREE.Mesh(capGeo, smoothErMat);
    startCap.position.set(...pts[0]);
    const endCap = new THREE.Mesh(capGeo, smoothErMat);
    endCap.position.set(...pts[pts.length - 1]);
    smoothErGroup.add(startCap, endCap);
  });

  tagInteractive(smoothErGroup, 'smooth-er');

  // 7. GOLGI APPARATUS (Stacked Curved Cisternae + Secretory Vesicles)
  const golgiGroup = registerOrganelleGroup('golgi');
  golgiGroup.position.set(1.95, 0.25, 1.2);
  golgiGroup.rotation.y = -Math.PI * 0.32;

  const golgiMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x059669,
    emissiveIntensity: 0.38,
    roughness: 0.28
  });

  for (let i = 0; i < 5; i++) {
    const span = 0.65 - Math.abs(i - 2) * 0.09;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-span, 0, -0.25 - i * 0.16),
      new THREE.Vector3(0, 0.06, -0.05 - i * 0.16),
      new THREE.Vector3(span, 0, -0.25 - i * 0.16)
    ]);
    const foldGeo = new THREE.TubeGeometry(curve, 24, 0.095, 12, false);
    const foldMesh = new THREE.Mesh(foldGeo, golgiMat);
    foldMesh.scale.set(1, 1.6, 1);
    golgiGroup.add(foldMesh);
  }

  // Budding Golgi transport vesicles
  const vesicleOffsets = [
    [-0.75, 0.12, -0.3],
    [0.78, 0.15, -0.45],
    [0.62, 0.24, -0.85],
    [-0.58, 0.2, -0.78]
  ];
  vesicleOffsets.forEach(([x, y, z]) => {
    const vMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 14), golgiMat);
    vMesh.position.set(x, y, z);
    golgiGroup.add(vMesh);
  });

  tagInteractive(golgiGroup, 'golgi');

  // 8. RIBOSOMES (Free Protein-Building Clusters in Cytoplasm)
  const riboGroup = registerOrganelleGroup('ribosomes');
  const riboMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0xca8a04,
    emissiveIntensity: 0.55,
    roughness: 0.25
  });

  const riboClusterCenters = [
    [-0.55, 0.25, 2.15],
    [-1.4, 0.22, 2.25],
    [-0.1, 0.28, 1.65],
    [1.1, 0.24, -2.25],
    [-2.55, 0.22, -0.45]
  ];

  riboClusterCenters.forEach(([cx, cy, cz], idx) => {
    const cluster = new THREE.Group();
    cluster.position.set(cx, cy, cz);

    // Large + small subunit pair (hero ribosome)
    const largeSub = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 14), riboMat);
    const smallSub = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), riboMat);
    smallSub.position.set(0.08, 0.11, 0.04);
    cluster.add(largeSub, smallSub);

    // Neighboring polyribosome beads
    for (let j = 0; j < 3; j++) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), riboMat);
      const angle = (j / 3) * Math.PI * 2 + idx;
      bead.position.set(Math.cos(angle) * 0.28, (j % 2) * 0.06, Math.sin(angle) * 0.28);
      cluster.add(bead);
    }

    riboGroup.add(cluster);
    animatedItems.push({ type: 'bob', mesh: cluster, baseY: cy, speed: 2.3, phase: idx * 1.1 });
  });

  tagInteractive(riboGroup, 'ribosomes');

  // 9. LYSOSOMES (Glowing Pink-Magenta Enzyme Spheres)
  const lysoGroup = registerOrganelleGroup('lysosome');
  const lysoOuterMat = new THREE.MeshPhysicalMaterial({
    color: 0xec4899,
    emissive: 0xdb2777,
    emissiveIntensity: 0.42,
    roughness: 0.2,
    transmission: 0.35,
    transparent: true,
    opacity: 0.88
  });
  const lysoCoreMat = new THREE.MeshStandardMaterial({
    color: 0xfdf2f8,
    emissive: 0xf472b6,
    emissiveIntensity: 0.8
  });

  const lysoLocations = [
    [0.75, 0.25, 2.2, 0.34],
    [-1.15, 0.24, 2.65, 0.27],
    [2.65, 0.22, 0.55, 0.29],
    [-2.8, 0.24, -1.1, 0.26]
  ];

  lysoLocations.forEach(([x, y, z, r], i) => {
    const holder = new THREE.Group();
    holder.position.set(x, y, z);

    const outer = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 24), lysoOuterMat);
    holder.add(outer);

    // Digestive enzyme granules inside
    for (let g = 0; g < 4; g++) {
      const granule = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 10, 10), lysoCoreMat);
      const a = (g / 4) * Math.PI * 2;
      granule.position.set(Math.cos(a) * r * 0.4, (g % 2 === 0 ? 1 : -1) * r * 0.2, Math.sin(a) * r * 0.4);
      holder.add(granule);
    }

    lysoGroup.add(holder);
    animatedItems.push({ type: 'bob', mesh: holder, baseY: y, speed: 1.9, phase: i * 1.5 });
  });

  tagInteractive(lysoGroup, 'lysosome');

  // 10. CENTROSOME (Pair of Perpendicular Microtubule Centriole Barrels)
  const centroGroup = registerOrganelleGroup('centrosome');
  centroGroup.position.set(2.3, 0.3, -0.15);

  const centroMat = new THREE.MeshStandardMaterial({
    color: 0x818cf8,
    emissive: 0x4f46e5,
    emissiveIntensity: 0.45,
    roughness: 0.28
  });

  function createCentrioleBarrel() {
    const barrel = new THREE.Group();
    const numTubes = 9;
    const ringRadius = 0.16;
    const tubeGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.52, 8);
    for (let i = 0; i < numTubes; i++) {
      const angle = (i / numTubes) * Math.PI * 2;
      const rod = new THREE.Mesh(tubeGeo, centroMat);
      rod.position.set(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
      barrel.add(rod);
    }
    const coreHub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.46, 12), centroMat);
    barrel.add(coreHub);
    return barrel;
  }

  const barrelA = createCentrioleBarrel();
  barrelA.rotation.set(0.3, 0.2, 0.4);
  const barrelB = createCentrioleBarrel();
  barrelB.position.set(0.32, 0.06, 0.22);
  barrelB.rotation.set(1.7, -0.3, 0.2);

  centroGroup.add(barrelA, barrelB);
  tagInteractive(centroGroup, 'centrosome');

  // Ambient floating cytosol particles (non-blocking visual depth)
  const particleCount = 120;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const r = 1.4 + Math.random() * 2.5;
    const theta = Math.random() * Math.PI * 2;
    particlePositions[i * 3] = Math.cos(theta) * r;
    particlePositions[i * 3 + 1] = (Math.random() - 0.3) * 1.4;
    particlePositions[i * 3 + 2] = Math.sin(theta) * r;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0x7dd3fc,
    size: 0.06,
    transparent: true,
    opacity: 0.55
  });
  const cytosolParticles = new THREE.Points(particleGeo, particleMat);
  root.add(cytosolParticles);

  // Highlight state controller
  function setHighlightedOrganelle(selectedId) {
    organelleGroups.forEach((group, id) => {
      const isSelected = id === selectedId;
      group.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        if (selectedId === null) {
          if (child.userData.baseEmissive) {
            child.material.emissive.copy(child.userData.baseEmissive);
            child.material.emissiveIntensity = child.userData.baseEmissiveIntensity;
          }
        } else if (isSelected) {
          child.material.emissiveIntensity = Math.min(1.15, (child.userData.baseEmissiveIntensity || 0.3) * 2.3);
        } else {
          child.material.emissiveIntensity = (child.userData.baseEmissiveIntensity || 0.2) * 0.35;
        }
      });
    });
  }

  // Toggle outer membrane shell visibility so kids can inspect edges even more closely
  function setMembraneVisible(visible) {
    membraneGroup.visible = visible;
  }

  // Frame-by-frame gentle biological motion
  function updateAnimation(elapsedTime, selectedId) {
    cytosolParticles.rotation.y = elapsedTime * 0.04;

    for (const item of animatedItems) {
      if (item.type === 'bob') {
        item.mesh.position.y = item.baseY + Math.sin(elapsedTime * item.speed + item.phase) * 0.045;
      } else if (item.type === 'pulse') {
        const s = 1 + Math.sin(elapsedTime * item.speed) * item.amount;
        item.mesh.scale.setScalar(s);
      }
    }

    // Gentle pulse on currently selected organelle
    if (selectedId && organelleGroups.has(selectedId) && selectedId !== 'membrane') {
      const activeGroup = organelleGroups.get(selectedId);
      const pulse = 1 + Math.sin(elapsedTime * 4.2) * 0.035;
      activeGroup.scale.setScalar(pulse);
    }

    organelleGroups.forEach((group, id) => {
      if (id !== selectedId) {
        group.scale.lerp(new THREE.Vector3(1, 1, 1), 0.15);
      }
    });
  }

  return {
    root,
    organelleGroups,
    interactiveMeshes,
    setHighlightedOrganelle,
    setMembraneVisible,
    updateAnimation
  };
}
