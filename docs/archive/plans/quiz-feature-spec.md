# Quiz Feature Specification

> Historical feature specification retained for decision traceability. Current behavior is defined by the application, tests, and maintained product documentation.

> Implementation-agnostic feature spec for replicating the full quiz system.

---

## 1. Overview

The quiz system provides AI-generated and manually-created quizzes with four question types, configurable attempt settings, attempt history, and a detailed results review. It operates across two surfaces:

1. **Quiz Room** — Create/manage quizzes, take quizzes, and review results within a collection "room."
2. **Study Guide Integration** — Embedded quiz experience within study guide sections.

---

## 2. Data Model

### Quiz

| Field | Description |
|---|---|
| ID | Unique identifier |
| Title | Editable quiz name |
| Description | Optional description |
| Creation Method | `manual` or `auto_generated` |
| Source Resource IDs | Documents used for AI generation |
| Difficulty | Difficulty level string |
| Language | Language of the quiz |
| Privacy Setting | `private` or `public` |
| Question Count | Number of questions |
| Questions | Array of Question objects |
| Status | Latest attempt status: `null`, `in_progress`, `completed`, `abandoned` |
| Conversation ID | Parent room/conversation |
| Created / Updated At | Timestamps |

### Question

| Field | Description |
|---|---|
| ID | Unique identifier |
| Quiz ID | Parent quiz |
| Question Text | The question prompt |
| Question Type | `multiple_choice`, `true_false`, `short_response`, `fill_in_the_blank` |
| Options | Array of `{ text, isCorrect? }` — for multiple choice and true/false |
| Correct Answer | The correct answer string |
| Explanation | Why the answer is correct |
| Order In Quiz | Sort position |
| Created / Updated At | Timestamps |

### Quiz Attempt

| Field | Description |
|---|---|
| Attempt ID | Unique identifier |
| Quiz ID | Parent quiz |
| Status | `in_progress`, `completed`, `abandoned` |
| Score | Percentage score |
| Settings Snapshot | Frozen copy of settings used for this attempt |
| Current Question Index | Where user left off (for resume) |
| Started At / Completed At | Timestamps |

### Attempt Answer

| Field | Description |
|---|---|
| Answer ID | Unique identifier |
| Attempt ID | Parent attempt |
| Question ID | Which question was answered |
| User Answer | The user's response text |
| Is Correct | Boolean grading result |
| Feedback Provided | AI-generated or static feedback |
| Answered At | Timestamp |

### Answer Feedback (client-side)

| Field | Description |
|---|---|
| Is Correct | Boolean |
| Correct Answer | The right answer |
| Explanation | Why it's correct |
| AI Feedback | Optional AI-generated explanation |

### Quiz Settings (per attempt)

| Setting | Description |
|---|---|
| Shuffle Questions | Randomize question order |
| Show All Questions | Display all questions at once vs. one at a time |
| Immediate Feedback | Show correct/incorrect after each answer |

---

## 3. API Endpoints

All endpoints require authentication.

### Quiz Management

| Action | Description |
|---|---|
| **Create Quiz** | Create a quiz (manual or AI-generated) with title, documents, topics, question types, difficulty, and question count |
| **List Quizzes** | Fetch quizzes for the user, with optional conversation filter and pagination |
| **Get Quizzes by Conversation** | List all quizzes in a specific conversation/room |
| **Get Quiz by ID** | Fetch a single quiz with its questions |
| **Update Quiz** | Edit title, description, difficulty, or language |
| **Delete Quiz** | Remove a quiz and its data |

### Question Management

| Action | Description |
|---|---|
| **Add Question** | Add a question to an existing quiz (specify type, text, options, correct answer, explanation) |
| **Update Question** | Edit any question field |
| **Delete Question** | Remove a question from a quiz |

### Quiz Taking

| Action | Description |
|---|---|
| **Start Attempt** | Begin a new attempt or resume an existing one. Accepts settings (shuffle, show-all, immediate feedback) and a `restart` flag |
| **Submit Answer** | Submit an answer for a single question. Returns feedback (if immediate), the next question (if sequential), and updated progress |
| **Submit All Answers** | Batch-submit all answers at once (for show-all mode). Returns complete results with detailed per-question breakdown |
| **Complete Attempt** | Mark an attempt as complete and trigger final scoring |

### Results & History

| Action | Description |
|---|---|
| **Get Results** | Fetch detailed results for a completed attempt (score, per-question answers, correct answers, explanations) |
| **Get Quiz History** | Fetch past attempts for a quiz with scores and dates |
| **Get History by Conversation** | Fetch attempt history filtered by conversation |

### AI Generation

| Action | Description |
|---|---|
| **Generate Topics** | AI-suggests topics from selected documents/collections for quiz generation |

---

## 4. State Machine

The quiz UI is driven by a four-state machine:

```
initial → overview → taking → results
  ↑          ↑          │         │
  └──────────┴──────────┴─────────┘
```

| State | Description |
|---|---|
| `initial` | No quiz exists yet — shows creation options |
| `overview` | Quiz exists with questions — shows question list, title editor, history, and control center |
| `taking` | User is actively taking the quiz — sequential or show-all mode |
| `results` | Attempt completed — shows score, per-question review, and history |

---

## 5. Quiz Room

### 5.1 Page Structure

- **Route:** `/:collectionId/rooms/practice-quiz/:roomId`
- On entering the page, resets quiz session state and loads quizzes for the conversation
- Delegates all UI to the quiz flow orchestrator

### 5.2 Initial State (No Quiz)

When no quiz exists in the room:
- "New quiz" heading
- Two large action buttons:
  - **Add question** — opens a manual question creation modal
  - **Generate questions** — opens AI generation flow
- The add/edit modal supports all 4 question types with fields for text, options, correct answer, and explanation

### 5.3 Quiz Overview

When a quiz exists with questions:

**Header:**
- Editable quiz title (inline rename, persisted to API)
- History dropdown button showing past attempts with date, time, and color-coded score badge:
  - ≥80%: green
  - ≥60%: yellow
  - <60%: red
- Clicking a history item loads that attempt's results

**Questions Section:**
- List of question cards showing question text, type badge, and options (read-only)
- Per-question actions: Edit, Delete
- "Add question" and "Generate questions" buttons
- Each question type renders a preview:
  - **Multiple Choice** — shows answer options
  - **True/False** — shows True/False options
  - **Short Response** — shows expected answer area
  - **Fill in the Blank** — shows blank indicator

### 5.4 Control Center (Bottom Dock)

Sticky bottom bar with:
- **Take quiz** button (disabled if no questions exist)
  - If an in-progress attempt exists: shows Resume Dialog instead of settings
- **Generate questions** button (AI generation)

### 5.5 Resume Dialog

Shown when user clicks "Take quiz" and an in-progress attempt exists:
- Quiz title, progress (X of Y answered), start date
- Two options:
  - **Resume** — continues existing attempt with default settings
  - **Start new quiz** — opens settings modal for a fresh attempt

### 5.6 Take Settings Modal

Before starting an attempt, user configures:
- **Shuffle questions** (toggle) — randomize question order
- **Show all questions at once** (toggle) — display all questions on one page vs. sequential
- **Immediate feedback** (toggle) — show answers after each question
- Cancel and Start buttons

---

## 6. Quiz Taking

Two distinct modes based on settings:

### 6.1 Sequential Mode

One question at a time:

**Question Display:**
- Question number label ("Question X")
- Question text prominently displayed
- Question type indicator (for fill-in-the-blank and short response)
- Type-specific input component (see §7)

**Feedback Display (if immediate feedback enabled):**
- **Correct:** Green banner with checkmark + "Correct!"
- **Incorrect:** Red banner with X + "Oops, that's not correct."
- Shows correct answer and explanation for wrong answers
- For correct answers: "Explain why" button to expand explanation
- Explanation shows the correct answer text and reasoning

**Bottom Navigation:**
- Progress dropdown showing "X of Y"
- Progress bar (animated width transition)
- Next / Submit button (disabled until answer provided, shows spinner while submitting)
- Last question changes button text to "Submit"

**Flow:**
1. User answers → clicks Next
2. If immediate feedback: show feedback → user clicks Next to advance
3. If no immediate feedback: answer is submitted, automatically advance
4. On last question submit → triggers quiz completion → transition to results

### 6.2 Show All Mode

All questions displayed on a single scrollable page:

- Each question rendered in a vertical list with question number header
- Same type-specific inputs as sequential mode
- Per-question feedback shown inline (if enabled)
- Answers stored locally per question ID

**Bottom Navigation (sticky):**
- Progress counter: "X of Y" answered
- Progress bar
- "Next" button: scrolls to the first unanswered question (smooth scroll)
- "Submit" button: appears when all questions answered, batch-submits all answers at once

**Auto-scroll:** On mount, scrolls to the current question index.

---

## 7. Question Types

### 7.1 Multiple Choice

- Vertical list of option buttons
- Click to select (one selection at a time)
- With feedback: correct option highlighted green, wrong selection highlighted red, disabled state

### 7.2 True / False

- Two buttons: "True" and "False"
- Same feedback highlighting as multiple choice

### 7.3 Fill in the Blank

- Text input field
- With feedback: shows correct answer below

### 7.4 Short Response

- Multi-line textarea
- AI evaluates response correctness (model configurable)
- With feedback: shows correct answer and AI evaluation

---

## 8. Quiz Results

### 8.1 Header

- "Quiz results" title
- Start/completion timestamps formatted as date + time
- History dropdown (same as overview — reusable component)

### 8.2 Stats Cards (2-column grid)

- **Your Score** — percentage with circular/visual indicator, color-coded (≥80% green, ≥60% yellow, <60% red)
- **Correct Answers** — "X of Y" count

### 8.3 Per-Question Review (tabbed interface)

- **Left Sidebar:** Scrollable list of questions as tabs, each showing:
  - Question number
  - Truncated question text
  - Correct (green checkmark) or incorrect (red X) indicator
- **Right Content:** Selected question detail showing:
  - Full question text
  - User's answer
  - Correct answer
  - Explanation
  - For multiple choice: visual display of all options with correct/selected highlighting

### 8.4 Actions

- **Retake Quiz** — starts a new attempt (returns to settings)
- **View History** — dropdown with past attempts

---

## 9. AI Quiz Generation

A multi-step wizard flow:

### Step 1: Add Resources

- File/folder selector from the current collection
- Selected resources shown in a list with remove buttons
- "Next" button (disabled until at least one resource selected)

### Step 2: Customize Topics

- **Suggested Topics:** AI-generated topic pills from selected resources (via Generate Topics API)
  - Click to toggle selection (selected = filled style, unselected = outline)
- **Custom Topics:** Text input + "Add" button to add custom topics
- Selected topics shown as removable pills
- Loading state with spinner during topic generation
- Back / Next navigation

### Step 3: Configure Settings

- **Max questions:** Number input (1–50)
- **Question types:** Checkboxes for each type:
  - Multiple choice
  - True/false
  - Short response
  - Fill in the blank
- **Difficulty:** Select dropdown (easy, medium, hard, mixed)
- Back / Generate button

**Generation Flow:**
1. Creates quiz via API with all gathered parameters
2. Shows loading state during generation
3. On success: transitions to quiz overview with generated questions
4. On error: error toast notification

---

## 10. Study Guide Integration

Quizzes appear as section types within study guides:
- Embedded quiz flow with same state machine (initial → overview → taking → results)
- Completion tracking integrated with study guide progress
- Session time tracking
- "Complete" action on quiz finish triggers section completion

---

## 11. Question Management (Add/Edit Modal)

A shared modal for creating and editing individual questions:

**Form Fields:**
- **Question Type** selector (dropdown: multiple choice, true/false, short response, fill in the blank)
- **Question Text** (textarea)
- **Options** (for multiple choice) — dynamic list with add/remove, one marked as correct
- **Correct Answer** (text input — for short response, fill-in-the-blank, true/false)
- **Explanation** (textarea — shown in feedback)

**Modes:**
- Create: adds to existing quiz
- Edit: pre-populates fields, updates on save

---

## 12. Attempt Resume & Restart

The system supports resuming interrupted attempts:
- When starting an attempt, a `restart` flag determines behavior:
  - `restart: true` — creates a fresh attempt
  - `restart: false` — resumes the last in-progress attempt
- Resumed attempts restore: current question index, previously answered questions, and settings
- The API returns `status: "started"` for new or `status: "resumed"` for continued attempts
- In show-all mode, resumed attempts also restore the full question list and answered question IDs

---

## 13. History & Pagination

- Quiz history shows per-quiz attempt records with score and completion date
- History supports pagination with offset/limit
- Separate history loading for:
  - Global user history
  - Per-quiz history
  - Per-conversation history
- "Load more" pagination pattern for lists

---

## 14. Error Handling

| Context | Behavior |
|---|---|
| Quiz creation/generation | Toast notification with loading → success/error |
| Question CRUD | Toast with success/error messages |
| Answer submission | Loading spinner on button, error toast on failure |
| Results loading | Full-page error state with Retry button |
| History loading | Inline spinner in dropdown, graceful error handling |
| Topic generation | Loading spinner, fallback to manual topic entry |

---

## 15. Content Loading Optimization

The system implements an advanced content loading layer:

- **Caching:** LRU-style cache with TTL for quiz questions and content
- **Loading Strategies:** Supports eager, lazy, progressive, and adaptive loading
- **Preloading:** Prefetches upcoming questions based on user progress and performance
- **Retry Logic:** Automatic retry with configurable max retries on failure
- **Metrics Tracking:** Monitors cache hit rate, load times, and error rates
