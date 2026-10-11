# Everprimer — Company Thesis & Product Strategy

## 1. Problem

* **Problem:** Learning from generic, static content is often inefficient because the material is not adapted to the learner's level, goals, misconceptions, or pace.
* **Current alternatives:** ChatGPT, YouTube, textbooks, websites, courses, educational apps.
* **Gap:** Existing solutions either provide information without structured learning or provide structured learning without sufficiently adaptive, interactive experiences.

## 2. Thesis

* **Core thesis:** An AI system that converts a learner's goal into an interactive, adaptive learning experience can make learning more effective and engaging than consuming generic static content.
* **Product hypothesis:** The strongest advantage will come from combining personalization, structured pedagogy, interactive artifacts, retrieval, feedback, and practical application rather than simply generating explanations with AI.
* **Business hypothesis:** Parents will pay for a product that reliably helps their children learn independently and make measurable progress.

## 3. Customer

### Buyer

* Parents of school-age children.

### User

* Children / teenagers who use Everprimer to learn.

### Initial customer

* Parents who are actively looking for better ways for their children to learn outside school.

### Primary motivation

* Help their child learn effectively, independently, and with less friction.
* Give their child access to personalized learning without requiring the parent to teach every topic themselves.

## 4. Core Product Promise

> Give a learner a goal and turn it into a personalized, interactive learning experience that helps them understand, practice, retrieve, and apply the knowledge.

## 5. Core Product Loop

```text
Learner Goal
     ↓
Personalized Lesson Plan
     ↓
Interactive Learning Experience
     ↓
Retrieval / Practice
     ↓
Application / Challenge
     ↓
Feedback
     ↓
Learner Model Update
     ↓
Next Learning Experience
```

The product should continuously improve what it teaches based on demonstrated understanding rather than simply generating another lesson.

## 6. Product Principles

* Personalization should change the learning experience, not merely change wording.
* Learning should require active thinking and retrieval.
* AI should operate within controlled instructional and factual constraints.
* Generated content should be evaluated before being presented.
* The product should optimize for learning outcomes, not time spent in the app.
* Interactivity should serve learning rather than exist as decoration.
* The learner should not need to know how to prompt AI.

## 7. MVP

### IN

* Account creation
* Learner profile
* Parent-defined learning goal
* Topic selection / concept input
* Structured AI lesson generation
* Interactive learning artifacts
* Explanations
* Retrieval / quiz activities
* Practical application
* Basic progress tracking
* Lesson completion tracking
* Basic analytics

### OUT

* Voice tutor
* Advanced paid tiers
* Complex multi-model routing
* Large social/community features
* Advanced parent dashboards
* Extensive gamification
* Anything that does not directly improve the core learning loop

## 8. AI Architecture

### MVP

* **LLM:** Gemini for every task. Paid plans differ only by lesson credits.
* **Lesson planning:** AI generates a session outline of short game-like bites.
* **Content generation:** Structured generation from the lesson plan and controlled facts.
* **Interactive artifact generation:** Built-in game player renders the blueprint.
* **Evaluation:** Automated fact checking and structural validation.
* **Learner model:** Store demonstrated performance and relevant learning state.

### Later

* Paid model tiers
* Voice tutor
* More sophisticated learner modeling
* Additional generation/evaluation models
* More advanced adaptive learning

## 9. North Star

Do not use **"active users"** as the North Star.

Use a metric closer to the actual value Everprimer is supposed to create.

### Proposed North Star Metric

**Weekly learners who successfully complete meaningful learning sessions and demonstrate retained understanding.**

Supporting metrics:

* Lesson start rate
* Lesson completion rate
* Retrieval performance
* Application-task success
* Return rate
* D7 / D30 retention
* Parent conversion rate
* Paid retention

The exact North Star can change once real user behavior gives us better evidence.

## 10. Telemetry

Track at minimum:

```text
signup
learner_created
goal_created
lesson_generated
lesson_started
section_completed
retrieval_attempted
retrieval_correct
challenge_started
challenge_completed
lesson_completed
learner_returned
subscription_started
subscription_cancelled
```

Also track:

* Time to first meaningful outcome
* Where learners drop off
* Generation failures
* Lesson regeneration
* Incorrect answers
* Repeated attempts
* Most-used topics
* Acquisition source

## 11. Competitive Position

Everprimer should not compete simply on:

> "AI can explain anything."

ChatGPT already does that.

The differentiation must come from:

* Structured learning
* Adaptive progression
* Interactive experiences
* Learning-state tracking
* Retrieval and application
* Controlled AI generation
* Parent-oriented outcomes

## 12. Go-To-Market Hypothesis

### Phase 1 — Private Alpha

Target approximately 10–20 real users.

Goal:

> Determine whether learners can independently obtain meaningful value from the product.

Do not optimize for scale yet.

### Phase 2 — Product Validation

Increase usage and measure:

* Activation
* Completion
* Retention
* Learning performance
* Parent satisfaction
* Willingness to pay

### Phase 3 — Public Launch

Once the product shows meaningful retention and repeat usage:

* Creator partnerships
* SEO/content
* X / LinkedIn / Reddit
* Launch video
* Email
* Communities
* Partnerships
* Public launch campaign

### Phase 4 — Growth

Identify the acquisition channel with the strongest economics and build a repeatable acquisition system around it.

## 13. Company Success Criteria

Everprimer is progressing when:

1. Strangers can use it without founder assistance.
2. Learners reach the promised outcome.
3. Learners return voluntarily.
4. Parents perceive enough value to pay.
5. Acquisition can be repeated through at least one reliable channel.
6. Revenue eventually exceeds the cost of serving the user.

## 14. Kill / Pivot Conditions

The company should reconsider the thesis if repeated real-world evidence shows that:

* Learners do not return after initial use.
* Parents do not perceive enough value to pay.
* Learning outcomes are not meaningfully better than common alternatives.
* AI generation quality cannot be made reliable enough at viable cost.
* Customer acquisition is consistently too expensive relative to customer value.

## 15. Founder Operating Rule

Every major piece of work must belong to one of these categories:

```text
PRODUCT
LEARNING OUTCOMES
AI / TECHNOLOGY
ANALYTICS
GROWTH
MONETIZATION
OPERATIONS
```

Before starting work, answer:

> What company problem does this solve?

If the answer is unclear, do not build it.
