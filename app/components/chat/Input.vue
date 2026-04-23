<script setup lang="ts">
import { AlertCircle, Check, Crosshair, FolderTree, Headphones, LoaderCircle, Plus, Send, Link as LinkIcon, Upload } from 'lucide-vue-next'

function formatInterjectionTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
import type { Id } from '../../../convex/_generated/dataModel'
import type { AttachmentStatus } from '~/composables/useDocuments'
import type { ScopeChip, useReferenceScope } from '~/composables/useReferenceScope'
import { useGestureGuards } from '~/composables/useGestureGuards'

type PickerSelection =
  | { kind: 'folder'; id: Id<'folders'>; label: string }
  | { kind: 'file'; id: Id<'documents'>; label: string }

type ComposerMention = PickerSelection & {
  key: string
}

import type { InterjectionContext } from '~/composables/useChat'

const props = defineProps<{
  disabled?: boolean
  busy?: boolean
  attachmentStatus?: AttachmentStatus
  placeholder?: string
  folderId?: Id<'folders'>
  scope?: ReturnType<typeof useReferenceScope>
  interjectionContext?: InterjectionContext | null
}>()

const emit = defineEmits<{
  submit: [message: string]
  'upload-files': [files: File[]]
  'import-link': [url: string]
}>()

const editorRef = ref<HTMLDivElement | null>(null)
const editorWrapperRef = ref<HTMLDivElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const directoryPickerRef = ref<{ focusSearch: () => void } | null>(null)
const pickerOpen = ref(false)
const pickerMode = ref<'button' | 'mention'>('button')
const linkDialogOpen = ref(false)
const linkUrl = ref('')
const mentionAnchor = ref<{ left: number; top: number } | null>(null)
const mentionPlaceholderId = ref<string | null>(null)
const composerSubmitText = ref('')
const composerHasContent = ref(false)
const mentionCounts = ref(new Map<string, number>())
const { isTouchLike } = useGestureGuards()

let mentionPlaceholderSerial = 0

const attachmentBusy = computed(() => props.busy ?? false)
const hasScopeSelection = computed(() => props.scope?.hasSelection.value ?? false)
const showScopePicker = computed(() => Boolean(props.scope && props.folderId))
const resolvedFolderId = computed(() => props.folderId as Id<'folders'>)
const resolvedScope = computed(() => props.scope as ReturnType<typeof useReferenceScope>)
const canSubmit = computed(() => !props.disabled && composerSubmitText.value.trim().length > 0)
const resolvedAttachmentStatus = computed<AttachmentStatus>(() => {
  if (props.attachmentStatus) return props.attachmentStatus
  if (props.busy) {
    return {
      state: 'uploading',
      label: 'Documents uploading',
    }
  }
  return {
    state: 'idle',
    label: 'Add file from link or upload',
  }
})
const mentionAnchorStyle = computed(() =>
  mentionAnchor.value
    ? {
        left: `${mentionAnchor.value.left}px`,
        top: `${mentionAnchor.value.top}px`,
      }
    : undefined,
)
const pickerPresentation = computed<'popover' | 'drawer'>(() => isTouchLike.value ? 'drawer' : 'popover')
const shouldAutoFocusScopeSearch = computed(() => !isTouchLike.value || pickerMode.value === 'mention')
const attachmentIndicatorClass = computed(() => {
  if (resolvedAttachmentStatus.value.state === 'indexed') {
    return 'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700'
  }

  if (resolvedAttachmentStatus.value.state === 'error') {
    return 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive'
  }

  if (resolvedAttachmentStatus.value.state === 'processing') {
    return 'border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700'
  }

  if (resolvedAttachmentStatus.value.state === 'indexing') {
    return 'border-sky-500/40 text-sky-600 hover:bg-sky-500/10 hover:text-sky-700'
  }

  if (
    resolvedAttachmentStatus.value.state === 'uploading'
    || resolvedAttachmentStatus.value.state === 'importing'
  ) {
    return 'border-primary/40 text-primary hover:bg-primary/10 hover:text-primary'
  }

  return 'border-border text-muted-foreground hover:bg-accent/10 hover:text-foreground'
})
const attachmentBadgeClass = computed(() => {
  if (resolvedAttachmentStatus.value.state === 'indexed') return 'bg-emerald-600 text-white'
  if (resolvedAttachmentStatus.value.state === 'error') return 'bg-destructive text-destructive-foreground'
  if (resolvedAttachmentStatus.value.state === 'processing') return 'bg-amber-500 text-white'
  if (resolvedAttachmentStatus.value.state === 'indexing') return 'bg-sky-500 text-white'
  return 'bg-primary text-primary-foreground'
})
const attachmentPulseClass = computed(() =>
  resolvedAttachmentStatus.value.state === 'idle'
    ? ''
    : 'motion-safe:animate-pulse ring-1 ring-current/20',
)

function attachmentIconForState(state: AttachmentStatus['state']) {
  if (state === 'uploading' || state === 'importing' || state === 'processing' || state === 'indexing') {
    return LoaderCircle
  }
  if (state === 'indexed') return Check
  if (state === 'error') return AlertCircle
  return Plus
}

function getScopeChipKey(chip: Pick<ScopeChip, 'kind' | 'id'> | PickerSelection) {
  return `${chip.kind}:${chip.id}`
}

function getScopeChipByKey(key: string) {
  return props.scope?.chips.value.find(chip => getScopeChipKey(chip) === key)
}

function focus() {
  const editor = editorRef.value
  if (!editor) return

  editor.focus()

  const selection = window.getSelection()
  if (!selection) return
  if (selection.rangeCount > 0 && editor.contains(selection.anchorNode)) return

  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function placeCaretAfter(node: Node) {
  if (!node.parentNode) return
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function insertAtSelection(node: Node) {
  const editor = editorRef.value
  if (!editor) return null

  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : document.createRange()

  if (!selection?.rangeCount) {
    range.selectNodeContents(editor)
    range.collapse(false)
  }

  range.deleteContents()

  const lastInsertedNode = node instanceof DocumentFragment ? node.lastChild : node
  range.insertNode(node)

  if (lastInsertedNode) {
    placeCaretAfter(lastInsertedNode)
  }

  return lastInsertedNode
}

function createTextFragment(text: string) {
  const fragment = document.createDocumentFragment()
  const lines = text.split('\n')

  lines.forEach((line, index) => {
    if (line.length > 0) fragment.appendChild(document.createTextNode(line))
    if (index < lines.length - 1) fragment.appendChild(document.createElement('br'))
  })

  if (!fragment.lastChild) fragment.appendChild(document.createTextNode(''))
  return fragment
}

function createMentionPlaceholderElement(id: string) {
  const placeholder = document.createElement('span')
  placeholder.dataset.mentionPlaceholderId = id
  placeholder.contentEditable = 'false'
  placeholder.className = 'mx-0.5 inline-flex align-middle text-sm font-medium text-primary'
  placeholder.textContent = '@'
  return placeholder
}

function createMentionElement(mention: ComposerMention) {
  const token = document.createElement('span')
  token.dataset.mentionKey = mention.key
  token.dataset.mentionKind = mention.kind
  token.dataset.mentionId = mention.id
  token.dataset.mentionLabel = mention.label
  token.contentEditable = 'false'
  token.className = 'mx-0.5 my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2 py-1 align-middle text-xs text-foreground'

  const label = document.createElement('span')
  label.className = 'max-w-[16rem] truncate'
  label.textContent = mention.label

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.tabIndex = -1
  remove.dataset.mentionRemove = 'true'
  remove.setAttribute('aria-label', `Remove ${mention.label}`)
  remove.className = 'inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground'
  remove.textContent = '×'

  token.append(label, remove)
  return token
}

function serializeEditorContent() {
  const editor = editorRef.value
  const counts = new Map<string, number>()

  if (!editor) {
    return { submitText: '', counts }
  }

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? ''
    }

    if (!(node instanceof HTMLElement)) return ''

    if (node.dataset.mentionKey) {
      const key = node.dataset.mentionKey
      counts.set(key, (counts.get(key) ?? 0) + 1)
      return node.dataset.mentionLabel ?? ''
    }

    if (node.dataset.mentionPlaceholderId) return ''
    if (node.tagName === 'BR') return '\n'

    return Array.from(node.childNodes).map(walk).join('')
  }

  return {
    submitText: Array.from(editor.childNodes).map(walk).join(''),
    counts,
  }
}

function syncComposerState({ reconcileScope = false }: { reconcileScope?: boolean } = {}) {
  const previousCounts = new Map(mentionCounts.value)
  const next = serializeEditorContent()

  composerSubmitText.value = next.submitText
  composerHasContent.value = next.submitText.trim().length > 0
  mentionCounts.value = next.counts

  if (!reconcileScope) return

  for (const [key, previousCount] of previousCounts.entries()) {
    if (previousCount > 0 && !next.counts.has(key)) {
      const chip = getScopeChipByKey(key)
      if (chip) props.scope?.removeChip(chip)
    }
  }
}

function removeMentionElementsByKey(key: string) {
  const editor = editorRef.value
  if (!editor) return false

  const mentions = Array.from(editor.querySelectorAll<HTMLElement>('[data-mention-key]'))
    .filter(node => node.dataset.mentionKey === key)

  if (mentions.length === 0) return false
  mentions.forEach(node => node.remove())
  return true
}

function clearMentionContext() {
  mentionPlaceholderId.value = null
  mentionAnchor.value = null
  pickerMode.value = 'button'
}

function cleanupMentionPlaceholder() {
  const editor = editorRef.value
  const placeholderId = mentionPlaceholderId.value
  if (!editor || !placeholderId) return

  const placeholder = Array.from(editor.querySelectorAll<HTMLElement>('[data-mention-placeholder-id]'))
    .find(node => node.dataset.mentionPlaceholderId === placeholderId)

  placeholder?.remove()
  syncComposerState()
}

function updateMentionAnchorFromPlaceholder() {
  const editor = editorRef.value
  const wrapper = editorWrapperRef.value
  const placeholderId = mentionPlaceholderId.value
  if (!editor || !wrapper || !placeholderId) return

  const placeholder = Array.from(editor.querySelectorAll<HTMLElement>('[data-mention-placeholder-id]'))
    .find(node => node.dataset.mentionPlaceholderId === placeholderId)
  if (!placeholder) return

  const wrapperRect = wrapper.getBoundingClientRect()
  const rect = placeholder.getBoundingClientRect()

  mentionAnchor.value = {
    left: Math.max(12, rect.left - wrapperRect.left + rect.width / 2),
    top: Math.max(10, rect.top - wrapperRect.top + rect.height / 2),
  }
}

function openPickerFromButton() {
  cleanupMentionPlaceholder()
  clearMentionContext()
  pickerMode.value = 'button'
}

function openPickerFromMention() {
  if (!showScopePicker.value || props.disabled) return

  focus()
  cleanupMentionPlaceholder()

  const placeholderId = `mention-placeholder-${++mentionPlaceholderSerial}`
  mentionPlaceholderId.value = placeholderId
  pickerMode.value = 'mention'

  const placeholder = createMentionPlaceholderElement(placeholderId)
  insertAtSelection(placeholder)
  syncComposerState()

  nextTick(() => {
    updateMentionAnchorFromPlaceholder()
    pickerOpen.value = true
  })
}

function insertMentionToken(item: PickerSelection) {
  const editor = editorRef.value
  const placeholderId = mentionPlaceholderId.value
  if (!editor || !placeholderId) return

  const placeholder = Array.from(editor.querySelectorAll<HTMLElement>('[data-mention-placeholder-id]'))
    .find(node => node.dataset.mentionPlaceholderId === placeholderId)
  if (!placeholder) return

  const mention: ComposerMention = {
    ...item,
    key: getScopeChipKey(item),
  }
  const token = createMentionElement(mention)
  placeholder.replaceWith(token)

  syncComposerState()
  clearMentionContext()

  nextTick(() => {
    focus()
    placeCaretAfter(token)
  })
}

function handlePickerSelect(item: PickerSelection) {
  if (pickerMode.value === 'mention') {
    insertMentionToken(item)
    pickerOpen.value = false
    return
  }

  nextTick(() => directoryPickerRef.value?.focusSearch())
}

function handleSubmit() {
  const trimmed = composerSubmitText.value.trim()
  if (!trimmed) return

  emit('submit', trimmed)

  if (editorRef.value) editorRef.value.innerHTML = ''
  syncComposerState()
  clearMentionContext()

  nextTick(() => focus())
}

function handleFilesSelected(event: Event) {
  const inputEl = event.target as HTMLInputElement | null
  const files = Array.from(inputEl?.files ?? [])
  if (files.length === 0) return

  emit('upload-files', files)
  if (inputEl) inputEl.value = ''
}

function handleImportLink() {
  const trimmed = linkUrl.value.trim()
  if (!trimmed) return

  emit('import-link', trimmed)
  linkUrl.value = ''
  linkDialogOpen.value = false
  nextTick(() => focus())
}

function handleEditorInput() {
  syncComposerState({ reconcileScope: true })
  updateMentionAnchorFromPlaceholder()
}

function handleEditorPaste(event: ClipboardEvent) {
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!text) return

  insertAtSelection(createTextFragment(text))
  syncComposerState({ reconcileScope: true })
}

function handleEditorClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const removeButton = target?.closest<HTMLElement>('[data-mention-remove]')
  if (!removeButton) return

  event.preventDefault()

  const token = removeButton.closest<HTMLElement>('[data-mention-key]')
  const key = token?.dataset.mentionKey
  if (!key) return

  removeMentionElementsByKey(key)
  syncComposerState()

  const chip = getScopeChipByKey(key)
  if (chip) props.scope?.removeChip(chip)

  nextTick(() => focus())
}

function handleEditorKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSubmit()
    return
  }

  if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault()
    insertAtSelection(createTextFragment('\n'))
    syncComposerState({ reconcileScope: true })
    return
  }

  if (
    event.key === '@'
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && showScopePicker.value
  ) {
    event.preventDefault()
    openPickerFromMention()
  }
}

watch(
  () => props.scope?.chips.value.map(chip => getScopeChipKey(chip)) ?? [],
  (keys) => {
    const allowed = new Set(keys)
    const editor = editorRef.value
    if (!editor) return

    let removedAny = false
    for (const mention of Array.from(editor.querySelectorAll<HTMLElement>('[data-mention-key]'))) {
      const key = mention.dataset.mentionKey
      if (!key || allowed.has(key)) continue
      mention.remove()
      removedAny = true
    }

    if (removedAny) syncComposerState()
  },
  { immediate: true },
)

watch(pickerOpen, (open) => {
  if (open) return

  if (pickerMode.value === 'mention' && mentionPlaceholderId.value) {
    cleanupMentionPlaceholder()
    nextTick(() => focus())
  }

  clearMentionContext()
})

onMounted(() => {
  syncComposerState()
})

defineExpose({ focus })
</script>

<template>
  <div class="border-t px-3 py-3 sm:p-4">
    <div
      v-if="props.interjectionContext"
      data-testid="chat-interjection-chip"
      class="pb-2"
    >
      <span class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-inter text-[11px] text-primary">
        <Headphones class="h-3 w-3" />
        Re: {{ formatInterjectionTime(props.interjectionContext.timeMs) }} · "{{ props.interjectionContext.quotedText.slice(0, 60) }}{{ props.interjectionContext.quotedText.length > 60 ? '…' : '' }}"
      </span>
    </div>
    <ChatReferenceScopeStrip v-if="props.scope" :scope="props.scope" />
    <div
      v-if="props.scope && !hasScopeSelection"
      data-testid="chat-scope-default-chip"
      class="pb-2"
    >
      <span class="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-2.5 py-1 font-inter text-[11px] text-muted-foreground">
        <FolderTree class="h-3 w-3" />
        All docs · folder + subfolders
      </span>
    </div>

    <div class="relative flex items-end gap-1.5 sm:gap-2" data-gesture-owner="chat-input">
      <UiDropdownMenu v-if="props.folderId">
        <UiDropdownMenuTrigger as-child>
          <button
            type="button"
            :aria-label="resolvedAttachmentStatus.label"
            :title="resolvedAttachmentStatus.label"
            :disabled="attachmentBusy"
            :class="[attachmentIndicatorClass, attachmentPulseClass]"
            class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:h-9 sm:w-9"
          >
            <component
              :is="attachmentIconForState(resolvedAttachmentStatus.state)"
              class="h-4 w-4"
              :class="['motion-safe:transition-transform', (
                resolvedAttachmentStatus.state === 'uploading'
                || resolvedAttachmentStatus.state === 'importing'
                || resolvedAttachmentStatus.state === 'processing'
                || resolvedAttachmentStatus.state === 'indexing'
              ) ? 'animate-spin' : '']"
            />
            <span
              v-if="resolvedAttachmentStatus.count"
              :class="attachmentBadgeClass"
              class="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
            >
              {{ resolvedAttachmentStatus.count }}
            </span>
          </button>
        </UiDropdownMenuTrigger>
        <UiDropdownMenuContent align="start" class="w-44">
          <UiDropdownMenuItem @click="linkDialogOpen = true">
            <LinkIcon class="mr-2 h-4 w-4" />
            From link
          </UiDropdownMenuItem>
          <UiDropdownMenuItem @click="fileInputRef?.click()">
            <Upload class="mr-2 h-4 w-4" />
            From computer
          </UiDropdownMenuItem>
        </UiDropdownMenuContent>
      </UiDropdownMenu>

      <input
        v-if="props.folderId"
        ref="fileInputRef"
        type="file"
        accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,text/plain,.txt,text/markdown,.md,text/csv,.csv,text/html,.html,image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp,image/gif,.gif"
        multiple
        class="hidden"
        @change="handleFilesSelected"
      >

      <template v-if="showScopePicker && pickerPresentation === 'popover'">
        <UiPopover v-model:open="pickerOpen">
          <UiPopoverAnchor v-if="pickerMode === 'mention' && mentionAnchorStyle" as-child>
            <span
              class="pointer-events-none absolute z-10 block h-px w-px"
              :style="mentionAnchorStyle"
            />
          </UiPopoverAnchor>

          <UiPopoverTrigger as-child>
            <button
              type="button"
              :aria-label="hasScopeSelection ? 'Update directory references' : 'Open directory references'"
              :data-active="hasScopeSelection || undefined"
              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-active:border-primary data-active:text-primary sm:h-9 sm:w-9"
              @click="openPickerFromButton"
            >
              <Crosshair class="h-4 w-4 shrink-0" />
            </button>
          </UiPopoverTrigger>

          <UiPopoverContent side="top" align="start" :side-offset="10" class="w-auto border-none bg-transparent p-0 shadow-none">
            <ChatDirectoryPicker
              ref="directoryPickerRef"
              :folder-id="resolvedFolderId"
              :scope="resolvedScope"
              :presentation="pickerPresentation"
              :auto-focus-search="shouldAutoFocusScopeSearch"
              @select="handlePickerSelect"
              @close="pickerOpen = false"
            />
          </UiPopoverContent>
        </UiPopover>
      </template>

      <template v-else-if="showScopePicker">
        <UiDrawer v-model:open="pickerOpen">
          <UiDrawerTrigger as-child>
            <button
              type="button"
              :aria-label="hasScopeSelection ? 'Update directory references' : 'Open directory references'"
              :data-active="hasScopeSelection || undefined"
              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-active:border-primary data-active:text-primary sm:h-9 sm:w-9"
              @click="openPickerFromButton"
            >
              <Crosshair class="h-4 w-4 shrink-0" />
            </button>
          </UiDrawerTrigger>

          <UiDrawerContent data-testid="directory-picker-drawer" class="gap-0 p-0">
            <ChatDirectoryPicker
              ref="directoryPickerRef"
              :folder-id="resolvedFolderId"
              :scope="resolvedScope"
              :presentation="pickerPresentation"
              :auto-focus-search="shouldAutoFocusScopeSearch"
              @select="handlePickerSelect"
              @close="pickerOpen = false"
            />
          </UiDrawerContent>
        </UiDrawer>
      </template>

      <div ref="editorWrapperRef" class="relative min-w-0 flex-1">
        <div
          class="relative min-h-8 w-full rounded-xl border bg-background ring-offset-background transition-colors focus-within:ring-2 focus-within:ring-ring sm:min-h-9"
        >
          <div
            v-if="!composerHasContent && !mentionPlaceholderId"
            class="pointer-events-none absolute inset-x-2.5 top-1.5 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted-foreground sm:inset-x-3 sm:top-2"
          >
            {{ placeholder ?? 'Ask a question...' }}
          </div>

          <div
            ref="editorRef"
            data-testid="chat-composer-editor"
            role="textbox"
            aria-multiline="true"
            :aria-disabled="disabled ? 'true' : 'false'"
            :contenteditable="disabled ? 'false' : 'true'"
            :class="disabled ? 'pointer-events-none opacity-50' : ''"
            inputmode="text"
            enterkeyhint="send"
            autocapitalize="sentences"
            autocorrect="on"
            spellcheck="true"
            class="max-h-24 min-h-8 w-full overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-1.5 text-sm text-foreground outline-none sm:min-h-9 sm:px-3 sm:py-2"
            @input="handleEditorInput"
            @keydown="handleEditorKeydown"
            @paste="handleEditorPaste"
            @click="handleEditorClick"
          />
        </div>
      </div>

      <button
        data-testid="chat-send-button"
        :disabled="!canSubmit"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 sm:h-9 sm:w-9"
        @click="handleSubmit"
      >
        <Send class="h-4 w-4" />
      </button>
    </div>

    <UiDialog v-model:open="linkDialogOpen">
      <UiDialogContent>
        <UiDialogHeader>
          <UiDialogTitle>Add from link</UiDialogTitle>
          <UiDialogDescription>
            Paste a URL to import — websites, YouTube videos, and direct file links are all supported.
          </UiDialogDescription>
        </UiDialogHeader>

        <div class="space-y-3">
          <input
            v-model="linkUrl"
            type="url"
            placeholder="https://example.com/article or YouTube link"
            inputmode="url"
            enterkeyhint="done"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            autocomplete="url"
            class="w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @keydown.enter.prevent="handleImportLink"
          >
          <div class="flex justify-end gap-2">
            <UiButton variant="outline" @click="linkDialogOpen = false">
              Cancel
            </UiButton>
            <UiButton :disabled="attachmentBusy || !linkUrl.trim()" @click="handleImportLink">
              Add link
            </UiButton>
          </div>
        </div>
      </UiDialogContent>
    </UiDialog>
  </div>
</template>
