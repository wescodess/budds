<script setup lang="ts">
import { GripVertical, X, Plus } from '@lucide/vue'
import type { Id } from '../../../convex/_generated/dataModel'
import { api } from '#convex/api'
import { toast } from 'vue-sonner'

interface OutlineSection {
  title: string
  description: string
  knowledgeType: string
  order: number
}

interface SourceConfidence {
  docCount: number
  webPercent: number
}

interface SectionRow {
  _id: Id<'courseSections'>
  order: number
  title: string
  knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'mixed'
}

const props = defineProps<{
  courseId: Id<'courses'>
  outlineSections: OutlineSection[]
  sourceConfidence: SourceConfidence
  sourceType: 'folder' | 'web-only'
  sections: SectionRow[]
}>()

const emit = defineEmits<{
  sectionAdded: []
  sectionRemoved: []
}>()

const KNOWLEDGE_TYPES = ['factual', 'conceptual', 'procedural', 'mixed'] as const
type KnowledgeType = typeof KNOWLEDGE_TYPES[number]

const ssrStub = {
  mutate: async () => { throw new Error('Mutations are client-only') },
  isLoading: ref(false),
} as { mutate: (_args: any) => Promise<any>; isLoading: Ref<boolean> }

const updateTitleMutation = import.meta.client
  ? useConvexMutation(api.courseSections.updateTitle)
  : ssrStub

const updateKnowledgeTypeMutation = import.meta.client
  ? useConvexMutation(api.courseSections.updateKnowledgeType)
  : ssrStub

const removeMutation = import.meta.client
  ? useConvexMutation(api.courseSections.remove)
  : ssrStub

const createMutation = import.meta.client
  ? useConvexMutation(api.courseSections.create)
  : ssrStub

const updateOrderMutation = import.meta.client
  ? useConvexMutation(api.courseSections.updateOrder)
  : ssrStub

const editingId = ref<Id<'courseSections'> | null>(null)
const editingTitle = ref('')
const editInput = ref<HTMLInputElement | null>(null)
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

const sectionCount = computed(() => props.sections.length)

const sourceLabel = computed(() => {
  if (props.sourceType === 'web-only') return 'Built from web sources'
  const count = props.sourceConfidence.docCount
  return `Draws from ${count} of your document${count !== 1 ? 's' : ''}`
})

function startEdit(section: SectionRow) {
  editingId.value = section._id
  editingTitle.value = section.title
  nextTick(() => {
    const el = editInput.value
    if (el && typeof el.focus === 'function') el.focus()
  })
}

async function saveTitle(section: SectionRow) {
  if (!editingId.value || editingId.value !== section._id) return
  const newTitle = editingTitle.value.trim()
  editingId.value = null
  if (!newTitle || newTitle === section.title) return
  try {
    await updateTitleMutation.mutate({ sectionId: section._id, title: newTitle } as any)
  } catch (e: any) {
    toast.error(e?.message ?? 'Failed to update title')
  }
}

function cancelEdit() {
  editingId.value = null
  editingTitle.value = ''
}

function handleTitleKeydown(e: KeyboardEvent, section: SectionRow) {
  if (e.key === 'Enter') {
    e.preventDefault()
    saveTitle(section)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

function nextKnowledgeType(current: KnowledgeType): KnowledgeType {
  const idx = KNOWLEDGE_TYPES.indexOf(current)
  return KNOWLEDGE_TYPES[(idx + 1) % KNOWLEDGE_TYPES.length]!
}

async function cycleKnowledgeType(section: SectionRow) {
  const next = nextKnowledgeType(section.knowledgeType)
  try {
    await updateKnowledgeTypeMutation.mutate({
      sectionId: section._id,
      knowledgeType: next,
    } as any)
  } catch (e: any) {
    toast.error(e?.message ?? 'Failed to update knowledge type')
  }
}

async function removeSection(section: SectionRow) {
  try {
    await removeMutation.mutate({ sectionId: section._id } as any)
    emit('sectionRemoved')
  } catch (e: any) {
    toast.error(e?.message ?? 'Failed to remove section')
  }
}

async function addSection() {
  try {
    const newId = await createMutation.mutate({ courseId: props.courseId } as any)
    emit('sectionAdded')
    await nextTick()
    if (newId) {
      const newSection = props.sections.find((s) => s._id === newId)
      if (newSection) startEdit(newSection)
    }
  } catch (e: any) {
    toast.error(e?.message ?? 'Failed to add section')
  }
}

function onDragStart(index: number) {
  dragIndex.value = index
}

function onDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  dragOverIndex.value = index
}

function onDragLeave() {
  dragOverIndex.value = null
}

async function onDrop(targetIndex: number) {
  const fromIndex = dragIndex.value
  dragIndex.value = null
  dragOverIndex.value = null
  if (fromIndex === null || fromIndex === targetIndex) return

  const ids = props.sections.map((s) => s._id)
  const [moved] = ids.splice(fromIndex, 1)
  ids.splice(targetIndex, 0, moved!)
  try {
    await updateOrderMutation.mutate({ courseId: props.courseId, sectionIds: ids } as any)
  } catch (e: any) {
    toast.error(e?.message ?? 'Failed to reorder sections')
  }
}

function onDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}
</script>

<template>
  <div class="mx-auto w-full max-w-2xl px-4 py-6" data-testid="outline-editor">
    <div
      class="mb-6 rounded-lg bg-stone-800 px-4 py-3"
      data-testid="source-confidence"
    >
      <div class="flex items-center justify-between">
        <p class="text-sm text-stone-400">{{ sourceLabel }}</p>
        <span class="text-xs uppercase tracking-wide text-stone-500">source confidence</span>
      </div>
    </div>

    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-2xl font-bold text-stone-100">Course Outline</h2>
      <span
        class="rounded-md bg-stone-800 px-2.5 py-1 text-xs font-medium text-stone-400"
        data-testid="section-count-badge"
      >
        {{ sectionCount }} section{{ sectionCount !== 1 ? 's' : '' }}
      </span>
    </div>

    <div class="space-y-0">
      <div
        v-for="(section, index) in sections"
        :key="section._id"
        :draggable="editingId !== section._id"
        :class="[
          'group flex items-center gap-3 border-b border-stone-800 px-2 py-3 transition-colors',
          dragIndex === index ? 'opacity-40' : '',
          dragOverIndex === index ? 'border-t-2 border-t-amber-500' : '',
        ]"
        data-testid="section-row"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver($event, index)"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop(index)"
        @dragend="onDragEnd"
      >
        <GripVertical
          aria-hidden="true"
          class="h-4 w-4 shrink-0 cursor-grab text-stone-600 opacity-0 transition-opacity group-hover:opacity-100"
          data-testid="drag-handle"
        />

        <span class="w-6 shrink-0 text-center text-xs tabular-nums text-stone-500">
          {{ String(index + 1).padStart(2, '0') }}
        </span>

        <div class="min-w-0 flex-1">
          <input
            v-if="editingId === section._id"
            ref="editInput"
            v-model="editingTitle"
            aria-label="Section title"
            class="w-full rounded border border-stone-600 bg-stone-900 px-2 py-1 text-sm text-stone-100 outline-none focus:border-amber-500"
            data-testid="title-input"
            @blur="saveTitle(section)"
            @keydown="handleTitleKeydown($event, section)"
          >
          <button
            v-else
            class="w-full cursor-text text-left text-sm text-stone-100 hover:text-amber-400"
            data-testid="section-title"
            @click="startEdit(section)"
          >
            {{ section.title }}
          </button>
        </div>

        <button
          :aria-label="`Cycle knowledge type, currently ${section.knowledgeType}`"
          class="shrink-0 rounded bg-stone-800 px-2 py-0.5 text-xs uppercase tracking-wide text-stone-400 transition-colors hover:text-amber-400"
          data-testid="knowledge-type-badge"
          @click="cycleKnowledgeType(section)"
        >
          {{ section.knowledgeType }}
        </button>

        <button
          :aria-label="`Remove section ${section.title}`"
          class="shrink-0 text-stone-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
          data-testid="remove-button"
          @click="removeSection(section)"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>

    <button
      class="mt-4 flex items-center gap-1.5 text-sm font-medium text-amber-500 hover:text-amber-400"
      data-testid="add-section-button"
      @click="addSection"
    >
      <Plus class="h-4 w-4" />
      Add Section
    </button>
  </div>
</template>
