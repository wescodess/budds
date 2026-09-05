---
status: accepted
---

# Preserve legacy audio through versioned playback projections

The new Audio Overview model will be introduced through expand-and-contract migration: existing Convex-storage overviews remain playable and deletable through a version-1 projection, while new generation writes version-2 normalized records and R2 artifacts. Legacy media will not be bulk-copied merely for consistency; old generation paths are removed only after new generation is the default and production evidence shows no remaining callers.
