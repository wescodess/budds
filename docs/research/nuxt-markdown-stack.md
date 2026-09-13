# Nuxt Markdown Stack Research

Date: 2026-04-14

## Scope

This note documents the markdown rendering stack currently used in this repo, the official docs and package behavior that matter for custom inline citations, and the most likely reasons chat answers still show literal `(Source N)` labels instead of only rendered citation badges.

## Repo-Verified Stack

From local source:

- `nuxt.config.ts` enables `@nuxtjs/mdc` with prose components turned on.
- `package.json` pins `@nuxtjs/mdc` `^0.21.1`.
- `pnpm-lock.yaml` resolves the current parser stack to:
  - `remark-mdc` `3.10.0`
  - `remark-gfm` `4.0.1`
  - `remark-parse` `11.0.0`
  - `remark-rehype` `11.1.2`
  - `rehype-raw` `7.0.0`
  - `rehype-external-links` `3.0.0`

From generated Nuxt files:

- `.nuxt/mdc-imports.mjs` injects app-level MDC plugins:
  - `remark-emoji`
  - syntax highlighting via Nuxt's rehype highlighter
- `.nuxt/mdc-configs.mjs` is effectively empty in this repo, so there is no custom parser config layer changing the default MDC pipeline.

From `node_modules/@nuxtjs/mdc` source:

- `MDC.vue` parses a markdown string with `parseMarkdown()` and renders the result with `MDCRenderer`.
- `createParseProcessor()` builds the pipeline in this order:
  1. `remark-parse`
  2. any config-provided remark hooks
  3. default + app-supplied remark plugins
  4. `remark-rehype`
  5. any config-provided rehype hooks
  6. default + app-supplied rehype plugins
  7. MDC HAST compiler
- Default parser options include:
  - `remark-mdc`
  - `remark-gfm`
  - `remark-rehype` with `allowDangerousHtml: true`
  - `rehype-raw`
  - `rehype-external-links`
  - attribute sorting plugins

## Repo Citation Flow

The chat renderer is not using Nuxt Content files. It is using runtime MDC rendering:

- [`app/components/chat/Message.vue`](../../app/components/chat/Message.vue)
  - Assistant messages go through `expandCitations()`.
  - The processed string is rendered with `<MDC :value="processedContent" />`.
- [`app/utils/expand-citations.ts`](../../app/utils/expand-citations.ts)
  - Rewrites `[1]` into `:citation[1]{index="1"}`.
- [`app/components/global/Citation.vue`](../../app/components/global/Citation.vue)
  - Wraps `ChatCitationBadge`.
  - Reads source data from `provide/inject`.
- `nuxt.config.ts`
  - Registers `~/components/global` as global components.

## Local Parser Experiments

I ran `parseMarkdown()` locally against representative strings.

Observed behavior:

- `:citation[1]{index="1"}` parses to an MDC element with:
  - `tag: "citation"`
  - `props.index: "1"`
- `Alpha :citation[1]{index="1"} beta` parses to a paragraph containing a real `citation` element between text nodes.
- `[1]` does **not** parse as a custom citation component.
- `[1]` becomes a generic inline span-like node, which matches the documented MDC `[]` span syntax.

Implication:

- The preprocessor in `expand-citations.ts` is necessary.
- Raw bracketed numbers are not enough for MDC to infer a custom citation component.

## Official Documentation Findings

Nuxt Content markdown docs:

- Components used in markdown must be global if they are not placed in `components/content/`.
- MDC inline components use single-colon syntax such as `:component` or `:component[text]{props}`.
- Attribute syntax on normal markdown also uses `[]` plus `{}`.

`remark-mdc` docs:

- Single `:` defines inline components.
- `[]` defines inline span content.
- `{}` directly after a component or markdown element defines props/attributes.
- Inline components can be forced to stop before punctuation by using an empty props block like `:hello{}-world`.

`@nuxtjs/mdc` docs and source:

- `MDCRenderer` resolves custom tags by `pascalCase(tag)`.
- The runtime component map is merged in this order:
  1. prose component map
  2. `mdc.components.map`
  3. parsed document `data.mdc.components`
  4. `components` prop passed directly to `MDCRenderer`

`remark-rehype` and `rehype-raw` docs:

- `remark-rehype` is the mdast to hast bridge.
- Raw HTML support requires both `allowDangerousHtml: true` and `rehype-raw`.
- That is exactly what MDC enables by default, which is useful for rich markdown but important when rendering untrusted content.

## Why `Citation.vue` Is Probably Not the Primary Bug

Several facts point away from component registration as the first failure:

- `Citation.vue` is in `app/components/global`, which Nuxt registers globally in this repo.
- `.nuxt/components.d.ts` includes `Citation`.
- `MDCRenderer` resolves `citation` by `pascalCase("citation")`, which becomes `Citation`.
- The parser already produces a real `citation` node when given the expanded syntax.

That means the parser and the basic runtime resolution path look valid.

## Most Likely Current Failure Modes

### 1. Model output is still including literal source labels

The chat system prompt currently says:

- use inline numbered references like `[1]`, `[2]`

But it does **not** also say:

- do not emit `(Source 1)` or `(Source 2)`
- do not emit a trailing "References" section
- do not restate source labels copied from the retrieval context

The retrieval context itself is formatted like:

- `[Source 1: filename.pdf]`

So the model is being shown source labels in prose form, but only weakly instructed on the output format. If it echoes those labels into the answer, the client currently does nothing to normalize or remove them.

### 2. The client only upgrades `[N]`, not `(Source N)`

`expandCitations.ts` only transforms bracketed numeric citations:

- `[1]` -> `:citation[1]{index="1"}`

It does not transform:

- `(Source 1)`
- `Source 1`
- `References: ...`

So even if the inline badges are working, any literal source wording from the model will remain visible.

### 3. There is no explicit `citation` component map

This is probably not the main bug, but it is still a determinism gap. The current setup relies on global auto-registration and pascal-case resolution. That should work, but an explicit map would remove ambiguity:

- `mdc.components.map.citation = 'Citation'`
- or `:components="{ citation: Citation }"` when rendering

## Recommended Next Implementation Step

Before changing the UI layout:

1. Tighten the RAG chat system prompt.
2. Add a normalization layer for model outputs.
3. Add an explicit MDC component mapping for `citation` if we want deterministic resolution instead of relying on auto-imports.

The minimum practical change set is:

1. Server prompt:
   - require only `[N]` citations
   - forbid `(Source N)` and trailing reference lists
2. Client normalization:
   - convert `(Source N)` to `[N]` before `expandCitations()`
   - optionally strip a redundant "References" heading if the answer includes one
3. Test coverage:
   - assistant message renders `[1]`
   - assistant message renders `(Source 1)` after normalization
   - assistant message with both forms does not double-render badges

## Notes On Testing

I attempted to run the component chat-message test file directly, but the test harness fails before execution with:

- `DOMException [DataCloneError]: #<Object> could not be cloned.`

This is coming from `@nuxt/test-utils` during config cloning, not from MDC itself, so it is a separate issue from the markdown research.

## Source Links

Official docs and package references used for this research:

- Nuxt Content Markdown docs: https://content.nuxt.com/docs/files/markdown
- Nuxt Content Prose Components docs: https://content.nuxt.com/docs/components/prose
- `@nuxtjs/mdc` README: https://github.com/nuxt-content/mdc
- `remark-mdc` README: https://github.com/nuxt-content/mdc/tree/main/packages/remark-mdc
- `remark-rehype` README: https://github.com/remarkjs/remark-rehype
- `rehype-raw` README: https://github.com/rehypejs/rehype-raw
- `remark-parse` README: https://github.com/remarkjs/remark/tree/main/packages/remark-parse
- `remark-gfm` README: https://github.com/remarkjs/remark-gfm
- `rehype-external-links` README: https://github.com/rehypejs/rehype-external-links
- `unified` docs: https://github.com/unifiedjs/unified
