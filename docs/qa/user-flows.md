# User Flows - QA Handoff

## 1. Onboarding Flow

**Preconditions:** User is logged out. A valid Google account is available.

### Steps

1. Navigate to `/login`.
2. Click "Continue with Google".
3. Complete Google OAuth consent.
4. After redirect, verify the app lands on `/` (dashboard).
5. Verify the greeting displays the user's name from Google.
6. Verify the "Your Courses" section shows an empty state with a "Start by creating a course folder" prompt.

### Expected Results

- Dashboard loads with user name and avatar from Google profile.
- No folders or courses are shown for a first-time user.
- Sidebar shows the home rail with no folder entries.

### Edge Cases

- Deny Google OAuth permissions and verify the app returns to `/login` without error.
- Log in with a Google account that has no display name; verify fallback to "Unknown" or graceful handling.
- Attempt to access `/app/folders/<any-id>` while logged out; verify redirect to `/login`.

---

## 2. Folder Management

**Preconditions:** User is logged in and on the dashboard (`/`).

### Create Folder

1. On the dashboard, locate the "Add Course" card in the courses carousel (or the empty-state "Start by creating a course folder" button).
2. Enter a folder name (1-100 characters).
3. Optionally set a color and icon.
4. Submit.
5. Verify the folder appears in the sidebar folder tree and in the dashboard courses carousel.
6. Click the folder to navigate to `/app/folders/<id>`.

### Rename Folder

1. Inside a folder view, click the pencil icon in the top bar.
2. The folder edit modal opens pre-filled with the current name, description, color, and icon.
3. Change the name and submit.
4. Verify the heading and sidebar both reflect the new name.

### Delete Folder

1. Open the folder edit modal.
2. Click the delete button (trash icon).
3. Confirm deletion in the confirmation dialog.
4. Verify redirect to `/` and the folder is removed from the sidebar.

### Nested Folders (Subfolders)

1. Inside a folder view, click the "Add subfolder" icon (FolderPlus) in the top bar.
2. Enter a subfolder name and submit.
3. Verify the subfolder appears in the sidebar under its parent.
4. Navigate into the subfolder and verify it functions identically to a top-level folder.

### Edge Cases

- Try creating a folder with an empty name or a name exceeding 100 characters.
- Try a description exceeding 280 characters.
- Delete a folder that contains documents, conversations, and flashcard rooms; verify all child data is removed.
- Delete a folder that has subfolders; verify cascading delete.

---

## 3. Document Management

**Preconditions:** User is inside a folder view, on the "Documents" tab (`/app/folders/<id>/documents`).

### Upload Document

1. Click the upload zone or drag-and-drop a file.
2. Supported formats: PDF, DOCX, XLSX, TXT, MD, CSV, HTML, PNG, JPG, JPEG, WEBP, GIF.
3. Maximum file size: 50 MB.
4. Verify the file appears with status "processing" then transitions to "indexing" then "success".

### Import from URL

1. In the chat input or folder shell hierarchy drawer, paste a URL.
2. Supported sources: websites, YouTube videos, direct file links.
3. Verify a document entry is created and progresses through processing to success.

### View Documents

1. On desktop, documents appear in a table list (FolderShellFilesList).
2. On mobile, documents appear in a card/panel layout (FolderShellFilesPanel).
3. Verify filename, status indicator, and file size are visible.

### Delete Document

1. Click the context menu on a document and select "Delete".
2. Confirm deletion in the dialog.
3. Verify the document is removed from the list.
4. Verify toast confirmation appears.

### Bulk Delete

1. On mobile, enable bulk mode via the toggle.
2. Select multiple documents.
3. Click the bulk delete action.
4. Confirm in the dialog.
5. Verify all selected documents are removed.

### Move Document Between Folders

1. Click the context menu on a document and select "Move".
2. The Move to Folder dialog appears listing all folders except the current one.
3. Select a destination folder and confirm.
4. Verify the document disappears from the current folder.
5. Navigate to the destination folder and verify the document is present.

### Bulk Move

1. Enable bulk mode, select multiple documents.
2. Click the bulk move action.
3. Select a destination folder and confirm.
4. Verify all selected documents are moved.

### Edge Cases

- Upload a file exceeding 50 MB; verify error.
- Upload an unsupported file type (e.g., `.exe`); verify rejection.
- Upload a file while another upload is in progress; verify queuing behavior.
- Delete a document that is still processing/indexing; verify it can be removed (failed documents can be deleted immediately without confirmation).
- Move a document to the same folder; verify the current folder is excluded from the picker.
- Try selecting documents that have "pending" or "failed" status in bulk mode; verify they are excluded from "Select All".

---

## 4. RAG Chat

**Preconditions:** User is inside a folder that has at least one successfully indexed document. Navigate to the chat tab (`/app/folders/<id>/chat`).

### Start Chat

1. The chat view loads. If a previous conversation exists in this folder, it is hydrated automatically.
2. Type a question in the input field at the bottom.
3. Press Enter or click Send.
4. Verify the user message appears in the message list.
5. Verify a "thinking" indicator appears while the AI processes.
6. Verify the assistant response streams in with source citations.

### View Sources

1. After receiving an AI response with citations, click a citation badge.
2. Verify the source panel opens showing the referenced chunk content, filename, and relevance score.

### Model Switching

1. Click the model selector dropdown in the chat input area.
2. Available models: Claude Sonnet 4.5, Claude Haiku 3.5, GPT-4o, GPT-4o Mini (recommended/default), Gemini 2.5 Flash, Llama 3.1 70B, DeepSeek V3, Mistral Large.
3. Select a different model.
4. Send a new message.
5. Verify the response is generated using the selected model (model name shown on the assistant message).

### New Chat

1. Press Ctrl+N (or Cmd+N on Mac) to start a new conversation.
2. Verify the message history clears.
3. Verify a new conversation is created when the first message is sent.

### Keyboard Shortcuts

1. Press `/` (when not in an input field) to focus the chat input.
2. Press Ctrl/Cmd+N to start a new chat.

### Edge Cases

- Send a message in a folder with no indexed documents; verify appropriate empty state or message.
- Send an extremely long message; verify handling.
- Switch models mid-conversation; verify continuity.
- Rapidly send multiple messages; verify ordering.

---

## 5. Flashcard Generation

**Preconditions:** User is inside a folder with indexed documents. Navigate to the flashcards tab (`/app/folders/<id>/flashcards`).

### Generate Flashcards

1. On the flashcards index page, click the generate button or create a new flashcard room.
2. The Room Generate Dialog opens.
3. Configure generation settings (prompt, card count).
4. Submit.
5. Verify a task is created and the tasks pane opens.
6. Wait for generation to complete.
7. Navigate to the created room (`/app/folders/<id>/flashcards/<roomId>`).

### Review Flashcards

1. Inside a flashcard room, cards are displayed with term and definition.
2. Practice mode: flip cards to reveal the definition.
3. Verify card ordering and navigation between cards.

### Edit Flashcards

1. In the room editor, edit a card's term or definition.
2. Verify changes are saved.
3. Add new cards manually.
4. Delete cards.

### Version History

1. Open the room history panel.
2. Verify previous generation versions are listed.
3. Switch between versions.

### Edge Cases

- Generate flashcards from a folder with no indexed documents; verify error handling.
- Generate a very large set of flashcards; verify performance.
- Delete a flashcard room; verify confirmation dialog and removal.
- Flag a card as incorrect during review; verify the flag is saved and corrected definition is recorded.

---

## 6. Quiz Generation

**Preconditions:** User is inside a folder with indexed documents. Navigate to the quiz tab (`/app/folders/<id>/quiz`).

### Generate Quiz

1. On the quiz index page, a Generation Wizard is available.
2. Configure quiz settings: question types (multiple-choice, free-response, true/false, fill-in-the-blank), difficulty, language, question count.
3. Submit generation.
4. Verify a task is created (tasks pane opens).
5. Wait for the quiz status to transition from "generating" to "ready".

### Take Quiz

1. Navigate to a ready quiz (`/app/folders/<id>/quiz/<quizId>`).
2. Quiz settings modal may appear for shuffle, show-all-questions, and immediate-feedback options.
3. Answer questions sequentially or view all at once (depending on mode).
4. Submit answers.
5. Verify correct/incorrect feedback per question (if immediate feedback enabled).

### View Results

1. After completing the quiz, the results view shows score, total, and per-question breakdown.
2. Verify explanations are shown for each question.
3. Verify the quiz's `latestAttemptStatus` updates to "completed".

### Resume Quiz

1. Navigate away from an in-progress quiz.
2. Return to the quiz; verify the Resume Dialog appears offering to continue or start over.
3. Resume and verify progress is preserved (currentQuestionIndex, answered questions).

### Edge Cases

- Generate a quiz when the folder has insufficient content; verify "Not enough content" error.
- Attempt to take a quiz that is still generating; verify appropriate loading state.
- Flag a quiz question as incorrect; verify the flag and corrected answer are saved.
- Abandon a quiz attempt and start a new one; verify the old attempt status is "abandoned".

---

## 7. Audio Overview

**Preconditions:** User is inside a folder with indexed documents.

### Generate Audio Overview

1. Click the microphone icon in the folder top bar, or create a new void of type "audio-overview".
2. The Audio Overview Customize dialog opens.
3. Configure length (minutes) and complexity (beginner/expert). The versioned managed Audio Profile fixes Host A to Kore and Host B to Puck.
4. Click "Generate".
5. Verify the generating indicator appears.
6. Wait for generation to complete (status transitions from "generating" to "ready").

### Listen

1. The Audio Overview Player loads with playback controls.
2. Play, pause, seek through the audio.
3. Verify the transcript is displayed alongside playback with speaker labels (host_a, host_b).

### Interjections

1. During playback, type a question in the interjection input.
2. Submit the interjection.
3. Verify a separate grounded interjection artifact plays once while the canonical episode remains paused.
4. Verify the interjection utterance is displayed, then the canonical timeline returns to its exact saved timestamp and resumes only if it was playing before the question.

### Share

1. Click share in the Audio Overview.
2. Verify a share token is generated and a public URL is created.
3. Open the public URL (`/audio/<token>`) in an incognito window; verify the audio plays without authentication.

### Quota

1. Generate audio overviews up to the daily cap (10 per day).
2. Verify the quota display shows used/cap counts.
3. Attempt to exceed the daily cap; verify appropriate error or disabled state.

### Edge Cases

- Generate an audio overview in a folder with no indexed documents; verify error.
- Generate with very short length (minimum); verify valid output.
- Share and then un-share; verify the public link stops working.

---

## 8. Learn Course

**Preconditions:** User is inside a folder with indexed documents.

### Generate Course

1. Navigate to the Learn tab (`/app/folders/<id>/learn`).
2. Click "Create a course from this folder" or the Create Course card.
3. The Course Creator wizard opens at the source-selection step.
4. Enter a course title.
5. Select source type: "folder" (uses folder documents) or "web-only".
6. Optionally select specific documents and enable web search.
7. Submit.
8. Verify the wizard transitions to the "generating" step with skeleton loading.
9. Wait for the course status to transition to "ready".
10. The outline editor step appears showing generated sections.

### View Course

1. Navigate to the course view (`/app/folders/<id>/learn/<courseId>`).
2. Verify the course title, section list, and progress indicators are shown.
3. Verify completion count (completedSectionCount / totalSectionCount).

### Complete Sections

1. Click on a section to navigate to it (`/app/folders/<id>/learn/<courseId>/<sectionId>`).
2. Sections contain content blocks: text, quiz, flashcard, and audio blocks.
3. Read through text blocks.
4. Complete embedded quizzes and flashcard reviews.
5. Listen to audio blocks.
6. Verify the section status transitions from "locked" to "generating" to "ready" to "completed".

### Mastery Progression

1. Each section has a mastery level: new, learning, reviewing, mastered.
2. Complete practice exercises to advance mastery.
3. Verify the mastery badge updates accordingly.
4. Verify consecutive review passes are tracked.

### Start Learning

1. On a newly created course where all sections are "locked", a "Start Learning" button should appear.
2. Click it to unlock the first section and begin generation.

### Daily Review (Spaced Repetition)

1. From the Learn tab or dashboard, click the Daily Review CTA (if review items are due).
2. Navigate to `/app/learn/review`.
3. Review mode: "full" (all due items) or "quick" (top priority only).
4. For each item: view the prompt, press Space to reveal the answer, rate the answer (keys 1-4).
5. Ratings map to SM-2 quality values: 1=forgot (0), 2=hard (3), 3=good (4), 4=easy (5).
6. After all items are reviewed, verify the session complete screen shows correct/needs-practice counts.
7. Verify streak counter updates.

### Review Cap Setting

1. On the review page header, adjust the daily review cap.
2. Default cap is 50 items.
3. Verify the cap limits how many items appear in the session.

### Flag Items

1. During review, press "F" or click the flag button to flag an item as incorrect.
2. Enter a corrected answer.
3. Save.
4. Verify the flag is persisted.

### Edge Cases

- Create a course in a folder with no documents (web-only source type); verify it proceeds.
- Generate a course exceeding MAX_SOURCE_DOCS (100 documents); verify it caps at 100.
- Delete a course; verify confirmation dialog and cascade delete of sections, review items, and related entities.
- Navigate to a section that is still generating; verify loading/generating state.
- Complete all review items; verify "All caught up" empty state.
- Switch between full and quick review modes before rating any items; verify data reloads.
- Try switching mode after rating at least one item; verify the toggle is disabled.

---

## 9. Calendar Integration

**Preconditions:** User is logged in and has at least one course.

### Connect Google Calendar

1. Navigate to a course view or a page that renders the CalendarConnectionCard component.
2. Click "Connect".
3. The browser redirects to `/api/calendar/connect` which initiates Google OAuth for calendar access.
4. Complete the OAuth flow.
5. Verify redirect back to the app with the connection status showing "Connected" and the user's timezone.

### Configure Session Preferences

1. Once connected, the SessionPreferencesForm appears below the connection card.
2. Set morning start time, evening end time, session duration (minutes), and preferred days.
3. Save preferences.

### Scheduled Events

1. The system automatically schedules study sessions as Google Calendar events.
2. Events are categorized as: new-content, review, or audio-only.
3. A cron job runs every hour to check for missed sessions and reschedule them.

### Disconnect

1. Click "Disconnect" on the CalendarConnectionCard.
2. Confirm in the dialog.
3. Verify the connection is removed and all scheduled learning events are deleted from Google Calendar.

### Edge Cases

- Cancel the Google OAuth consent; verify the app handles the error (calendar_error query param).
- Disconnect and reconnect; verify a fresh connection is established.
- Verify the cron correctly reschedules missed sessions to the next available slot.
- Revoke calendar permissions from Google's account settings; verify the app handles token refresh failures gracefully.

---

## 10. Data Export

**Preconditions:** User is logged in.

### Export User Data

1. Open the sidebar user menu.
2. Click "Export data" (data-testid: `sidebar-menu-export-data`).
3. Verify the export begins (a download is triggered or a toast confirms the action).
4. Verify the exported data includes: user profile, folders, documents (metadata), conversations, messages, quizzes, quiz questions, quiz attempts, flashcard sets, flashcards, flashcard rooms, audio overviews, courses, course sections, review items, learn profile, review sessions, calendar connections, and calendar events.

### Edge Cases

- Export data for a user with no content; verify an empty but valid export.
- Export data spanning at least three pages per representative dataset; verify no duplicates or gaps and a valid streamed ZIP.
- Verify no sensitive tokens (OAuth access/refresh tokens) are included in the export.
