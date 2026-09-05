interface Env {
  /** Wrangler secret; keep out of wrangler.jsonc and Workflow state. */
  AUDIO_OVERVIEW_WORKER_TOKEN: string
  /** Wrangler secret used only by the Worker-owned managed Audio Renderer. */
  GEMINI_API_KEY: string
  /** Public origin of the Pages app; the Worker dev command binds localhost. */
  PAGES_BASE_URL: string
  /** Private R2 bucket for staged PCM Scenes and published WAV Audio Artifacts. */
  AUDIO_ARTIFACTS: R2Bucket
  /** Workers AI binding used for pre-acceptance Scene transcription evidence. */
  AI: Ai
}
