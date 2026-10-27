# Authoring brief

Paste this brief into an outside tool when you ask it to build a level 3 library seed.

A level 3 seed has at least one param, at least one declared event, a tutor-guide intro, at least one step, at least one hint, and at least one success criterion whose evidence names are all declared events.

The built-in event `interacted` is reserved and must not be declared.

Read params inside the gesture that uses them, because the host sends those values when the page becomes ready.

The runtime posts ready when the page has loaded, and authors do not ship a second copy of the runtime.

Artifact ids are lowercase words joined by hyphens, 3 to 64 characters, for example solar-system-simulator.

Event names are snake_case, a lowercase letter followed by 1 to 47 lowercase letters, digits, or underscores, for example planet_selected.

Param keys are camelCase, a lowercase letter followed by up to 39 letters or digits, for example orbitSpeed.

The vendor lock pins are `three@0.160.0`, `three@0.170.0`, `matter-js@0.19.0`, `gsap@3.12.5`, and `canvas-confetti@1.9.2`.

`d3`, `p5`, and `chart.js` are rejected.

This set uses `three` at 0.170.0, `matter-js` at 0.19.0, or no pin, and does not pin `gsap` or `canvas-confetti`.

A script loaded from a public CDN is a static report error. Stay within 300 files, 5 MB per file, 15 MB per bundle, and a max bundle size at or under 15360 KB.

Every tech pin is copied into the third-party license list.
