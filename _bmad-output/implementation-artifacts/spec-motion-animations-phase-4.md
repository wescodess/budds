---
title: 'Phase 4 Motion Animations — Micro-interactions'
type: 'feature'
created: '2026-04-19'
status: 'ready-for-dev'
context:
  - '_bmad-output/implementation-artifacts/animation-plan.md'
---

<frozen-after-approval>

## Intent

**Problem:** Empty state icons sit static, the theme toggle swaps icons with no flourish, the panel flip button has no visual feedback, and the dashboard empty state feels lifeless. These are small touches that collectively elevate perceived quality.

**Approach:** Add CSS-based floating idle animation to empty state icons, a rotation transition on theme toggle, a glow hover effect on the panel flip button, and a Motion entrance on the dashboard empty state. All CSS-only or single-component Motion wrappers — no deep framework changes.

## Boundaries & Constraints

**Always:**
- CSS-only for idle animations (no JS overhead for perpetual effects)
- Respect `prefers-reduced-motion` (already handled by Phase 3 CSS media query)

**Ask First:**
- Modifying Shadcn Sidebar internals

**Never:**
- Change theme toggle logic or behavior
- Touch ResizablePanel mechanics

</frozen-after-approval>

## Code Map

- `app/layouts/default.vue` -- theme toggle icon transition, empty state float, panel flip button glow
- `app/pages/app/folders/[id]/index.vue` -- empty state icons float, flip button glow
- `app/pages/index.vue` -- dashboard empty state Motion entrance
- `app/components/folder-shell/FolderShellRail.vue` -- voids empty state float
- `app/components/folder-shell/FolderShellFilesList.vue` -- files empty icon float
- `app/components/chat/DirectoryPicker.vue` -- documents empty icon float

## Tasks & Acceptance

**Execution:**
- [ ] `app/layouts/default.vue` -- add `animate-float-idle` to sidebar empty folder icon, add transition classes to theme Sun/Moon icons for rotation on swap
- [ ] `app/pages/app/folders/[id]/index.vue` -- add `animate-float-idle` to FileText empty state icons, add hover glow class to flip button
- [ ] `app/pages/index.vue` -- wrap dashboard empty state in Motion with gentle entrance
- [ ] `app/components/folder-shell/FolderShellRail.vue` -- add `animate-float-idle` to voids empty state
- [ ] `app/components/folder-shell/FolderShellFilesList.vue` -- add `animate-float-idle` to files empty icon
- [ ] `app/components/chat/DirectoryPicker.vue` -- add `animate-float-idle` to documents empty icon

**Acceptance Criteria:**
- Given an empty folder sidebar, when rendered, then the FolderOpen icon floats gently up and down
- Given the theme toggle is clicked, when icon swaps, then the new icon enters with a rotation
- Given the panel flip button is hovered, when the cursor is over it, then it shows a subtle glow
- Given the dashboard has no courses, when the empty state renders, then it fades in with a gentle spring

## Verification

**Commands:**
- `pnpm build` -- expected: passes
- `pnpm test` -- expected: existing tests pass
