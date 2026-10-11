# AI Learning App — Rules

## 1. Product Purpose

Build an AI-powered learning application for children where parents define what their child should learn, and the application turns that goal into an interactive learning curriculum.

The core experience is:

1. A parent describes a learning goal in natural language.
2. The AI converts the goal into a structured curriculum/index, similar to the table of contents of a book.
3. Each curriculum topic can be opened by the child.
4. Opening a topic generates or loads a unique interactive learning artifact.
5. The artifact is a small web application designed specifically for that topic.
6. The artifact teaches the concept through multiple interactive learning methods.
7. The child's activity and learning progress are recorded.
8. Parents receive a useful daily progress summary.
9. Parents can provide additional context that personalizes future learning without needing to write technical prompts.

The application should feel like an intelligent, interactive learning environment rather than a chatbot with educational text.

---

## 2. Primary Users

### 2.1 Parent

Parents should be able to:

- Create a learning goal.
- Describe what they want their child to learn.
- Provide the child's interests and preferences.
- Ask the AI to adapt a topic to those interests.
- View the curriculum/index.
- Monitor progress.
- Review quiz results and learning activity.
- Receive daily progress summaries.
- Modify or extend the curriculum.

Parents should not need to understand AI prompting.

### 2.2 Child

Children should be able to:

- Open their assigned curriculum.
- Navigate topics independently.
- Learn through interactive artifacts.
- Watch or interact with animations.
- Answer questions and quizzes.
- Explore interactive models.
- Practice concepts.
- Receive immediate, age-appropriate feedback.
- See their own progress in a motivating but non-pressuring way.

The child experience should prioritize curiosity, interaction, clarity, and learning over gamification.

---

# 3. Parent Input Model

Parents should be able to provide two primary types of information.

## 3.1 Learning Goal

The parent can describe what they want the child to learn.

Example:

> "I want my child to learn about the solar system and all the planets."

The AI should transform this into a structured curriculum rather than immediately generating one large lesson.

Example structure:

```text
Solar System
├── 1. What Is the Solar System?
├── 2. The Sun
├── 3. Mercury
├── 4. Venus
├── 5. Earth
├── 6. Mars
├── 7. Jupiter
├── 8. Saturn
├── 9. Uranus
├── 10. Neptune
├── 11. Moons
├── 12. Asteroids and Comets
├── 13. Dwarf Planets
└── 14. Solar System Review
```

The AI may change the structure based on the child's age, prior knowledge, learning progress, and parent instructions.

## 3.2 Child Interests / Personalization Context

Parents may provide information such as:

> "My child likes Naruto."

or:

> "My child loves Adventure Time."

or:

> "My child likes dinosaurs and drawing."

This information should be treated as personalization context.

It should influence examples, analogies, visual themes, story framing, and motivation where appropriate.

It should NOT automatically turn every lesson into fan fiction or require copyrighted characters to be reproduced.

Use interests primarily as a teaching bridge.

Example:

Instead of:

> "Jupiter is big."

Use an appropriate analogy connected to the child's interest:

> "Imagine Jupiter as the giant character of the solar system. It is much larger than Earth."

The educational concept must remain the priority.

---

# 4. Curriculum / Index Generation

The curriculum is the central learning structure.

When a parent creates a learning goal, the AI should generate:

- A curriculum title.
- A short description.
- Ordered topics.
- Topic descriptions.
- Recommended learning sequence.
- Optional prerequisite relationships.
- Estimated difficulty.
- Learning objectives for each topic.
- Progress state for each topic.

Each topic should have a stable identifier.

Example:

```json
{
  "id": "solar-system-jupiter",
  "title": "Jupiter",
  "description": "Learn why Jupiter is the largest planet and explore its atmosphere, moons, and Great Red Spot.",
  "order": 7,
  "status": "not_started",
  "learning_objectives": [
    "Identify Jupiter as a gas giant",
    "Explain why Jupiter is much larger than Earth",
    "Recognize the Great Red Spot",
    "Understand that Jupiter has many moons"
  ]
}
```

The curriculum should not be regenerated unnecessarily after a child has started learning.

If the curriculum changes, preserve historical progress.

---

# 5. Learning Artifact

Every topic should have an interactive learning artifact.

An artifact is a self-contained web experience generated specifically for one learning topic.

It may contain:

- Explanations.
- Illustrations.
- Interactive diagrams.
- Animations.
- Simulations.
- Multiple-choice questions.
- True/false questions.
- Matching exercises.
- Ordering exercises.
- Fill-in-the-blank exercises.
- Drag-and-drop activities.
- Short-answer questions.
- Mini-games when educationally useful.
- Knowledge checks.
- Review sections.
- Summary sections.
- Accessibility features.

The artifact should never be a generic webpage containing only paragraphs of text.

---

# 6. Artifact Generation Rules

When generating an artifact, the AI must optimize for learning rather than visual novelty.

Every artifact should answer:

1. What should the child understand after completing this artifact?
2. What should the child be able to do?
3. How will the child interact with the concept?
4. How will the system determine whether the child understood it?
5. What should happen if the child struggles?
6. What should be recorded as progress?

Each artifact should have explicit learning objectives.

Example:

```text
Topic: Earth's Rotation

Learning objectives:
- Explain that Earth rotates around its axis.
- Understand that one rotation takes approximately 24 hours.
- Connect rotation to day and night.
```

---

# 7. Seven-Stage Learning Framework

The application should support a seven-stage learning progression.

The exact pedagogical framework can be configured independently, but every artifact should attempt to move the child through these stages when appropriate:

### Level 1 — Discover

Introduce the concept and create curiosity.

Use:

- Visual introductions.
- Simple questions.
- Interesting facts.
- Interactive exploration.
- Short animations.

### Level 2 — Understand

Explain the concept using age-appropriate language.

Use:

- Diagrams.
- Narratives.
- Examples.
- Analogies.
- Step-by-step explanations.

### Level 3 — Recognize

Help the child identify important concepts, objects, relationships, or vocabulary.

Use:

- Interactive exploration.
- Identification activities.
- Image-based questions.
- Matching exercises.

### Level 4 — Practice

Give the child opportunities to apply the concept with guidance.

Use:

- Interactive exercises.
- Drag-and-drop activities.
- Ordering activities.
- Guided simulations.
- Repeated practice.

### Level 5 — Apply

Ask the child to use the concept in a new situation.

Use:

- Scenario-based questions.
- Problem-solving.
- Mini simulations.
- Real-world examples.
- Interactive challenges.

### Level 6 — Explain

Ask the child to demonstrate understanding in their own words or actions.

Use:

- Short-answer questions.
- Explain-the-concept prompts.
- Teach-back activities.
- Prediction questions.

### Level 7 — Master / Create

Require the child to combine knowledge, reason independently, or create something.

Use:

- Open-ended challenges.
- Projects.
- Experiments.
- Design activities.
- Creative explanations.
- Multi-step problems.

Not every topic needs all seven levels. The artifact generator should select the appropriate stages based on age, topic complexity, and learning objective.

---

# 8. Required Artifact Components

The artifact generator should normally include a combination of the following components.

There is no fixed lesson order. A planner first decides, per learning objective, what the child
should be able to do (identify, explain, explain a process, compare, sequence, predict, apply) and
then picks the sections and their order that teach it best. Two lessons on the same curriculum may
look different. The written plan is linted before any content is generated, and the blueprint must
follow the plan section by section. The components below are the building blocks the planner
chooses from.

## 8.1 Introduction

Start with a short, engaging introduction.

Avoid unnecessarily long text.

## 8.2 Visual Explanation

Prefer visual explanations when the subject can be represented visually.

Examples:

- Diagrams.
- Timelines.
- Maps.
- Interactive models.
- Layered illustrations.
- Animated processes.

## 8.3 Interactive Animation

Use animation when movement communicates the concept.

Good examples:

- Planetary orbits.
- Water cycles.
- Fractions changing size.
- Chemical reactions.
- Historical timelines.
- Mechanical systems.

Animations should be purposeful.

Do not add animation merely because the application can generate it.

## 8.4 Interactive Exploration

Use a tap-to-discover model, animation, or simulation as the main way the child learns.

The visual should do the teaching. Short captions appear when the child taps a part.

Do not use flashcards or vocabulary decks.

## 8.5 Practice

Include interactive practice appropriate to the topic.

Possible formats:

- Multiple choice.
- True/false.
- Matching.
- Ordering.
- Drag and drop.
- Fill in the blank.
- Classification.
- Prediction.
- Short answer.

## 8.6 Quiz

Include a knowledge check when appropriate.

Questions should test the learning objectives rather than obscure facts.

Questions should vary in difficulty.

Avoid creating quizzes where the answer can be guessed from obvious wording.

## 8.7 Feedback

Feedback should explain why an answer is correct or incorrect.

Bad:

> "Wrong."

Better:

> "Not quite. Earth takes about 24 hours to complete one rotation. That rotation is what gives us day and night."

Feedback should teach, not punish.

## 8.8 Lesson shape rules

These replace the old fixed order (introduction, visual, review, quiz). They are enforced by lint.

- **Intent decides the representation.** Every objective needs at least one teaching bite. An
  objective to explain or explain a process needs both a representation (an exploration or an
  explanation with a visual) and an explanation; a quiz alone never satisfies it. An apply
  objective, or any objective planned at transfer depth, needs an apply bite before the final
  test. Deep-mastery goals need at least one transfer-depth objective; quick overviews do not go
  deeper than they need to.
- **Every visual has a purpose.** Each diagram or interactive must state what it shows the child,
  not decorate the page.
- **Every claim cites a fact.** The blueprint lists the facts the lesson relies on. Each bite and
  question points to the facts it uses, so the fact-check reviews a closed list. The child's
  interest (for example dinosaurs) may frame an example but never changes a correct answer.
- **Age limits are hard limits.** Content is written for ages 4 to 18. The planner may make a
  lesson shorter, never longer:

  | Age | Sessions | Min bites | Words per bite | Final-test questions |
  | --- | --- | --- | --- | --- |
  | 4-6 | 3 | 21 | 25 | 5 |
  | 7-9 | 4 | 24 | 45 | 8 |
  | 10-12 | 4 | 24 | 60 | 10 |
  | 13-18 | 5 | 25 | 80 | 12 |

- **Too big means split.** If a topic needs more concept clusters than the age allows, the planner
  turns it into a unit of smaller lessons instead of cramming. The parts appear under the original
  topic, and the credit for the planning step is refunded. A part is never split again.
- **Voice.** Every line talks to the learner. No instructions, no "in this lesson", no labels like
  Objective. The built-in player renders the lesson; there is no AI-written HTML and no generated
  images.

## 8.9 Spaced recall

Objectives that were not clearly learned in earlier lessons come back. Each new lesson can include
up to two recall questions on earlier objectives that are still unknown or developing, oldest
first. Recall questions count toward mastery of the earlier objective, not the current lesson.

## 8.10 Final check and feedback

Every lesson ends with a final check quiz that assesses every objective in the lesson.

The end screen tells the child, per objective, what is strong and what to practise, and that the
things to practise will come back in later lessons. The grown-up sees the same summary on the
curriculum page and in the daily report, with the list of objectives that will come back as recall
questions. Learner memory is updated after each lesson.

---

# 9. Adaptive Learning

The application should use learning data to adapt future experiences.

Useful signals include:

- Correct answers.
- Incorrect answers.
- Number of attempts.
- Time spent.
- Questions skipped.
- Hint usage.
- Completed activities.
- Repeated mistakes.
- Topic completion.
- Review performance.

Do not treat time spent alone as proof of learning.

A child spending ten minutes on a topic may have learned more, less, or nothing compared with another child.

Progress should be based on multiple signals.

---

# 10. Spaced Review

The application should be able to revisit concepts that appear to be forgotten or insufficiently learned.

Possible review mechanisms:

- Short quizzes.
- Previously incorrect questions.
- Interleaved practice.
- Quick daily review.

Do not force repetitive review when the child is already demonstrating mastery.

---

# 11. Personalization

Personalization should modify the teaching approach while preserving the learning objective.

The AI may personalize:

- Examples.
- Analogies.
- Story context.
- Visual themes.
- Questions.
- Scenarios.
- Difficulty.
- Vocabulary complexity.
- Activity types.

Example:

Parent input:

> "My child likes Naruto."

Learning topic:

> Fractions.

Possible personalization:

> Use a fictional ninja-themed mission where the child must divide supplies into equal groups.

The system should avoid requiring copyrighted characters, logos, dialogue, or other protected content when a generic themed analogy can achieve the same educational purpose.

---

# 12. Age and Reading Level

The artifact must be appropriate for the child's age and reading ability when that information is available.

Adjust:

- Vocabulary.
- Sentence length.
- Explanation complexity.
- Number of steps.
- Visual density.
- Question difficulty.
- Amount of text.
- Interaction complexity.

For younger children, favor:

- Visuals.
- Audio where supported.
- Short explanations.
- Simple interactions.
- Immediate feedback.

For older children, increase:

- Reasoning.
- Open-ended questions.
- Multi-step problems.
- Independent exploration.
- Research-style activities.

---

# 13. Child Safety

The child experience must be safe by default.

The system must:

- Avoid inappropriate content.
- Avoid sexual content.
- Avoid graphic violence.
- Avoid dangerous instructions.
- Avoid encouraging risky real-world behavior.
- Avoid collecting unnecessary personal information.
- Avoid asking children for sensitive information.
- Avoid manipulative engagement tactics.
- Avoid shame-based feedback.
- Avoid creating emotional dependency on the AI.

The AI should not present itself as the child's parent, best friend, therapist, or secret confidant.

---

# 14. Privacy and Data Minimization

Only collect data required to provide the learning experience.

Child progress should be associated with an internal child/profile identifier rather than exposing unnecessary personal information.

Avoid storing raw conversations when structured information is sufficient.

Parent-facing reports should focus on learning activity and progress rather than unnecessary behavioral surveillance.

---

# 15. Parent Daily Report

At the end of each day, generate a concise parent report.

The report should include:

- Topics accessed.
- Topics completed.
- Time spent learning.
- Quiz performance.
- Areas demonstrated successfully.
- Areas where the child struggled.
- Activities completed.
- Recommended review topics.
- Suggested next steps.

Example:

```text
Today's Learning

Solar System
✓ Completed: The Sun
✓ Completed: Mercury
→ Needs review: Venus

Quiz performance:
The child answered 8 of 10 questions correctly.

Observed strength:
The child correctly identified the planets in order.

Suggested next step:
Review Venus briefly before continuing to Earth.
```

Do not make unsupported psychological or behavioral conclusions from learning activity.

---

# 16. Parent Questions and Requests

Parents should be able to ask natural-language questions about their child's learning.

Examples:

> "How is my child doing with fractions?"

> "What should we review this weekend?"

> "My child is struggling with multiplication. Can you create more practice?"

> "Can you explain today's lesson to me?"

> "My child likes Adventure Time. Can you make the next lesson more engaging using that kind of fantasy adventure theme?"

The AI should answer using available learning data and clearly distinguish observed data from recommendations.

---

# 17. Artifact State and Progress Persistence

Artifacts should not be treated as disposable pages.

The system should persist:

- Artifact ID.
- Curriculum ID.
- Topic ID.
- Version.
- Learning objectives.
- Activities completed.
- Answers.
- Attempts.
- Scores.
- Mastery estimates.
- Last activity timestamp.
- Review status.

If an artifact is regenerated, preserve the child's historical progress.

---

# 18. Artifact Versioning

Every generated artifact should have a version.

Example:

```text
artifact_id: artifact-jupiter-v1
topic_id: solar-system-jupiter
version: 1
```

If the artifact is updated:

```text
artifact_id: artifact-jupiter-v2
topic_id: solar-system-jupiter
version: 2
```

The system should retain enough metadata to understand which version produced historical learning results.

---

# 19. AI Generation Prompt Requirements

Every artifact-generation prompt should instruct the model to:

- Identify the learning objectives.
- Identify the child's age/level when available.
- Identify relevant parent personalization context.
- Choose appropriate learning stages.
- Explain concepts clearly.
- Use multiple modalities.
- Include meaningful interaction.
- Include active recall.
- Include practice.
- Include feedback.
- Include a knowledge check.
- Track measurable learning events.
- Avoid unnecessary text.
- Avoid decorative interaction with no educational purpose.
- Avoid unsupported factual claims.
- Make the artifact responsive.
- Make the artifact accessible.
- Handle incorrect answers constructively.
- Adapt difficulty where appropriate.
- Produce a coherent beginning, middle, and end.

---

# 20. Suggested Artifact Generation Prompt Structure

Use a structured prompt rather than one large unstructured instruction.

```text
ROLE:
You are an expert educational experience designer and frontend engineer.

TASK:
Create an interactive learning artifact for the specified topic.

CONTEXT:
- Topic:
- Curriculum:
- Learning objectives:
- Child age:
- Reading level:
- Prior knowledge:
- Parent personalization:
- Previous performance:

LEARNING REQUIREMENTS:
- Select appropriate stages from the seven-stage learning framework.
- Introduce the concept in one or two sentences.
- Teach through visual or interactive exploration (animation, tap-to-discover, simulation).
- Recap in a few short bullets.
- End with a quiz covering every learning objective.
- Provide application-style questions in the quiz when appropriate.
- Provide corrective feedback that teaches.

INTERACTION REQUIREMENTS:
Use appropriate combinations of:
- Animations
- Interactive diagrams
- Simulations
- Tap-to-discover models
- Multiple-choice questions
- True/false questions
- Matching
- Ordering
- Drag and drop
- Fill in the blank
- Short answer
- Scenario-based questions
- Mini challenges
- Creative tasks

Do not include every interaction type automatically.
Choose only interactions that improve learning.

PERSONALIZATION:
Use the parent-provided interests to make examples and scenarios more engaging while keeping the educational objective unchanged.

TECHNICAL REQUIREMENTS:
- Responsive web experience.
- Mobile-first.
- Accessible controls.
- Clear navigation.
- Fast loading.
- No unnecessary dependencies.
- Deterministic learning events where possible.
- Track completion and assessment events.
- Keep the artifact self-contained where practical.

OUTPUT:
Return the complete artifact implementation plus a structured description of:
- Learning objectives
- Learning stages used
- Activities
- Assessment strategy
- Progress events
- Mastery signals
```

---

# 21. Progress Event Model

Artifacts should emit structured events rather than relying only on page-level analytics.

Example:

```json
{
  "event": "quiz_answered",
  "topic_id": "solar-system-jupiter",
  "activity_id": "jupiter-quiz-01",
  "question_id": "q03",
  "correct": true,
  "attempt": 1,
  "timestamp": "..."
}
```

Possible events:

```text
topic_opened
lesson_started
section_viewed
animation_started
animation_completed
item_explored
activity_started
activity_completed
question_answered
hint_requested
answer_revealed
quiz_started
quiz_completed
topic_completed
review_completed
```

Events should be designed around educationally meaningful actions.

---

# 22. Mastery

Mastery should not be represented solely by a single quiz score.

Consider:

- Accuracy.
- Repeated performance.
- Difficulty.
- Independent answers.
- Hint usage.
- Performance across different activity types.
- Performance after a delay.
- Ability to apply the concept in a new context.

A child who answers ten memorized questions correctly should not automatically be considered a master of the underlying concept.

---

# 23. Gamification

Gamification is optional.

Use it only when it supports learning.

Potential mechanisms:

- Progress indicators.
- Completion milestones.
- Unlockable topics.
- Exploration maps.
- Badges for meaningful achievements.
- Encouraging messages.

Avoid:

- Infinite scrolling.
- Manipulative streaks.
- Punishing missed days.
- Excessive rewards.
- Competitive leaderboards for young children.
- Reward systems that distract from learning.

---

# 24. Accessibility

Artifacts should support accessible learning wherever possible.

Requirements include:

- Readable typography.
- Sufficient contrast.
- Keyboard accessibility where relevant.
- Clear focus states.
- Descriptive labels.
- Avoid relying only on color.
- Captions/transcripts where applicable.
- Reduced-motion support.
- Touch-friendly controls.
- Simple navigation.

---

# 25. Visual Design

The visual design should be:

- Child-friendly.
- Modern.
- Clean.
- Engaging.
- Spacious.
- Highly visual when appropriate.
- Consistent across artifacts.

Avoid making every artifact look identical.

The artifact should have its own visual identity based on the topic while remaining part of the same application.

---

# 26. Technical Architecture Principles

Keep the system modular.

Recommended conceptual components:

```text
Parent Input
     ↓
Curriculum Generator
     ↓
Curriculum / Index
     ↓
Topic Selection
     ↓
Artifact Generator
     ↓
Interactive Artifact
     ↓
Learning Events
     ↓
Progress / Mastery Engine
     ↓
Parent Daily Report
```

Separate:

- Curriculum generation.
- Artifact generation.
- Artifact rendering.
- Learning-event collection.
- Progress calculation.
- Parent reporting.

Do not make the UI responsible for calculating long-term learning progress.

---

# 27. Reliability

AI-generated learning content must be checked for:

- Factual accuracy.
- Age appropriateness.
- Internal consistency.
- Correct answers.
- Correct explanations.
- Broken interactions.
- Missing learning objectives.
- Unsafe content.

Generated quizzes must have validated answer keys.

An artifact must never confidently teach a false fact because the language model generated it.

---

# 28. Failure Handling

If artifact generation fails:

- Preserve the curriculum.
- Show a useful fallback state.
- Allow regeneration.
- Do not erase previous progress.
- Record generation failures for debugging.

If an animation cannot be generated:

- Replace it with a static visual or interactive diagram.

If a complex interaction fails:

- Provide a simpler equivalent activity.

Learning should continue even when an individual component fails.

---

# 29. Core Product Principle

The application should not optimize for:

> "How impressive can we make the AI-generated webpage?"

It should optimize for:

> "How effectively can this child understand, practice, apply, and retain this concept?"

Every generated component should justify its existence by contributing to that goal.

---

# 30. Definition of Done for a Learning Artifact

An artifact is ready when:

- The learning objectives are explicit.
- The content is age appropriate.
- The concept is explained clearly.
- At least one meaningful interaction is included.
- The child actively recalls or applies the concept.
- Corrective feedback is provided.
- A knowledge check is included when appropriate.
- Progress events can be recorded.
- The artifact works on mobile.
- The artifact is accessible.
- The content is factually checked.
- The artifact does not contain unnecessary complexity.
- The child can understand what to do next.

