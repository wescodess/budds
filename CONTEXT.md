# Budds

Budds turns a learner's selected source material into grounded study experiences. This glossary names the product concepts shared by the Audio Overview experience, generation pipeline, persistence model, and implementation issues.

## Audio Overview language

**Audio Overview**:
A source-grounded, generated conversation between two stable Hosts that a learner can listen to, share, download, and discuss.
_Avoid_: Podcast as an internal model name, audio summary

**Host**:
One of the two persistent speaker identities in an Audio Overview.
_Avoid_: TTS voice, agent, narrator

**Audio Profile**:
A versioned definition of the two Hosts' voices and shared performance direction for an Audio Overview.
_Avoid_: Voice profile, voice pair, provider settings

**Source Manifest**:
The immutable set of owned source revisions authorized for one Generation Job.
_Avoid_: Folder context, retrieved chunks, source list

**Outline**:
The planned learning and narrative progression of an Audio Overview before dialogue is written.
_Avoid_: Summary, script plan

**Claim Ledger**:
The set of factual claims approved for a Dialogue Script, each linked to supporting entries in the Source Manifest.
_Avoid_: Citations, source indexes

**Dialogue Script**:
The complete source-grounded sequence of Scenes and Utterances approved for rendering.
_Avoid_: Transcript when referring to pre-render text, prompt output

**Scene**:
A coherent, jointly rendered portion of a Dialogue Script containing both Hosts and a bounded section of the narrative arc.
_Avoid_: Chunk, turn batch, audio part

**Utterance**:
One Host's bounded spoken contribution within a Scene, including its claim references and delivery intent.
_Avoid_: Turn, message, line

**Audio Renderer**:
The provider adapter that converts a Scene into two-host audio under an Audio Profile.
_Avoid_: TTS engine, voice API

**Audio Artifact**:
An immutable playable media object produced for an Audio Overview, Scene, or Interjection.
_Avoid_: Blob, audio file, storage ID

**Generation Job**:
The authoritative durable attempt that reserves usage, freezes a Source Manifest, and produces or fails to produce one Audio Overview revision.
_Avoid_: Task when referring to audio generation, request

**Quality Gate**:
A recorded decision that accepts or rejects a Dialogue Script, Scene, or Audio Artifact against grounding, duration, speaker, and media criteria.
_Avoid_: Validation when referring to the product decision

**Alignment**:
Versioned timing evidence that maps the known Utterances and words of a Dialogue Script onto its rendered Audio Artifact.
_Avoid_: Transcription, estimated timing

**Interjection**:
A private listener-session question and grounded audio response that temporarily pauses, then resumes, the immutable Audio Overview.
_Avoid_: Spliced turn, edited podcast, interruption record
