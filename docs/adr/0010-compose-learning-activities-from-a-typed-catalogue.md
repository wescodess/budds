---
status: accepted
---

# Compose learning activities from a typed catalogue on shadcn-vue

Dynamic Void content will be rendered from a versioned catalogue of typed lesson blocks and graded activities, implemented with the full shadcn-vue component library. The model fills bounded fields in those schemas; it never names components, writes markup, or defines actions, and answer keys stay on the server. Shell components such as dialogs and navigation are chosen by application code only. Every generated element must name the objective it serves. Sandboxed model-generated simulations may follow as a later, ungraded tier, served from a separate origin with a strict content security policy and no ability to write learner state, but only once the catalogue has shown a real gap. See `docs/research/learn-anything-activity-catalogue.md`.
