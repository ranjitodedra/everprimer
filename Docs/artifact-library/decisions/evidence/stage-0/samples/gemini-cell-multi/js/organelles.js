/**
 * Educational organelle content tailored for ages 10-13.
 * Includes 3D label anchor coordinates, camera focus offsets, and kid-friendly analogies.
 */
export const ORGANELLES = [
  {
    id: 'nucleus',
    name: 'Nucleus',
    nickname: 'The Command Center',
    color: '#a855f7',
    job: 'Stores DNA & directs cell activity',
    analogy: 'City Hall & Blueprint Vault',
    description:
      'The nucleus is the control center of the animal cell. Inside its double-layered envelope lives your DNA—the master instruction manual that tells the cell how to grow, repair itself, and do its job.',
    funFact:
      'If you uncoiled all the DNA packed inside just ONE microscopic cell nucleus, the strand would stretch about 2 meters (6.5 feet) long!',
    labelPos: [0, 1.55, 0],
    focusPos: [0, 0.35, 0],
    cameraOffset: [0, 2.2, 4.4]
  },
  {
    id: 'nucleolus',
    name: 'Nucleolus',
    nickname: 'The Ribosome Maker',
    color: '#f43f5e',
    job: 'Builds ribosome parts',
    analogy: 'Tool-Making Workshop inside City Hall',
    description:
      'Sitting right inside the center of the nucleus like a glowing pearl, the nucleolus is a dense sphere that assembles the building blocks for ribosomes before shipping them out through nuclear pores.',
    funFact:
      'Unlike most organelles, the nucleolus has no membrane wall around it—it forms naturally like a droplet of oil in water!',
    labelPos: [0.35, 0.65, 0.35],
    focusPos: [0, 0.35, 0],
    cameraOffset: [1.2, 1.6, 3.1]
  },
  {
    id: 'mitochondria',
    name: 'Mitochondria',
    nickname: 'The Powerhouse',
    color: '#f97316',
    job: 'Turns food into ATP energy',
    analogy: 'Power Plants & Battery Chargers',
    description:
      'Mitochondria take nutrients from the food you eat and oxygen you breathe to generate ATP—tiny rechargeable energy packets that power everything your cell does. Notice the wavy inner folds called cristae!',
    funFact:
      'Mitochondria have their own separate DNA and can divide on their own! Scientists discovered they were once ancient free-living bacteria.',
    labelPos: [-2.35, 0.65, 1.15],
    focusPos: [-2.15, 0.25, 1.05],
    cameraOffset: [-3.4, 2.1, 3.6]
  },
  {
    id: 'rough-er',
    name: 'Rough ER',
    nickname: 'The Protein Highway',
    color: '#38bdf8',
    job: 'Folds & packages proteins',
    analogy: 'Assembly Line & Highway Network',
    description:
      'The Rough Endoplasmic Reticulum (ER) is a maze of folded membranes hugging the nucleus. It looks "rough" because thousands of tiny ribosomes stud its surface, pumping newly made proteins inside to be folded.',
    funFact:
      'The Rough ER membrane connects directly to the outer shell of the nucleus, creating a direct pipeline from DNA instructions to protein production!',
    labelPos: [-1.45, 0.85, -1.35],
    focusPos: [-1.25, 0.3, -1.15],
    cameraOffset: [-2.8, 2.5, -3.2]
  },
  {
    id: 'smooth-er',
    name: 'Smooth ER',
    nickname: 'The Lipid Lab & Detox Unit',
    color: '#06b6d4',
    job: 'Makes healthy fats & cleans toxins',
    analogy: 'Chemical Refinery & Recycling Filter',
    description:
      'Unlike Rough ER, the Smooth ER has no ribosomes on its surface and forms branching coral-like tubes. It manufactures lipids (fats) to repair cell membranes and neutralizes harmful chemicals.',
    funFact:
      'Liver cells are packed with extra Smooth ER because your liver’s main job is filtering and detoxifying everything that enters your bloodstream!',
    labelPos: [1.95, 0.6, -1.6],
    focusPos: [1.8, 0.2, -1.45],
    cameraOffset: [3.4, 2.1, -3.3]
  },
  {
    id: 'golgi',
    name: 'Golgi Apparatus',
    nickname: 'The Post Office',
    color: '#10b981',
    job: 'Sorts, tags & ships proteins',
    analogy: 'Central Post Office & Delivery Hub',
    description:
      'Shaped like a stack of curved pancakes, the Golgi apparatus receives raw proteins from the ER, attaches molecular "address tags" to them, and seals them inside bubble-like vesicles for delivery.',
    funFact:
      'It is named after Italian scientist Camillo Golgi, who spotted it in 1898 using a special silver stain under an early microscope!',
    labelPos: [2.15, 0.75, 1.35],
    focusPos: [1.95, 0.25, 1.2],
    cameraOffset: [3.6, 2.2, 3.5]
  },
  {
    id: 'ribosomes',
    name: 'Ribosomes',
    nickname: 'The 3D Protein Printers',
    color: '#facc15',
    job: 'Reads RNA code to build proteins',
    analogy: 'Microscopic 3D Printers',
    description:
      'Ribosomes are tiny molecular machines floating in the cytoplasm or attached to the Rough ER. They read messenger RNA recipes from the nucleus and snap amino acids together into proteins.',
    funFact:
      'A single human cell can contain up to 10 MILLION ribosomes working at the exact same time, linking 20 amino acids per second!',
    labelPos: [-0.65, 0.55, 2.35],
    focusPos: [-0.55, 0.25, 2.15],
    cameraOffset: [-1.2, 2.0, 4.4]
  },
  {
    id: 'lysosome',
    name: 'Lysosomes',
    nickname: 'The Recycling Crew',
    color: '#ec4899',
    job: 'Breaks down waste & worn-out parts',
    analogy: 'Recycling Plant & Security Guards',
    description:
      'Lysosomes are glowing spheres filled with powerful digestive enzymes. They patrol the cell, swallowing up invading bacteria, cellular trash, and broken organelles so their parts can be reused.',
    funFact:
      'The inside of a lysosome is kept super acidic (around pH 4.5—like lemon juice) so its digestive enzymes work at full strength!',
    labelPos: [0.85, 0.65, 2.45],
    focusPos: [0.75, 0.25, 2.2],
    cameraOffset: [1.8, 2.1, 4.6]
  },
  {
    id: 'centrosome',
    name: 'Centrosome',
    nickname: 'The Spiderweb Architect',
    color: '#818cf8',
    job: 'Organizes cytoskeleton & cell division',
    analogy: 'Scaffolding & Crane Crew',
    description:
      'Made of two barrel-shaped centrioles arranged at right angles, the centrosome organizes the cell’s internal microtubule tracks and pulls chromosomes apart when the cell divides into two.',
    funFact:
      'Each centriole barrel is built from 9 triplets of protein tubes arranged in a pinwheel pattern that looks just like a microscopic gear!',
    labelPos: [2.5, 0.7, -0.15],
    focusPos: [2.3, 0.3, -0.15],
    cameraOffset: [4.4, 2.2, 0.8]
  },
  {
    id: 'membrane',
    name: 'Cell Membrane',
    nickname: 'The Smart Security Gate',
    color: '#2dd4bf',
    job: 'Controls what enters and leaves',
    analogy: 'City Border & Smart Security Gates',
    description:
      'Wrapping the entire cell is a flexible double layer of phospholipids studded with protein channels. Alongside the jelly-like cytoplasm inside, it protects the cell while letting water, nutrients, and signals pass.',
    funFact:
      'The cell membrane is only about 8 nanometers thick—you would need to stack 10,000 cell membranes on top of each other to equal the thickness of one sheet of paper!',
    labelPos: [-3.5, 0.4, -1.8],
    focusPos: [0, -0.2, 0],
    cameraOffset: [0, 4.6, 8.2]
  }
];

export const ORGANELLE_MAP = new Map(ORGANELLES.map((item) => [item.id, item]));
