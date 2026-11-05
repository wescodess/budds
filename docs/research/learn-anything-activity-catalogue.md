# Activity catalogue on shadcn-vue

Date: 2026-11-04
Status: Proposed design for review; nothing here is implemented
Parent: [learn-anything-deep-dive.md](./learn-anything-deep-dive.md)

## The model

Everything in the [shadcn-vue catalogue](https://shadcn-vue.com/docs/components) (72 components as of today) is available to the Void. Components play three different roles, and the distinction keeps generated content safe:

- **The model chooses from typed lesson blocks and activity schemas.** It fills bounded fields. It never names a component, writes markup or sets props directly.
- **The Vue renderer maps those schemas onto shadcn-vue components.** Swapping or upgrading a component never touches generated content.
- **Shell components are chosen by us, not the model.** Letting a model open dialogs or build navigation adds risk and teaches nothing.

Every generated element must also name the objective it serves. Decoration hurts learning ([Sundararajan & Adesope 2020](https://eric.ed.gov/?id=EJ1263249)), so "all components are available" doesn't mean all of them appear in a lesson.

## Activities: fixed schemas, graded on the server

Answer keys stay on the server and are never sent to the client.

| Activity | Components | Graded by | Good for |
| --- | --- | --- | --- |
| Single choice, with distractors built from misconceptions | Radio Group, Item, Field | Key | Concepts, diagnosing errors |
| Multiple choice | Checkbox, Item, Field | Set match | Classifying |
| Short diagnostic sequence, placement | Questionnaire | Per item | Adaptive placement, calibration |
| Cloze (fill the gap) | Input, Input Group, Typography | Accepted answers | Terms, syntax, language |
| Letter or digit recall | Pin Input, Input OTP | Exact | Spelling, formulas, language |
| Numeric answer | Number Field, Input Group | Tolerance | Maths, science, finance |
| Estimate on a scale | Slider | Range | Intuition, physics, statistics |
| Matching | Select or Native Select per row, Table | Pairs | Vocabulary, cause and effect |
| Pick from a long list | Combobox | Key | Taxonomy, anatomy, syntax |
| Tag all that apply | Tags Input, Toggle Group | Set match | Identifying features |
| True or false with reason | Switch or Toggle Group, Textarea | Key plus rubric | Catching misconceptions |
| Date or period | Calendar, Date Picker, Range Calendar | Tolerance | History, timelines |
| Written answer, teach-back | Textarea, Field, Form | Rubric | Transfer, explanation |
| Ordering (keyboard-first) | Item, Button Group | Sequence | Processes, proofs |
| Scenario branch | Stepper, Radio Group, Card | Path and rubric | Decisions, procedures |
| Code exercise | Code Block, Textarea | Tests or rubric | Programming |
| Confidence rating | Toggle Group | Not graded | Calibration |

## Lesson blocks: composable, not graded

These nest within a bounded tree, following the [A2UI](https://github.com/google/A2UI) idea of declarative JSON rendered by client-owned components.

| Block | Components | Good for |
| --- | --- | --- |
| Prose | Typography, Separator, Kbd | Explanations, shortcuts |
| Callouts | Alert, Badge | Warnings, key ideas, the source tier label |
| Step-by-step worked example | Stepper, Trace, Collapsible | Worked and faded examples, with steps hidden as support fades |
| Reasoning and citations | Trace, Hover Card, Popover | Showing the thinking, sources in place |
| Compare views | Tabs, Table, Resizable | Two representations, source comparisons |
| Self-check | Accordion, Collapsible | Answer reveal after an attempt |
| Data | Chart, Data Table | Distributions, trends, sortable reference |
| Code | Code Block | Examples, diffs (highlighted lines) |
| Sequence of slides | Carousel | Visual steps, used sparingly |
| Dialogue | Bubble, Message, Message Scroller, Avatar, Marker | Conversation practice, debates, Socratic exchanges |
| Definitions in context | Tooltip, Hover Card | Terms without losing your place |
| Media | Aspect Ratio, plus the existing Audio block | Images, audio overviews |
| Learner's work | Attachment, Card | Artefacts, capstones |

**Charts need a rule of their own.** Numbers are factual claims. A chart must come from T0 or T1 data, or be clearly labelled "illustrative". A convincing chart of invented numbers would be worse than none.

## Shell: used by the app, never chosen by the model

Button, Toggle, Label, Dialog, Alert Dialog, Drawer, Sheet, Dropdown Menu, Context Menu, Command, Navigation Menu, Menubar, Sidebar, Breadcrumb, Pagination, Scroll Area, Progress, Skeleton, Spinner, Empty, Sonner, Toast.

For example, Sheet holds the source drawer, Command powers a jump-to-concept palette, and Progress shows steps through an activity. Progress must never imply mastery percentages, per the existing experience rules.

## What needs installing

Already on `dev`: 60 of the 72.

Not yet installed: **Attachment, Bubble, Code Block, Marker, Message, Message Scroller, Questionnaire, Trace, Typography**. Data Table and Date Picker are built from existing pieces, and Toast overlaps with the installed Sonner.

Code Block brings Shiki through its optional highlighting composable. I haven't tested these with the repo's `maia` style and Reka base, so install and check them first.

## What shadcn-vue doesn't provide

These need other libraries or our own code. Most of it already exists.

| Need | Approach |
| --- | --- |
| Markdown | `@nuxtjs/mdc`, already a dependency |
| Diagrams, concept maps, flows | `mermaid`, already a dependency |
| Maths notation | Add KaTeX |
| Audio | Existing `AudioBlock` and Audio Overview pipeline |
| Flashcards | Existing V1 block; schedule with FSRS |
| Image hotspots | Our own component on Aspect Ratio |
| Drag to reorder | Optional enhancement over a keyboard-first control |
| Running code | Later; needs its own sandbox |
| Simulations | Later, through the sandbox in [ADR-0010](../adr/0010-compose-learning-activities-from-a-typed-catalogue.md) |

## How this fits `dev`

The seven primitives in `shared/learn-adaptive-activity-registry.ts` are the right pattern: versioned schemas, allowed actions, validated props and a text fallback. This expands that registry rather than replacing it. `reflection_next_move` and `artifact_workspace` stay as they are.

Each new type needs:
- A bounded schema, with a validator that rejects anything unknown
- A plain-text fallback, as the current contract requires
- A server grading rule
- Keyboard and screen-reader operation, which Reka mostly provides, and verified at the activity level
- A state for "already submitted", so a refresh doesn't lose or repeat an attempt

## Rollout order

Start where evidence and existing code are strongest:

1. Markdown, Mermaid and Typography in the current session. This alone is a visible jump from plain text.
2. Answer-gated retrieval, single and multiple choice, cloze, numeric: all auto-gradable, which also serves [measurement](./learn-anything-measurement.md).
3. Worked and faded examples using Stepper and Trace, plus existing flashcards and audio.
4. Compare views, charts, dialogue, scenario branches.
5. Code exercises, then simulations.

After each stage, use delayed results to decide what to keep. An activity that doesn't help on delayed checks gets dropped, however good it looks.
