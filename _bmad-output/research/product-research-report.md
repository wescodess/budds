# Competitive Product Research Report
**Date:** 2026-04-09
**Products Analyzed:** Google NotebookLM, Atlas
**Purpose:** Build product profiles of existing learning/study AI tools to inform Budds Learning Compiler features, functionality, and UI/UX design

---

## 1. Google NotebookLM

### Product Overview
- **URL:** https://notebooklm.google.com/
- **Tagline:** AI-powered notebook for research, learning, and content generation
- **Auth:** Google Account (SSO only)
- **Pricing:** Free tier + PRO subscription (pricing not explored)
- **Platform:** Web only

### Information Architecture

```
Home
├── Featured notebooks (curated/public)
├── My notebooks (recent, grid/list view, sortable)
├── Search
└── Settings (Help, Feedback, Discord, Output Language, Theme, Licenses, Manage subscription)

Notebook Workspace (3-panel layout)
├── LEFT: Sources Panel
│   ├── Add source (search bar + web/drive discovery)
│   ├── Source list with checkboxes (select/deselect for chat context)
│   └── Source detail view (AI summary + topic tags + full text)
├── CENTER: Chat Panel
│   ├── Auto-generated notebook summary
│   ├── Suggested questions
│   ├── Chat input with source count
│   └── Configure notebook (Default / Learning Guide / Custom prompt up to 10k chars)
└── RIGHT: Studio Panel
    ├── Audio Overview (AI podcast)
    ├── Slide Deck
    ├── Video Overview (AI explainer video)
    ├── Mind Map
    ├── Reports
    ├── Flashcards
    ├── Quiz (interactive)
    ├── Infographic
    ├── Data Table
    ├── Generated outputs (saved, timestamped)
    └── Notes (rich text editor, convertible to source)
```

### Source Input Methods
1. **Search/Discovery** - AI-powered source search with two modes:
   - Web: "Best sources from the web"
   - Google Drive: "Your content from Google Drive"
2. **Research Modes:**
   - Fast Research: "Great for quick results"
   - Deep Research: "In-depth report and results"
3. **Upload files** - PDF, images, docs, audio, "and more"
4. **Websites** - Paste URLs (websites + YouTube). Imports visible text/transcript only. Paid articles not supported.
5. **Google Drive** - Direct import
6. **Copied text** - Paste raw text

### Studio Output Types (9 total)
| Output | Description |
|--------|------------|
| Audio Overview | AI-generated podcast from sources |
| Slide Deck | AI slide presentation |
| Video Overview | AI explainer video with presenter |
| Mind Map | Visual concept map |
| Reports | Written reports |
| Flashcards | Study flashcards |
| Quiz | Interactive quiz |
| Infographic | Visual infographic |
| Data Table | Structured data extraction |

### Chat Configuration
- **Default** - General purpose research and brainstorming
- **Learning Guide** - Educational content, grasping new concepts
- **Custom** - Free-form prompt up to 10,000 characters
- **Response Length:** Default / Verbose / Concise

### Sharing & Collaboration
- **Access levels:** Restricted (default), Anyone with a link, Public
- **Roles:** Owner + invited users
- **Welcome Note:** Optional toggle for opening message
- **Invite:** Add people by email with notification option
- **Copy link** with additional copy options

### Key UX Patterns
- Dark mode default, theme toggle (Device/Light/Dark)
- 3-panel persistent layout (Sources | Chat | Studio)
- Source checkboxes for selective context inclusion
- Auto-generated summaries with key terms bolded
- Suggested questions as clickable buttons
- Chat history persisted across sessions (deletable)
- Notes with rich text editor + "Convert to source" action
- Notebook title editable inline
- Source detail view replaces source list (slide-over pattern)
- Studio outputs saved with timestamps and source counts
- Feedback buttons (Good/Bad) on summaries and generated content
- Output language configurable globally
- "NotebookLM can be inaccurate; please double check its responses" footer

### Screenshots Captured
- 01_homepage.png - Home page with featured + recent notebooks
- 02_settings_menu.png - Settings dropdown
- 03_language_settings.png - Output language config
- 04_creating_notebook.png - Loading state
- 05_add_source_dialog.png - Main source upload dialog
- 06_web_source_menu.png - Web vs Drive source types
- 07_research_modes.png - Fast vs Deep research
- 08_website_source.png - URL paste interface
- 09_copied_text_source.png - Paste text interface
- 10_notebook_workspace.png - Empty 3-panel workspace
- 11_configure_chat.png - Chat configuration modes
- 12_custom_prompt.png - Custom prompt with 10k char limit
- 13_share_dialog.png - Sharing interface
- 14_share_access_options.png - Restricted/Anyone/Public
- 15_notebook_with_sources.png - Full workspace with 13 sources
- 16_source_detail_view.png - Source reader with AI guide
- 17_video_overview_player.png - Video player in Studio
- 18_note_editor.png - Rich text note with Convert to Source

---

## 2. Atlas

### Product Overview
- **URL:** https://www.atlas.org/home
- **Tagline:** "School AI Assistant"
- **Auth:** Google, Apple, Phone, Email (OTP verification)
- **Pricing:** Free (limited spaces/chats/uploads per day) | Pro $7.50/mo yearly ($15.99/mo monthly)
- **Platform:** Web + iOS (App Store) + Android (Google Play)
- **User base:** 800k+ students, 4.9 rating

### Information Architecture

```
Home
├── New space launcher (all tools accessible)
├── Recent spaces
├── My folders (with member counts)
└── "Ask Atlas anything..." global input

Folder (collaborative workspace)
├── Sidebar
│   ├── Folder name + settings
│   ├── Members (count + invite)
│   ├── Knowledge (shared resource count)
│   ├── Spaces (Shared + Private categories)
│   └── Resizable panel divider
└── Space Types
    ├── Chat with AI
    ├── Study guide
    ├── Quiz
    ├── Flashcards
    ├── Solve
    ├── Write
    ├── Recording
    └── Notes
```

### Onboarding Flow
1. **Sign in** - Email OTP / Google / Apple / Phone
2. **Attribution** - "How did you hear about Atlas?" (Google, TikTok, Reddit, Instagram, Email, Friend, None)
3. **Student type** - University / High School / Other
4. **Tutorial** - 1:18 video walkthrough (skippable)
5. **Landing** - Folder workspace with empty state

### Core Features (8 Space Types)

| Category | Tool | Description |
|----------|------|-------------|
| **Chat** | Chat with AI | General-purpose AI chat scoped to folder context |
| **Studying** | Study guide | Generate study guides from uploaded resources + topics |
| **Studying** | Quiz | Auto-generate or write-your-own quiz (Resources > Customize > Settings wizard) |
| **Studying** | Flashcards | Bite-sized study cards |
| **Homework** | Solve | Upload photo/file or paste problem text for step-by-step solutions |
| **Homework** | Write | Draft paragraphs or papers |
| **Notes** | Recording | Automatic lecture notes from audio |
| **Notes** | Notes | Detailed notes from any resource |

### Resource/Knowledge Input Methods
1. **From Knowledge** - Existing resources in the folder's knowledge base
2. **From link** - URL import
3. **From computer** - File upload

### Collaboration Model
- **Folders** = Shared workspaces (like a class or study group)
- **Members** = People invited to a folder via invite code
- **Knowledge** = Shared resources within a folder (all members can add/use)
- **Spaces** = Individual work items within a folder (Shared vs Private)
- Anonymous display names (e.g., "BlushSureMarsupial")
- Social proof: "Responses are 2x more powerful in folders with 5+ members"

### Sharing Model
- Spaces have **Public** toggle (shareable) vs Private
- Folders use invite codes for membership
- Members can contribute to shared knowledge base

### Free Tier Limitations
- Limited spaces per day (~2-3 before hitting paywall)
- Limited chats
- Limited uploads
- Resets daily (e.g., "More spaces tomorrow at 12:53 PM EDT")

### Key UX Patterns
- Dark mode by default
- Minimal, Apple-like design aesthetic (SF Symbols throughout)
- Single-purpose space creation (each tool = its own space)
- "Ask Atlas anything..." global search on home
- Folder > Space hierarchy (like Notion workspace > page)
- Resizable sidebar with drag handle
- Shared vs Private space categories in sidebar
- "Type / to reference resources" inline command pattern
- "Focused 0" button for resource scoping in chat
- Rich text editor for chat input
- Upload inline from chat (link or file)
- Mobile app promotion on home page
- Progressive disclosure (tools only shown when relevant)
- Aggressive free-to-paid conversion (paywall after 2-3 actions)

### Screenshots Captured
- 01_signin_page.png - Sign-in with Google/Apple/Phone/Email
- 02_otp_verification.png - 6-digit OTP code entry
- 03_onboarding_attribution.png - How did you hear about us
- 04_onboarding_student_type.png - University/High School/Other
- 05_onboarding_tutorial.png - Tutorial video page
- 06_main_workspace.png - Empty folder workspace
- 07_plus_menu.png - Create folder / Join invite code
- 08_account_menu.png - Account/Redeem/Logout
- 09_pro_upgrade.png - Pricing and feature comparison
- 10_knowledge_tools.png - All 8 space types in dialog
- 11_chat_interface.png - Chat with welcome message and tips
- 12_upload_options.png - From link / From computer
- 13_home_page.png - Home with recent spaces + folders
- 14_study_guide_creator.png - Resources + topics + generate
- 15_add_resource_options.png - Knowledge/Link/Computer
- 16_spaces_limit_reached.png - Free tier paywall
- 17_quiz_creator.png - Resource-based or custom quiz
- 18_quiz_add_resources.png - Multi-step wizard
- 19_solve_interface.png - Upload/Paste/Type problem
- 20_members_panel.png - Members + invite + social proof

---

## 3. Comparative Analysis

### Feature Comparison Matrix

| Feature | NotebookLM | Atlas |
|---------|-----------|-------|
| **Primary focus** | Research & content generation | Student homework & studying |
| **Source types** | PDF, images, docs, audio, websites, YouTube, Drive, text | Files, links, knowledge base |
| **AI Chat** | Yes (source-grounded) | Yes (folder-scoped) |
| **Study guides** | No (but Reports) | Yes (dedicated tool) |
| **Quizzes** | Yes (Studio) | Yes (dedicated tool with wizard) |
| **Flashcards** | Yes (Studio) | Yes (dedicated tool) |
| **Audio content** | Audio Overview (podcast), supports audio sources | Recording (lecture transcription) |
| **Video content** | Video Overview (AI presenter) | No |
| **Mind maps** | Yes | No |
| **Slide decks** | Yes | No |
| **Infographics** | Yes | No |
| **Data tables** | Yes | No |
| **Reports** | Yes | No |
| **Problem solver** | No (chat can solve) | Yes (dedicated Solve tool) |
| **Writing assistant** | No (chat can write) | Yes (dedicated Write tool) |
| **Note-taking** | Yes (convertible to source) | Yes (dedicated Notes tool) |
| **Collaboration** | Share with people/groups + public link | Folder-based with invite codes + members |
| **Custom AI persona** | Yes (3 modes + custom prompt) | No |
| **Source selection** | Checkbox per source | "Focused" resource scoping |
| **Research modes** | Fast Research + Deep Research | No |
| **Web search** | Yes (integrated) | No |
| **Mobile app** | No | Yes (iOS + Android) |
| **Pricing** | Free + Pro | Free (limited daily) + Pro $7.50-15.99/mo |

### UX/Design Patterns Worth Borrowing

#### From NotebookLM:
1. **3-panel persistent layout** - Sources | Chat | Studio. Allows simultaneous access to all core functions
2. **Source checkboxes** - Selectively include/exclude sources from AI context
3. **Auto-generated summaries** with bold key terms and topic tags
4. **Suggested questions** as clickable buttons after adding sources
5. **"Convert to source"** button on notes - seamless note-to-knowledge upgrade
6. **Chat configuration modes** (Default/Learning Guide/Custom) with custom prompt up to 10k chars
7. **Studio output persistence** - Generated content saved with timestamps and source counts
8. **Research modes** (Fast/Deep) for source discovery
9. **Source detail view** with AI-generated guide, topic tags, and full document text

#### From Atlas:
1. **Space-per-tool model** - Each task type gets its own dedicated interface (rather than being a mode within a chat)
2. **Folder > Space hierarchy** - Clean organizational model for courses/subjects
3. **"Ask Atlas anything..." global input** on home page
4. **"Type / to reference resources"** inline command for resource referencing in chat
5. **Onboarding attribution question** - Good product analytics practice
6. **Multi-step wizards** for complex tool setup (Quiz: Resources > Customize > Settings)
7. **Public/Private space toggle** - Simple sharing model
8. **Member social proof** ("2x more powerful with 5+ members") - Encourages collaboration
9. **Solve tool with photo upload** - Take a photo of a problem and get step-by-step solutions
10. **Daily limit reset with specific time** - Transparent free tier communication
11. **Anonymous display names** - Privacy-first for student use

### Key Architectural Differences

| Aspect | NotebookLM | Atlas |
|--------|-----------|-------|
| **Mental model** | Notebook = collection of sources with tools | Folder = class/group, Space = individual task |
| **Content creation** | All tools accessible from single workspace | Each tool creates its own space |
| **Source management** | Per-notebook sources with checkboxes | Per-folder knowledge base + per-space resources |
| **Collaboration** | Google Workspace-style sharing (email) | Invite code-based membership |
| **AI context** | All checked sources feed into chat | Folder knowledge + focused resources |
| **Output location** | Studio panel in same workspace | Each output is its own navigable space |

---

## 4. Implications for Budds Learning Compiler

### Validated Feature Set (both products have these)
- AI chat grounded in uploaded sources
- Quiz generation from learning materials
- Flashcard generation
- Study guide creation
- Note-taking with AI assistance
- File upload + URL/link import
- Sharing/collaboration features

### Differentiator Opportunities
1. **Compilation** - Neither product has a "learning compiler" that synthesizes multiple sources into a structured learning path
2. **Progress tracking** - Neither tracks learning progress or mastery across topics
3. **Adaptive learning** - Neither adjusts difficulty or content based on performance
4. **Curriculum mapping** - Neither maps content to formal curricula or learning objectives
5. **Peer learning** - Atlas has folders but neither has peer-to-peer teaching or discussion features
6. **Export/portability** - Neither makes it easy to export compiled knowledge to other formats
7. **Spaced repetition** - Neither implements evidence-based review scheduling
8. **Learning analytics** - Neither provides dashboards on study patterns or knowledge gaps

### Design Recommendations for Budds
1. Consider NotebookLM's 3-panel layout as a foundation for the main workspace
2. Adopt Atlas's space-per-tool model for dedicated learning activities (quiz, flashcards, etc.)
3. Implement source checkboxes (NotebookLM) for selective AI context
4. Use NotebookLM's chat configuration pattern for customizable AI tutoring personas
5. Borrow Atlas's folder hierarchy for organizing by course/subject
6. Add "Convert to source" (NotebookLM) for upgrading student notes into learning materials
7. Implement Atlas's "/" command pattern for referencing resources inline
8. Consider Atlas's public/private toggle for sharing individual study artifacts
