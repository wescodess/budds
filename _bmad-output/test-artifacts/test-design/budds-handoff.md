---
title: 'TEA Test Design → BMAD Handoff Document'
version: '1.0'
workflowType: 'testarch-test-design-handoff'
inputDocuments:
  - _bmad-output/test-artifacts/test-design-architecture.md
  - _bmad-output/test-artifacts/test-design-qa.md
sourceWorkflow: 'testarch-test-design'
generatedBy: 'TEA Master Test Architect'
generatedAt: '2026-04-09'
projectName: 'budds'
---

# TEA → BMAD Integration Handoff

## Purpose

This document bridges TEA's test design outputs with BMAD's epic/story decomposition workflow (`create-epics-and-stories`). It provides structured integration guidance so that quality requirements, risk assessments, and test strategies flow into implementation planning.

## TEA Artifacts Inventory

| Artifact | Path | BMAD Integration Point |
|---|---|---|
| Architecture Test Design | `_bmad-output/test-artifacts/test-design-architecture.md` | Epic quality requirements, testability blockers |
| QA Test Design | `_bmad-output/test-artifacts/test-design-qa.md` | Story acceptance criteria, test coverage plan |
| Risk Assessment | (embedded in both documents) | Epic risk classification, story priority |
| Coverage Strategy | (embedded in QA document) | Story test requirements, P0-P2 mapping |

## Epic-Level Integration Guidance

### Risk References

Epics should reference these risks as quality gates:

| Epic | Key Risks | Quality Gate |
|---|---|---|
| Epic 1: App Foundation | R-04 (Auth bypass) | Auth redirect E2E test passes |
| Epic 2: Knowledge Organization | R-03 (Cascading deletion) | Folder cascade deletion test passes |
| Epic 3: Document Upload | R-01 (Isolation), R-02 (Ingestion), R-03 (Deletion) | Per-user isolation test passes; zero orphaned chunks |
| Epic 4: AI Chat | R-01 (Isolation), R-05 (AI Search availability) | Folder-scoped search with userId filter; graceful degradation |
| Epic 5: Data Privacy | R-03 (Cascading deletion) | Account deletion leaves zero records across all systems |
| Epic 6: Quiz Generation | R-01 (Isolation) | Quiz generation uses scoped search |
| Epic 7: Flash Card Generation | R-01 (Isolation) | Flash card generation uses scoped search |

### Quality Gates

| Gate | Criteria | Applies To |
|---|---|---|
| Per-user isolation | Zero cross-contamination in two-user integration test | Epics 3, 4, 6, 7 |
| Cascading deletion | Zero orphaned data across Convex + AI Search + file storage | Epics 2, 3, 5 |
| Accessibility | Zero critical axe-core violations on interactive components | Epics 1, 2, 4, 6, 7 |

## Story-Level Integration Guidance

### P0 Test Scenarios → Story Acceptance Criteria

These critical test scenarios MUST appear as acceptance criteria in their respective stories:

| Test ID | Scenario | Target Story | Acceptance Criterion |
|---|---|---|---|
| 3.2-INT-003 | User B search never returns User A docs | Story 3.2 | **Given** User A has uploaded documents, **When** User B performs a search, **Then** zero results from User A are returned |
| 3.3-INT-001 | Document deletion cascades all systems | Story 3.3 | **Given** a document is deleted, **When** deletion completes, **Then** zero chunks remain in AI Search AND zero files in Convex storage |
| 5.1-INT-001 | Account deletion cascades all systems | Story 5.1 | **Given** account deletion is confirmed, **Then** zero user records in Convex, zero chunks in AI Search, zero files in storage, zero rows in Better Auth |
| 3.1-INT-004 | Upload uses userId from session | Story 3.1 | **Given** a file upload request, **When** the server processes it, **Then** userId is extracted from Better Auth session, never from request body |
| 4.4-INT-001 | Chat persists across sessions | Story 4.4 | **Given** a user sends messages, **When** they close and reopen the browser, **Then** conversation and messages are preserved |

### Data-TestId Requirements

Stories involving UI components should include these `data-testid` attributes for testability:

| Component | Recommended data-testid | Story |
|---|---|---|
| FileUploadZone | `file-upload-zone`, `file-upload-input` | Story 3.1 |
| FileStatusItem | `file-status-{documentId}`, `file-status-icon` | Story 3.1 |
| FolderTree | `folder-tree`, `folder-item-{folderId}` | Story 2.1 |
| ChatMessage | `chat-message-{index}`, `citation-badge-{n}` | Story 4.1 |
| SourceCard | `source-card-{n}` | Story 4.1 |
| ModelSelector | `model-selector`, `model-option-{modelId}` | Story 4.3 |
| FlashCard | `flash-card`, `flash-card-front`, `flash-card-back` | Story 7.2 |
| QuizQuestion | `quiz-question-{index}`, `quiz-option-{index}` | Story 6.2 |

## Risk-to-Story Mapping

| Risk ID | Category | P x I | Recommended Story/Epic | Test Level |
|---|---|---|---|---|
| R-01 | SEC | 1 x 3 = 3 | Story 3.2 (isolation), Story 4.1 (chat scoping) | API |
| R-02 | TECH | 2 x 2 = 4 | Story 3.2 (ingestion pipeline) | API |
| R-03 | DATA | 2 x 3 = 6 | Story 3.3 (doc delete), Story 2.2 (folder delete), Story 5.1 (account delete) | API |
| R-04 | SEC | 1 x 3 = 3 | Story 1.1 (auth flow) | E2E |
| R-05 | OPS | 2 x 3 = 6 | Story 4.1 (chat), Story 4.2 (streaming) | API |
| R-06 | BUS | 2 x 2 = 4 | Story 4.3 (model selection) | API |
| R-07 | TECH | 3 x 1 = 3 | Story 3.2 (ingestion failure) | API |
| R-08 | TECH | 2 x 1 = 2 | Story 4.2 (streaming fallback) | API |
| R-09 | OPS | 1 x 3 = 3 | Cross-cutting (Convex dependency) | API |
| R-10 | BUS | 2 x 2 = 4 | Stories 2.1, 4.1, 6.2, 7.2 (custom components) | E2E |
| R-11 | OPS | 1 x 3 = 3 | Story 1.1 (auth storage) | API |
| R-12 | PERF | 2 x 2 = 4 | Story 4.1 (search quality) | API |

## Recommended BMAD → TEA Workflow Sequence

1. **TEA Test Design** (`TD`) → produces this handoff document
2. **BMAD Create Epics & Stories** → consumes this handoff, embeds quality requirements
3. **TEA ATDD** (`AT`) → generates acceptance tests per story
4. **BMAD Implementation** → developers implement with test-first guidance
5. **TEA Automate** (`TA`) → generates full test suite
6. **TEA Trace** (`TR`) → validates coverage completeness

## Phase Transition Quality Gates

| From Phase | To Phase | Gate Criteria |
|---|---|---|
| Test Design | Epic/Story Creation | All P0 risks have mitigation strategy |
| Epic/Story Creation | ATDD | Stories have acceptance criteria from test design |
| ATDD | Implementation | Failing acceptance tests exist for all P0 scenarios |
| Implementation | Test Automation | All acceptance tests pass |
| Test Automation | Release | Trace matrix shows >= 80% coverage of P0/P1 requirements |
