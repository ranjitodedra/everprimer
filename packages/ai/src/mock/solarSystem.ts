import type { ArtifactBlueprint, GeneratedCurriculum, LearnerContext } from "@eco/contracts";
import { buildGameBlueprint, type MockSeed } from "./game";

/**
 * Hand-checked seed content used by the mock provider so the product can be
 * demonstrated end to end without API keys. Facts verified against NASA
 * public figures; keep it that way if you edit.
 */

export const SOLAR_SYSTEM_CURRICULUM: GeneratedCurriculum = {
  title: "Our Solar System",
  description: "A journey from the Sun outward: what the solar system is, how the planets differ, and what else is out there.",
  topics: [
    {
      slug: "what-is-the-solar-system",
      title: "What Is the Solar System?",
      description: "The Sun, the eight planets, and how gravity keeps everything moving in orbits.",
      difficulty: 1,
      prerequisites: [],
      learningObjectives: [
        "Identify the Sun as the centre of the solar system",
        "Name the eight planets in order from the Sun",
        "Explain that gravity keeps planets in orbit",
      ],
    },
    {
      slug: "the-sun",
      title: "The Sun",
      description: "Our star: what it is made of, how big it is, and why it shines.",
      difficulty: 2,
      prerequisites: ["what-is-the-solar-system"],
      learningObjectives: [
        "Identify the Sun as a star",
        "Describe the Sun's size compared with Earth",
        "Explain that the Sun gives Earth light and heat",
      ],
    },
    {
      slug: "the-rocky-planets",
      title: "The Rocky Planets",
      description: "Mercury, Venus, Earth and Mars: the small, solid worlds closest to the Sun.",
      difficulty: 2,
      prerequisites: ["what-is-the-solar-system"],
      learningObjectives: [
        "Name the four rocky planets",
        "Describe one distinctive feature of each rocky planet",
        "Explain why Earth can support life",
      ],
    },
    {
      slug: "jupiter",
      title: "Jupiter",
      description: "The giant of the solar system: its size, its storms, and its many moons.",
      difficulty: 2,
      prerequisites: ["what-is-the-solar-system"],
      learningObjectives: [
        "Identify Jupiter as a gas giant",
        "Explain why Jupiter is much larger than Earth",
        "Recognize the Great Red Spot as a giant storm",
        "Understand that Jupiter has many moons",
      ],
    },
    {
      slug: "saturn-uranus-neptune",
      title: "Saturn, Uranus and Neptune",
      description: "The other giants: rings, sideways spinning, and the windy blue world at the edge.",
      difficulty: 2,
      prerequisites: ["jupiter"],
      learningObjectives: [
        "Identify Saturn by its rings",
        "Describe how Uranus and Neptune differ from Jupiter and Saturn",
        "Order the outer planets by distance from the Sun",
      ],
    },
    {
      slug: "moons-asteroids-comets",
      title: "Moons, Asteroids and Comets",
      description: "The smaller members of the family and where they are found.",
      difficulty: 2,
      prerequisites: ["the-rocky-planets", "jupiter"],
      learningObjectives: [
        "Explain what a moon is",
        "Locate the asteroid belt between Mars and Jupiter",
        "Describe what makes a comet grow a tail",
      ],
    },
    {
      slug: "solar-system-review",
      title: "Solar System Review",
      description: "Put it all together: order, sizes, and the big ideas.",
      difficulty: 2,
      prerequisites: ["saturn-uranus-neptune", "moons-asteroids-comets"],
      learningObjectives: [
        "Order all eight planets from the Sun",
        "Compare rocky planets with gas and ice giants",
        "Explain how gravity organizes the solar system",
      ],
    },
  ],
};

export const SOLAR_SYSTEM_SEEDS: Record<string, MockSeed> = {
  "what-is-the-solar-system": {
    theme: { primary: "#1d4ed8", accent: "#f59e0b", background: "#f8fafc", mood: "cosmic and calm", emoji: "🌌" },
    personalization: "Uses a team framing: the Sun as the captain and the planets as the crew.",
    facts: [
      { id: "f1", text: "The Sun sits at the centre of the solar system." },
      { id: "f2", text: "The solar system is the Sun and everything that orbits it." },
      { id: "f3", text: "Eight planets orbit the Sun: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune." },
    ],
    items: [
      { id: "sun", label: "Sun", description: "The star at the centre.", emoji: "☀️" },
      { id: "planets", label: "Planets", description: "Eight worlds that orbit the Sun.", emoji: "🪐" },
      { id: "gravity", label: "Gravity", description: "The pull that keeps planets in orbit.", emoji: "🧲" },
    ],
  },
  "the-sun": {
    theme: { primary: "#ea580c", accent: "#facc15", background: "#fff7ed", mood: "warm and bright", emoji: "☀️" },
    facts: [
      { id: "f1", text: "The Sun is a star, a giant ball of hot glowing gas." },
      { id: "f2", text: "About one million Earths could fit inside the Sun." },
      { id: "f3", text: "The Sun gives Earth light and heat." },
    ],
    items: [
      { id: "star", label: "Star", description: "The Sun is our nearest star.", emoji: "⭐" },
      { id: "size", label: "Huge", description: "The Sun is far bigger than Earth.", emoji: "🟠" },
      { id: "heat", label: "Heat", description: "Light and heat travel to Earth.", emoji: "🔥" },
    ],
  },
  "the-rocky-planets": {
    theme: { primary: "#9a3412", accent: "#0ea5e9", background: "#fff7ed", mood: "dusty and warm", emoji: "🪨" },
    facts: [
      { id: "f1", text: "The four rocky planets are Mercury, Venus, Earth and Mars." },
      { id: "f2", text: "Earth has liquid water on its surface." },
      { id: "f3", text: "Life as we know it needs liquid water." },
    ],
    items: [
      { id: "mercury", label: "Mercury", description: "A small rocky world.", emoji: "☿️" },
      { id: "venus", label: "Venus", description: "A hot rocky world.", emoji: "☁️" },
      { id: "earth", label: "Earth", description: "Our home, with water.", emoji: "🌍" },
      { id: "mars", label: "Mars", description: "A rusty rocky world.", emoji: "🔴" },
    ],
  },
  jupiter: {
    theme: { primary: "#c2410c", accent: "#fbbf24", background: "#fff7ed", mood: "stormy and grand", emoji: "🪐" },
    facts: [
      { id: "f1", text: "Jupiter is a gas giant with no solid ground." },
      { id: "f2", text: "Jupiter is the largest planet in the solar system." },
      { id: "f3", text: "The Great Red Spot is a giant storm on Jupiter." },
      { id: "f4", text: "Jupiter has many moons, including Io and Europa." },
    ],
    items: [
      { id: "gas", label: "Gas giant", description: "A huge world made of gas.", emoji: "🟠" },
      { id: "storm", label: "Red Spot", description: "A storm bigger than Earth.", emoji: "🔴" },
      { id: "moons", label: "Moons", description: "Jupiter has lots of moons.", emoji: "🌕" },
    ],
  },
  "saturn-uranus-neptune": {
    theme: { primary: "#1d4ed8", accent: "#f59e0b", background: "#eff6ff", mood: "icy and far", emoji: "💍" },
    facts: [
      { id: "f1", text: "Saturn is known for its bright rings." },
      { id: "f2", text: "Uranus spins on its side. Neptune is a windy blue world." },
      { id: "f3", text: "From the Sun: Jupiter, Saturn, Uranus, then Neptune." },
    ],
    items: [
      { id: "saturn", label: "Saturn", description: "The planet with bright rings.", emoji: "💍" },
      { id: "uranus", label: "Uranus", description: "It spins on its side.", emoji: "🟢" },
      { id: "neptune", label: "Neptune", description: "A windy blue world.", emoji: "🔵" },
    ],
  },
  "moons-asteroids-comets": {
    theme: { primary: "#57534e", accent: "#22c55e", background: "#fafaf9", mood: "small and busy", emoji: "☄️" },
    facts: [
      { id: "f1", text: "A moon is a natural object that orbits a planet." },
      { id: "f2", text: "The asteroid belt sits between Mars and Jupiter." },
      { id: "f3", text: "A comet grows a tail when the Sun warms its ice." },
    ],
    items: [
      { id: "moon", label: "Moon", description: "A world that orbits a planet.", emoji: "🌙" },
      { id: "belt", label: "Asteroids", description: "Rocks between Mars and Jupiter.", emoji: "🪨" },
      { id: "comet", label: "Comet", description: "Ice that grows a tail near the Sun.", emoji: "☄️" },
    ],
  },
  "solar-system-review": {
    theme: { primary: "#4f46e5", accent: "#f59e0b", background: "#eef2ff", mood: "big picture", emoji: "✨" },
    facts: [
      { id: "f1", text: "From the Sun: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune." },
      { id: "f2", text: "Rocky planets are small and solid. Giants are big and made of gas or ice." },
      { id: "f3", text: "Gravity keeps the solar system together." },
    ],
    items: [
      { id: "order", label: "Order", description: "Eight planets from the Sun outward.", emoji: "🧭" },
      { id: "kinds", label: "Kinds", description: "Rocky worlds and giant worlds.", emoji: "🪨" },
      { id: "pull", label: "Gravity", description: "The pull that organizes it all.", emoji: "🧲" },
    ],
  },
};

const demoLearner: LearnerContext = {
  displayName: "Ava",
  age: 8,
  readingLevel: "developing",
  interests: [],
  notes: [],
  strengths: [],
  misconceptions: [],
  analogies: [],
};

export const SOLAR_SYSTEM_BLUEPRINTS: Record<string, ArtifactBlueprint> = Object.fromEntries(
  SOLAR_SYSTEM_CURRICULUM.topics.map((t) => [
    t.slug,
    buildGameBlueprint({
      topic: { slug: t.slug, title: t.title, description: t.description, objectives: t.learningObjectives },
      learner: demoLearner,
      seed: SOLAR_SYSTEM_SEEDS[t.slug],
    }),
  ]),
);
