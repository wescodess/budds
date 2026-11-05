---
status: accepted
---

# Allow labelled model knowledge as a teaching tier

This amends ADR-0007, which required atomic accepted-source support for all published teaching, feedback, and assessment, because that makes learning from an empty knowledge base impossible. Content now carries a visible provenance tier: T0 is an accepted source with entailment verified; T1 is fetched web content not yet accepted, attributed, and promotable to T0; T2 is model knowledge, labelled "not source-checked" and limited to analogies, examples, prerequisite bridges, practice prompts, and simulations. Answer keys, rubrics, measurement items, mastery decisions, and high-stakes facts stay T0 only: a concept with no accepted source can be taught but cannot award mastery. Model knowledge still never counts as evidence, and blending tiers without a label is forbidden. ADR-0007's deletion, tombstone, and attempt-preservation rules are unchanged.
