# Example lesson

The landing page shows a playable Halves lesson for Maya. Choosing what she loves changes the story, and picking the shape cut into two equal parts awards one star. Reloading forgets the star.

## Sub-features

- `example-interest` switches the story to football.
- `example-answer` marks two equal parts correct and shows one star.
- `example-forget` reloads and shows zero stars.

## How to get to it (user POV)

- Open `/`. The example sits beside the heading `Learning tailored to every child.`

## Driving it with control-everprimer

Preconditions:

- Doctor reports the landing page on port 4173.
- The star control reads `0 stars`.

- **Open the landing page.** Visit `/`. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser goto /`. The heading `Learning tailored to every child.` is visible, the `Dinosaurs` button is pressed, and a control is labeled `0 stars`.
- **Switch interest.** Choose `Football`. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser click --role button --name "Football"`. The story contains `Two teams share one pitch.`
- **Answer.** Choose `Two equal parts`. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser click --role button --name "Two equal parts"`. The page says `Yes! Two equal parts.` and a control is labeled `1 stars`.
- **Proof of the answer.** Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser assert --text "Yes! Two equal parts."` and `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser assert --aria-label "1 stars"`. Then run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser snapshot --path .cursor/skills/verify-everprimer/artifacts/example-lesson/after.aria.txt` and `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser screenshot --path .cursor/skills/verify-everprimer/artifacts/example-lesson/after.png`.
- **Reload.** Visit `/` again. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser goto /` and `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser assert --aria-label "0 stars"`. The star was not stored. Run `node .cursor/skills/verify-everprimer/scripts/control-everprimer.mjs browser snapshot --path .cursor/skills/verify-everprimer/artifacts/example-lesson/reloaded.aria.txt`.

## Gotchas

- `Start free` appears twice, in the hero and the footer. Do not click it by that name.
- The interest buttons include an emoji. Match `Football` or `Dinosaurs` as a substring of the accessible name.
- The star control is labeled `0 stars` and `1 stars`, including the plural on one star.
- A wrong cut (`Two different parts`, `Three parts`) does not add a star. The proof path uses `Two equal parts`.
- This demo writes nothing. Do not treat a star as a row in `credit_ledger` or `topic_progress`.
