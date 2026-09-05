# Domain docs

Budds uses a single-context domain-doc layout.

## Before exploring

Read these resources when they exist and are relevant:

- `CONTEXT.md` at the repository root.
- ADRs under `docs/adr/`.

Proceed silently when either resource is absent. Create domain files lazily only when terminology or a durable architectural decision is actually resolved.

## Vocabulary

Use the canonical terms defined in `CONTEXT.md` in issue titles, specifications, code, tests, and documentation. Avoid synonyms that the glossary explicitly rejects. If a required concept is missing, reconsider whether it already has a repository term before extending the glossary.

## ADR conflicts

Surface any contradiction with an existing ADR explicitly. Do not silently override an accepted decision.
