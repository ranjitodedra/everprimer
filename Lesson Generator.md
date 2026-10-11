# Add scope to the curriculum/input model

The current system has no scope field. Add one at the appropriate curriculum/request level, using the existing project conventions.

Use an enum or equivalent constrained value such as:

type LearningScope =
  | "overview"
  | "hobby"
  | "exam"
  | "mastery";

Do not hard-code page counts from these values.

Scope controls:

overview → broad coverage, shallow depth
hobby    → useful breadth + interesting exploration
exam     → required coverage + enough practice to demonstrate objectives
mastery  → deeper concept decomposition + explanation/transfer/practice

Scope therefore affects BOTH:

breadth of the index
depth inside an individual topic

But scope must not directly mean "generate N pages".

Next

# This is a big improvement in lesson generation from what it is right now. You are modifying the existing Everprimer codebase. Do not just explain what should be changed. Inspect the repository, identify the current types, prompts, pipeline, lint, validators, and tests, then implement the changes below.

The goal is to replace the current fixed lesson structure:

intro → explore → optional explain → review → quiz

- currently we talking take the topic but we also need to take two other things for that lesson it self. that is scope and current interests. so we remove this "Interests and notes
Used as teaching bridges: analogies, scenarios and themes. The learning goal never changes.

Nothing yet. Try “dinosaurs” or “loves drawing”.

Likes
dinosaurs, drawing…
". outcome : on "http://localhost:3000/parent/children/xyz..." page we will have a button call "what to learn?" or "Add topic of learning" something like this not exactly, then onces cliked it will pop up form containing three fields a - "New learning goal
Write it the way you would say it. No prompting skills needed.

I want my child to learn about the solar system and all the planets.

5 to 14 lessons, from familiar to new." b - "scope: like why are they learning this topics? what are they expecting know at the end something like that put in place holder so parent can understand", c - "interest- at the time of learning this lesson what exactly kid is interested in cats, nijas, rockets ??"

after taking those three thins we start creating lesson which goes as follows.

##  we do keep blueprints generation step but there is change.

Goal + scope + interest + memory (consider previous learning)+ current age (based dob)
    ↓
Blueprint/content generation

- now the blue print can depends heavly on scope as it will tell us how deep the topis need to be covered.
- rarely there will be a topics where we will need sub-blueprint per topic if the main given topic is huge or complex 
(bluepeint 
    |_ topic 1 
    |   |_topic 1
    |   |_topic 2
    |   |_...
    |_ topic 2
    |...
    |_last topic. 
    
    ) <-- rare, AI needs to decide based on topic and scope and other things.
. but noramlly it would be just blue print then lessones. 

## now next validation 

Goal + scope + interest + memory (consider previous learning)+current age
    ↓
Blueprint/content generation
    ↓
---
Lesson planner 
    ↓ 
LessonPlan validation
     ↓ 
Blueprint/content generation 
    ↓ 
Blueprint validation 
    ↓
Fact/safety validation
---
this about part inside "---" something you should decide.

- basically, stuff to make sure the content is appropriate based on the age.

and 
### Lesson planner
Chooses:
- whether this topic fits in one lesson
- whether the topic should become a sub-index
- concept clusters
- which existing section types to use
- sequence of sections
- which visual kind to use
- which question kind to use
- which objectives each section/question addresses
- whether review/apply are useful
- how much depth is appropriate
- how the learner's misconceptions and reading level affect the plan

### Fact-check

Checks the completed blueprint for:

factual correctness
answer-key correctness
safety
objective alignment
unsupported factual claims


## Code generation - The most important. conde generation per topic.

- here we need to make change as the lessons are in fixed formate. Instead I want AI to pick from following (look below word possibleFormates) each time while considering Goal + scope + interest + memory (consider previous learning from last lesson from same topic)+ current age (based dob). 

let say if last lesson was about topic a
now when I click on generate for topic b it should add some things from that previous lesson may be one question that I got wrong or something just I need to recall.
so we are not considering everything at the time of creation of blueprint only but also at the point where each lesson is generated.

possibleFormates
=> teach them
- page with point wise info
- interactive artifact about the lesson
- detailed image that could help
- give acroname
- use analogy from their interest (make connection from what they already know)
- explain like 5 but also add real definations

=> check if they learned
- mcq
- fill the black (black options are given)
- one word question where we can simply check by if exactly typed
- match right and left
- true of false
- rank


## Preserve the blueprint as the source of truth

Do NOT move grading logic into generated HTML.

The blueprint remains authoritative.

The HTML must be a rendering of the blueprint.

The server must continue to grade questions from structured blueprint data rather than trusting the page.

Also, do NOT treat factual content as "free generation".

Wording, theme, analogy, presentation, and layout can be generated.

Facts, definitions, relationships, answer keys, and questions must remain constrained by the blueprint/source-of-truth and validated before publication.


7. Give the AI a "toolbox"

This is probably the biggest architectural decision I'd make for your app.

Don't allow the AI to invent arbitrary UI.

Give it 20–30 high-quality learning primitives.

For example:

Present
Text
Image
Diagram
Timeline
Comparison
WorkedExample
Story
Animation
Explore
InteractiveDiagram
Simulation
ManipulatableObject
Slider
BeforeAfter
Practice
MCQ
MultiSelect
Matching
Sorting
FillBlank
ShortAnswer
Prediction
Classification
Reflect
ExplainInYourOwnWords
ConfidenceCheck
Reflection
Summary

Then AI chooses among them.

This gives you:

AI creativity + product consistenc


6. Objective-driven section selection

The planner must classify each objective by what the child actually needs to do.

At minimum support these intent categories:

identify/name
explain
explain_process
compare
sequence
predict
apply

You may reuse an existing objective classification type if one already exists.

Use these planning rules:

Identify/name

Prefer:

explore or explain → quiz

Optional:

review

Avoid requiring apply unless it adds genuine value.

Explain/process

Normally require:

explore or visual representation
+
explain
+
graded assessment

Optional:

review
apply

Do not allow a quiz-only lesson to satisfy a genuine explanation/process objective.

Compare

Prefer:

explore using comparison → quiz

Optional:

explain
apply
Sequence

Prefer:

explore using sequence/timeline → ordering assessment

Optional:

explain
review
Predict

Prefer:

explore using simulation/orbit/sequence/etc.
→ quiz or apply
Apply/use in a new situation

Require:

teaching/explanation
+
apply
+
graded assessment

Recognition-only questions are insufficient for an objective whose actual requirement is transfer/application.

7. Visual selection

The planner chooses the visual kind based on the concept, not randomly.

Use:

orbit       → orbital/cyclical relationships and celestial motion
comparison → magnitude/attributes/side-by-side differences
simulation  → changing variables, cause/effect, dynamic systems
parts       → whole and components
sequence    → ordered processes
timeline    → historical/temporal progression

A visual must have a declared instructional purpose.

For example:

{
  "type": "explore",
  "visualKind": "simulation",
  "purpose": "show_that_earth_rotation_changes_which_side_faces_the_sun"
}

Do not allow the planner to add visual elements merely because they look engaging.

8. Age-band constraints

Implement hard application-level constraints, not just prompt wording.

Use these age bands:

4–6
7–9
10–12
13+

Start with configurable limits approximately like:

4–6:
  max sections = 6
  max graded questions = 4

7–9:
  max sections = 8
  max graded questions = 8

10–12:
  max sections = 8
  max graded questions = 8

13+:
  max sections = 9
  max graded questions = 8

If the project already has equivalent reading/text limits, reuse them rather than creating duplicate systems.

Otherwise add configurable text budgets approximately:

4–6:   80 words/page, 30 words/text block
7–9:  180 words/page, 70 words/text block
10–12: 300 words/page, 110 words/text block
13+:  450 words/page, 160 words/text block

These must be validated server-side.

The planner may choose a shorter lesson.

The planner may NOT exceed the limits.

9. Concept-cluster splitting / sub-index

The planner must be able to return:

{
  "mode": "sub_index",
  "splitReason": "...",
  "conceptClusters": [...]
}

A topic should split when the required conceptual load cannot reasonably fit in one lesson.

Use configurable starting limits:

4–6:   max 2–3 concept clusters/page
7–9:   max 3 concept clusters/page
10–12: max 4 concept clusters/page
13+:   max 5 concept clusters/page

Do NOT split merely because there are many learning objectives.

Split when the objectives represent distinct coherent concept clusters and the resulting one-page lesson would exceed the lesson contract.

The split decision must include:

reason
child concept clusters
objective IDs assigned to each cluster
proposed child lesson titles

Example:

Electricity
  → What is a circuit?
  → How current moves
  → Voltage and resistance
  → Series and parallel circuits
  → Predicting circuit behavior

Do not silently consume additional lesson credits.

Because one published lesson = one credit, the structural planning stage must happen BEFORE credit-consuming child lesson generation.

If the existing product has no mechanism for automatic extra-credit generation, return the split proposal to the caller/UI rather than generating extra pages automatically.

10. Hard rules vs planner choices

Encode these distinctions explicitly.

HARD RULES

The model must not override:

safety
age band
reading level/text limits
available section types
available visual types
available question types
maximum sections
maximum graded questions
maximum concept clusters
blueprint schema
objective IDs
prerequisite validity
question gradeability
answer-key structure
factual-source restrictions
every objective must have graded assessment coverage
sandbox/no-network/no-external-image constraints
one page = one credit
interests cannot change facts or answers

The application/lint should reject the lesson when any of these fail.

PLANNER CHOICE

The planner decides:

single lesson vs sub-index
concept clusters
section selection
section order
visual kind
number of visuals
question kind
placement of review
placement of assessment
whether apply is useful/required
whether explore is necessary
depth appropriate to the requested scope
which misconception should receive extra practice
FREE GENERATION

The content generator may freely determine:

child-friendly wording
sentence phrasing
presentation wording
theme
analogy
visual styling
examples that are already supported by blueprint facts
animation/layout details within the registered component schema

Do NOT classify factual correctness as free generation.

11. Learner personalization

The planner should receive the same learner context currently supplied by learnerBlock.

However, preserve the current privacy boundary:

the child's name must remain excluded
learner interests are for framing only
parent notes are planning context, not factual source material
strengths should prevent unnecessary reteaching
misconceptions should influence example/assessment emphasis
previous performance should influence what deserves more practice
interests must never change the underlying facts or answers

The planner should output only the personalization decisions needed downstream, for example:

{
  "learnerConstraints": {
    "ageBand": "7-9",
    "readingLevel": "...",
    "textBudget": 180,
    "misconceptionIds": ["m2"],
    "framingInterest": "dinosaurs"
  }
}

The later blueprint/factcheck/codegen passes should not need raw parent personalization rows or unrelated learner details.

12. Change the prompts
Replace the current fixed lesson-shape instructions

Remove instructions that force:

intro first
one explore
optional explain
review before quiz
quiz last
skip explain unless another visual is needed

These are exactly what causes every lesson to become:

artifact → text → MCQ

The new planner prompt should explicitly say:

There is no universal lesson sequence.

Select the smallest coherent sequence of learning experiences that satisfies the objectives at the requested scope and learner level.

Do not include a block merely because it exists.

Do not omit a block when the objective requires it.

Assessment placement is a planning decision, not a fixed position.
13. Add a dedicated planner prompt

Create lessonPlanPrompt in the same prompt module as the existing prompts.

It should:

receive curriculum context
receive topic and objectives
receive scope
receive learner context
receive previous performance
determine concept clusters
determine objective intent
determine single lesson vs sub-index
choose sections
choose visual kinds
choose question kinds
map objectives to sections/questions
produce ONLY structured LessonPlan JSON

The planner should NOT produce a polished lesson.

It should be short and structural.

14. Change the blueprint prompt

The existing blueprintPrompt should no longer invent the lesson structure.

It should receive the validated LessonPlan and implement it.

Its instruction should effectively be:

Implement this exact lesson plan.

Do not add sections.
Do not remove sections.
Do not reorder sections.
Do not change visual kinds.
Do not introduce new objectives.
Do not invent facts outside the source material.
Do not invent ungradeable question types.

You may write the actual child-facing wording and content inside the allowed structure.

Adapt to the current blueprint schema.

The blueprint should contain enough structured information for the code generator and grader to implement exactly what the planner chose.

15. Fact-check prompt

Keep a separate fact-check stage.

It should continue to see only the generated blueprint, not raw learner profile.

It must verify at least:

facts
definitions
relationships
answer keys
question correctness
question/objective alignment
safety
unsupported claims

If the fact-check fails on content, rerun blueprint generation with the repair problems.

Do NOT let fact-check silently redesign the lesson plan.

If the plan itself is invalid, rerun the planner.

16. Code generation prompt

The code generator should receive:

validated blueprint
fixed implementation instructions

It must treat the blueprint as immutable structure.

It can vary:

CSS layout
spacing
typography
animation details
visual presentation
transitions
child-friendly presentation

It cannot:

add facts
add questions
remove questions
change answer keys
add sections
remove sections
reorder sections
introduce external resources
introduce network access
call external APIs
use external images/fonts

The resulting HTML must remain compatible with the current sandboxed iframe.

17. Rewrite the lint rules

REMOVE these old rules:

intro must be first
exactly one explore
review must precede quiz
quiz must be last
explain is only allowed for a special visual case

ADD/KEEP these hard validations:

Structure
known section type
known visual type
known question type
required fields present
no unknown/hidden lesson behavior
Objective coverage

Every objective must have:

at least one teaching/representation block
+
at least one graded assessment
Gradeability

Every graded question must have:

question ID
objective ID
question kind
machine-readable answer/rubric
grading metadata required by the server

Reject any question the server cannot grade.

Be especially strict with short_answer. If the current grading system cannot reliably support arbitrary short-answer responses, reject or constrain that question type rather than allowing ungradeable content.

Age/readability

Reject text exceeding the age/reading budget.

Load

Reject:

too many sections
too many questions
too many concept clusters
Visual integrity

Every explore visual must declare a purpose.

Scope fidelity

Reject a lesson that is obviously under-depth for mastery/transfer objectives or unnecessarily deep for overview, using the planner's declared objective requirements.

Interest integrity

Reject any generated content where the interest changes the factual teaching target or answer.

Blueprint fidelity

Every factual claim/question must be traceable to the blueprint/source-of-truth.

18. Pipeline repair behavior

Refactor the existing retry logic into something approximately like:

generateLessonPlan()
  → schema/lint
  → retry planner if invalid

if mode === "sub_index":
  → return split proposal
  → do not generate HTML automatically unless credit flow explicitly permits it

generateBlueprint(plan)
  → schema/lint
  → retry blueprint if invalid

factcheck(blueprint)
  → if serious issue:
       regenerate blueprint with repair notes
  → if plan-level issue:
       regenerate LessonPlan
       then blueprint again

generateHTML(blueprint)
  → validate HTML
  → retry codegen if needed
  → fallback renderer if existing fallback is still applicable

Preserve the current retry counts where reasonable, but ensure retries do not allow the model to drift away from the LessonPlan.

A blueprint repair should not accidentally change the section sequence.

A codegen repair should not change the blueprint.

19. Index/curriculum generation changes

The curriculum is currently a flat list of 5–14 topics.

Keep the normal curriculum flat by default.

Add the concept that a topic can later become a unit with child topics.

Do NOT automatically make the whole curriculum deeply nested.

Use this rule:

Flat by default.

Create a sub-index only when a topic contains multiple coherent concept clusters
that exceed the one-lesson contract at the requested scope.

The curriculum planner should consider scope when deciding the breadth/depth of topics.

Do not split a topic simply to increase the number of lessons.

20. Add tests

Add or update tests for at least these cases.

Case 1

Age 8, dinosaurs, topic:
What is the solar system?
scope:
overview

Expected planner shape roughly:

intro
explore: orbit
explain
quiz

No required apply.

Case 2

Same child, topic:
Why do we have day and night?
scope:
master/understand deeply enough to explain using the closest supported scope enum.

Expected planner shape roughly:

intro
explore: simulation
explain
review
quiz
apply

The exact order may vary if the planner changes it, but the plan must contain the necessary instructional/assessment roles and remain within lint rules.

Case 3

Age 8, topic:
Electricity
scope:
mastery

Expected:

mode = sub_index

when the topic exceeds the configured concept-cluster/load limit.

Case 4

Planner attempts:

quiz only

for an explain_process objective.

Must fail lint.

Case 5

Planner omits an objective from assessment.

Must fail lint.

Case 6

Planner returns unknown visual:

"3d_globe"

Must fail schema/lint.

Case 7

Question has no answer key or grading metadata.

Must fail lint.

Case 8

Blueprint adds a factual claim not represented in its allowed source structure.

Must fail fact validation.

Case 9

Codegen adds a question not present in the blueprint.

Must fail HTML/blueprint consistency validation if that validator already exists; otherwise add the minimum necessary validation.

Case 10

A valid lesson uses a different ordering from the old template.

Must pass.

This test is important because the purpose of the refactor is explicitly to stop enforcing one universal lesson order.

21. Acceptance criteria

The implementation is complete when all of these are true:

The app no longer forces every lesson into intro → explore → review → quiz.
The planner can produce different valid sequences for different concepts.
The planner can choose zero or more of the optional sections as appropriate.
The planner can select different visual kinds per topic.
The planner can decide that a topic should become a sub-index.
Scope affects breadth and depth, not a fixed page count.
One published page still equals one credit.
No extra pages are silently generated.
Every objective is assessed.
Every graded question remains server-gradeable.
The blueprint remains the source of truth.
Codegen follows the blueprint instead of redesigning it.
Interests only affect framing/theme/analogy.
No external images/network/fonts are introduced.
Safety remains hard-coded and cannot be overridden by the model.
The existing HTML fallback continues to work.
Existing unrelated generation behavior continues to work.
Tests demonstrate that multiple different lesson structures can pass lint.
22. Important implementation instruction

Before changing code:

Search the repository for:
ArtifactBlueprint
blueprintPrompt
factcheckPrompt
codegenPrompt
generateBlueprint
generateArtifactHtml
current lesson lint/validation
curriculum/index generation
question grading contracts
scope/curriculum schemas if they already exist
Reuse existing types and validation infrastructure wherever possible.
Do not create duplicate schemas when an existing contract can be extended.
Do not merely modify prompt text and leave the old lint rules active. The code-level lint must change too.
Do not make the HTML generator responsible for pedagogical decisions.
Do not let the model choose facts that the server cannot validate.
Keep the change incremental and compatible with existing generated lessons where practical.

After implementation, run the relevant typecheck/tests/lint and report:

files changed
schema changes
prompt changes
pipeline changes
lint rules removed/added
tests added/updated
any migration or compatibility issue that remains

## few hard rules I want you to remember
- after each lesson memomy is updated
- in things that are not cleary leaned should covered in upcomming lesson like spaced repeatation
- at the end of each lesson there should be final quiz to jouje the learning and give feedback both kid and parent.
- for image gen I will be using nano banana or gpt newest version so implement accordinlgy.
- at the the give me guide to add image of cloude, image gen and other to make all of this work.