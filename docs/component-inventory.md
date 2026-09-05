# Component Inventory

## Vue Components

### audio-overview/ (8 components)

| Component | Purpose |
|---|---|
| AudioOverviewCard | Card display for an audio overview entry |
| AudioOverviewCustomize | Customization form for overview preferences |
| AudioOverviewGenerating | Loading/progress state during generation |
| AudioOverviewPlayer | Audio player with turn-by-turn playback |
| AudioOverviewShareDialog | Dialog for sharing/publishing an overview |
| AudioOverviewShell | Main shell layout for audio overview feature |
| PublicAudioShell | Public-facing shell for shared audio overviews |
| StickyMiniPlayer | Persistent mini audio player |

### chat/ (13 components)

| Component | Purpose |
|---|---|
| CitationBadge | Inline citation reference badge |
| DirectoryPicker | Folder/file picker for chat scope |
| DirectoryPickerBranch | Tree branch node in directory picker |
| DirectoryPickerRow | Single row in directory picker |
| Input | Chat message input field |
| Message | Chat message bubble |
| ModelSelector | AI model selection dropdown |
| ReferenceChips | Selected reference scope chips |
| ReferenceScopeStrip | Horizontal strip of reference scope items |
| SourceCard | Source document preview card |
| SourcePanel | Panel listing cited sources |
| ThinkingRow | AI thinking/loading indicator |
| Workspace | Main chat workspace container |

### dashboard/ (9 components)

| Component | Purpose |
|---|---|
| ActionCard | Quick action card on dashboard |
| ActionSection | Section grouping action cards |
| AddCourseCard | Card to create a new course |
| AskBar | Global question input bar |
| ChatHero | Hero area for general chat |
| CourseCard | Course summary card |
| CoursesCarousel | Horizontal carousel of courses |
| FolderPickerDialog | Dialog for selecting a folder |
| Greeting | Personalized greeting display |

### documents/ (3 components)

| Component | Purpose |
|---|---|
| FileStatusItem | Document processing status indicator |
| FileUploadZone | Drag-and-drop file upload area |
| MoveToFolderDialog | Dialog to move a document to another folder |

### flashcards/ (7 components)

| Component | Purpose |
|---|---|
| RoomEditor | Card editor for a flashcard room |
| RoomGenerateDialog | AI generation dialog for flashcards |
| RoomHeader | Room header with title and actions |
| RoomHistoryPanel | Version history panel |
| RoomPractice | Flashcard practice/study mode |
| RoomShell | Main shell for flashcard room view |
| Tab | Flashcard tab navigation item |

### folder-shell/ (14 components)

| Component | Purpose |
|---|---|
| FileKebabMenu | Context menu for file actions |
| FileStatusPill | Compact file status indicator |
| FolderShell | Main folder layout shell |
| FolderShellFileRow | Single file row in file list |
| FolderShellFilesList | File list container |
| FolderShellFilesPanel | Panel displaying folder files |
| FolderShellHierarchyDrawer | Drawer showing folder hierarchy |
| FolderShellMembersPanel | Panel for folder members |
| FolderShellRail | Navigation rail for folder views |
| FolderShellRailItem | Single item in navigation rail |
| FolderShellTree | Folder tree view |
| FolderShellTreeNode | Individual tree node |
| HelperPane | Side helper pane container |
| UnifiedHelperPaneTabs | Tab bar for helper pane sections |

### folders/ (8 components)

| Component | Purpose |
|---|---|
| ColorSelect | Folder color picker |
| FolderBadge | Folder icon/color badge |
| FolderContextPane | Contextual info pane for folder |
| FolderFormModal | Create/edit folder modal |
| FolderHelperPane | Folder-specific helper pane |
| FolderKnowledgeTree | Knowledge base tree view |
| FolderTasksPane | Task list pane for folder |
| IconSelect | Folder icon picker |

### global/ (5 components)

| Component | Purpose |
|---|---|
| Citation | Rendered citation reference |
| DirectoryPicker | Reusable directory picker |
| InstallAppPrompt | PWA install prompt |
| MermaidDiagram | Mermaid diagram renderer |
| ProsePre | Styled code block for prose content |

### learn/ (27 components)

| Component | Purpose |
|---|---|
| AudioBlock | Audio content block within a section |
| CalendarConnectionCard | Google Calendar connection UI |
| CourseCard | Course card for learn module |
| CourseCreator | Multi-step course creation form |
| CourseViewBody | Course detail view body |
| CreateCourseCard | Card to initiate course creation |
| DailyReviewCTA | Call-to-action for daily review sessions |
| DeleteCourseDialog | Confirmation dialog for course deletion |
| FlashcardBlock | Flashcard content block within a section |
| MasteryBadge | Mastery level indicator badge |
| OfflineBanner | Offline mode notification banner |
| OutlineEditor | Course outline editing interface |
| PaceSelector | Learning pace selection control |
| QuizBlock | Quiz content block within a section |
| ReviewCapSetting | Daily review cap configuration |
| ReviewCard | Spaced repetition review card |
| ReviewRatingButtons | Rating buttons for review sessions |
| ReviewSessionProgress | Progress indicator for review sessions |
| SectionBlockRenderer | Renders section content blocks by type |
| SectionCompletionCard | Section completion summary |
| SectionVoidTopBar | Top bar for section void state |
| SessionPreferencesForm | Calendar session preferences form |
| SourceSelector | Source document selector for course creation |
| StartLearningButton | Button to begin learning a section |
| StreakDisplay | Learning streak display |
| TextBlock | Text content block within a section |

### mobile/ (1 component)

| Component | Purpose |
|---|---|
| SwipeRevealItem | Swipe-to-reveal action item |

### quiz/ (22 components)

| Component | Purpose |
|---|---|
| ActiveView | Active quiz-taking view |
| CardPreview | Question card preview |
| Editor | Quiz question editor |
| GenerationWizard | Multi-step AI quiz generation wizard |
| HistoryDropdown | Quiz attempt history dropdown |
| OverviewView | Quiz overview/summary view |
| Question | Single question display |
| QuestionModal | Question detail modal |
| ResultsView | Quiz results/score view |
| ResumeDialog | Resume interrupted attempt dialog |
| ReviewPanel | Post-quiz review panel |
| SequentialMode | One-question-at-a-time mode |
| SettingsModal | Quiz settings modal |
| Shell | Main quiz shell layout |
| ShowAllMode | All-questions-visible mode |
| Tab | Quiz tab navigation item |
| Taker | Quiz-taking controller |
| TakingView | Active quiz-taking wrapper |
| inputs/FillInBlank | Fill-in-the-blank input |
| inputs/MultipleChoice | Multiple choice input |
| inputs/ShortResponse | Short response input |
| inputs/TrueFalse | True/false input |

**quiz/wizard/ (3 sub-components):**

| Component | Purpose |
|---|---|
| ResourceStep | Resource selection step |
| SettingsStep | Quiz settings step |
| TopicStep | Topic selection step |

### sidebar/ (2 components)

| Component | Purpose |
|---|---|
| FolderTree | Sidebar folder tree navigation |
| HomeRail | Home navigation rail |

### voids/ (1 component)

| Component | Purpose |
|---|---|
| CreateVoidDialog | Dialog to create a void |

### ui/ (shadcn-vue primitives)

Shared reusable UI primitives based on shadcn-vue / Reka UI. ~330 component files across 55 groups:

accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, button-group, calendar, card, carousel, chart, checkbox, collapsible, combobox, command, context-menu, dialog, drawer, dropdown-menu, empty, field, form, hover-card, input, input-group, input-otp, item, kbd, label, menubar, native-select, navigation-menu, number-field, pagination, pin-input, popover, progress, radio-group, range-calendar, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, spinner, stepper, switch, table, tabs, tags-input, textarea, toggle, toggle-group, tooltip.

---

## Summary

| Category | Count |
|---|---|
| audio-overview | 8 |
| chat | 13 |
| dashboard | 9 |
| documents | 3 |
| flashcards | 7 |
| folder-shell | 14 |
| folders | 8 |
| global | 5 |
| learn | 27 |
| mobile | 1 |
| quiz | 25 |
| sidebar | 2 |
| voids | 1 |
| ui (shadcn-vue) | ~330 |
| **Total** | **~453** |

---

## Composables (31)

| Composable | Purpose |
|---|---|
| useAppTheme | Application theme management |
| useAudioOverviewDownload | Audio overview file download |
| useAudioOverviewStore | Audio overview state management |
| useChat | RAG chat state and API calls |
| useDocuments | Document CRUD operations |
| useFlashcardRooms | Flashcard room state |
| useFolderLayout | Folder view layout management |
| useFolderPageContext | Folder page route context |
| useFolderReferenceScope | Folder reference scope state |
| useFolders | Folder CRUD and navigation |
| useGeneralChat | General (non-RAG) chat state |
| useGestureGuards | Gesture conflict resolution |
| useHelperPane | Helper pane open/close state |
| useHorizontalSwipeGesture | Horizontal swipe gesture handler |
| useMobileKeyboardInset | Mobile keyboard safe area insets |
| useMotionPresets | Animation motion presets |
| useOfflineAttempts | Offline quiz attempt management |
| useOfflineCache | Service worker offline caching |
| useOfflineSync | Offline data synchronization |
| useOnlineStatus | Network online/offline detection |
| usePreFetchSection | Section content pre-fetching |
| useQuizAttempt | Quiz attempt state tracking |
| useQuizFlow | Quiz flow navigation |
| useQuizGeneration | Quiz AI generation orchestration |
| useQuizHistory | Quiz history retrieval |
| useQuizzes | Quiz CRUD operations |
| useRag | RAG search operations |
| useReferenceScope | Reference scope management |
| useSwipeReveal | Swipe-to-reveal gesture state |
| useTasks | Task polling and management |
| useTimezoneSync | Timezone detection and sync |

---

## Layouts (2)

| Layout | Purpose |
|---|---|
| default | Default application layout |
| folder | Folder-scoped layout with shell |

---

## Pages (25)

| Path | Purpose |
|---|---|
| `/` | Landing page |
| `/login` | Login page |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |
| `/chat` | General chat (public) |
| `/audio/[token]` | Public shared audio overview |
| `/app/` | App dashboard |
| `/app/chat` | General chat (authenticated) |
| `/app/learn/review` | Spaced repetition review session |
| `/app/folders/[id]` | Folder root |
| `/app/folders/[id]/` | Folder index/overview |
| `/app/folders/[id]/chat` | Folder chat index |
| `/app/folders/[id]/chat/[conversationId]` | Specific conversation |
| `/app/folders/[id]/documents` | Folder documents view |
| `/app/folders/[id]/flashcards` | Flashcard rooms index |
| `/app/folders/[id]/flashcards/[roomId]` | Specific flashcard room |
| `/app/folders/[id]/quiz` | Quiz index |
| `/app/folders/[id]/quiz/[quizId]` | Specific quiz |
| `/app/folders/[id]/learn` | Learn module index |
| `/app/folders/[id]/learn/create` | Create a new course |
| `/app/folders/[id]/learn/[courseId]` | Course detail view |
| `/app/folders/[id]/learn/[courseId]/[sectionId]` | Section content view |
