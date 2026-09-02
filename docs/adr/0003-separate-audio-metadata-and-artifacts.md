---
status: accepted
---

# Separate Audio Overview metadata from binary artifacts

Convex will own bounded, indexed Audio Overview, Generation Job, Source Manifest, Scene, Utterance, Alignment, and Interjection records, while private R2 objects hold new binary Audio Artifacts. This replaces nested growing arrays and caller-selected Convex storage cleanup with explicit ownership; the first production artifact is streamed lossless WAV assembled from the renderer's homogeneous PCM scenes, avoiding an additional transcoding service and invalid MP3 concatenation.
