<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { computed, ref, watch } from 'vue'
import { z } from 'zod'
import { Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { DEFAULT_COLOR_KEY, FOLDER_COLOR_KEYS, getColor } from '~~/convex/folderPalette'
import { DEFAULT_ICON_KEY, FOLDER_ICON_KEYS } from '~~/convex/folderIcons'
import type { Doc, Id } from '~~/convex/_generated/dataModel'
import { useGestureGuards } from '~/composables/useGestureGuards'

type Mode = 'create' | 'edit'

const props = defineProps<{
  open: boolean
  mode: Mode
  parentId?: Id<'folders'>
  folder?: Doc<'folders'> | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  created: [id: Id<'folders'>]
  updated: [id: Id<'folders'>]
  deleted: [id: Id<'folders'>]
}>()

const { createFolder, createSubfolder, updateFolder, deleteFolder } = useFolders()

const folderSchema = toTypedSchema(
  z.object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Max 100 characters'),
    description: z.string().max(280, 'Max 280 characters').optional().default(''),
    color: z
      .string()
      .refine((v) => FOLDER_COLOR_KEYS.includes(v), 'Invalid color'),
    icon: z
      .string()
      .refine((v) => FOLDER_ICON_KEYS.includes(v), 'Invalid icon'),
  }),
)

function computeInitialValues() {
  return {
    name: props.folder?.name ?? '',
    description: props.folder?.description ?? '',
    color: props.folder?.color ?? DEFAULT_COLOR_KEY,
    icon: props.folder?.icon ?? DEFAULT_ICON_KEY,
  }
}

const { handleSubmit, resetForm, values, setFieldValue, errors, isSubmitting, defineField } = useForm({
  validationSchema: folderSchema,
  initialValues: computeInitialValues(),
})

const [name] = defineField('name')
const [description] = defineField('description')

defineExpose({ getFormValues: () => ({ ...values }) })

const showDeleteConfirm = ref(false)
const isDeleting = ref(false)
const nameInputRef = ref<HTMLInputElement | null>(null)
const { isTouchLike } = useGestureGuards()

const selectedColorHex = computed(() => getColor(values.color || DEFAULT_COLOR_KEY).hex)

watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      resetForm({ values: computeInitialValues() })
      if (!isTouchLike.value) {
        nextTick(() => {
          nameInputRef.value?.focus()
        })
      }
    }
  },
)

watch(
  () => props.folder?._id,
  (id, prevId) => {
    if (props.open && id !== prevId) {
      resetForm({ values: computeInitialValues() })
    }
  },
)

function unwrapErrorMessage(err: any): string {
  if (err?.data?.message && typeof err.data.message === 'string') return err.data.message
  const raw = typeof err?.message === 'string' ? err.message : ''
  return raw
    .replace(/^\[CONVEX [^\]]+\]\s*/, '')
    .replace(/^ConvexError:\s*/, '')
    .trim()
}

function closeModal() {
  emit('update:open', false)
}

const onSubmit = handleSubmit(async (formValues) => {
  try {
    if (props.mode === 'create') {
      if (props.parentId) {
        await createSubfolder({
          name: formValues.name,
          description: formValues.description,
          color: formValues.color,
          icon: formValues.icon,
          parentId: props.parentId,
        })
      } else {
        await createFolder({
          name: formValues.name,
          description: formValues.description,
          color: formValues.color,
          icon: formValues.icon,
        })
      }
      toast.success('Folder created')
    } else if (props.folder) {
      await updateFolder(props.folder._id, {
        name: formValues.name,
        description: formValues.description,
        color: formValues.color,
        icon: formValues.icon,
      })
      toast.success('Folder updated')
      emit('updated', props.folder._id)
    }
    closeModal()
  } catch (e: any) {
    toast.error(unwrapErrorMessage(e) || 'Something went wrong')
  }
})

async function confirmDelete() {
  if (!props.folder || isDeleting.value) return
  isDeleting.value = true
  try {
    await deleteFolder(props.folder._id)
    toast.success('Folder deleted')
    emit('deleted', props.folder._id)
    showDeleteConfirm.value = false
    closeModal()
  } catch (e: any) {
    toast.error(unwrapErrorMessage(e) || 'Failed to delete folder')
  } finally {
    isDeleting.value = false
  }
}

function handleColor(value: string) {
  setFieldValue('color', value)
}

function handleIcon(value: string) {
  setFieldValue('icon', value)
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="(val) => emit('update:open', val)">
    <UiDialogContent data-testid="folder-form-modal" class="max-w-[calc(100%-1rem)] p-4 sm:max-w-md sm:p-6">
      <UiDialogHeader>
        <UiDialogTitle>
          {{ props.mode === 'create' ? 'New folder' : 'Edit folder' }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ props.mode === 'create'
            ? 'Give your folder a name, color, and icon so you can spot it quickly.'
            : 'Update the name, description, color, or icon.' }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form class="grid gap-4" @submit.prevent="onSubmit">
        <div class="grid gap-1.5">
          <UiLabel for="folder-name">Name</UiLabel>
          <input
            id="folder-name"
            ref="nameInputRef"
            v-model="name"
            type="text"
            data-slot="input"
            data-testid="folder-name-input"
            placeholder="Quantum Physics"
            autocapitalize="words"
            enterkeyhint="next"
            :aria-invalid="!!errors.name"
            :class="[
              'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-xl border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
              'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
            ]"
          />
          <p v-if="errors.name" class="text-xs text-destructive" data-testid="folder-name-error">
            {{ errors.name }}
          </p>
        </div>

        <div class="grid gap-1.5">
          <UiLabel for="folder-description">Description <span class="text-xs text-muted-foreground">(optional)</span></UiLabel>
          <textarea
            id="folder-description"
            v-model="description"
            data-slot="textarea"
            data-testid="folder-description-input"
            placeholder="What's inside?"
            rows="2"
            autocapitalize="sentences"
            autocorrect="on"
            spellcheck="true"
            enterkeyhint="done"
            :aria-invalid="!!errors.description"
            :class="[
              'placeholder:text-muted-foreground border-input field-sizing-content min-h-16 w-full rounded-xl border bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
              'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
            ]"
          />
          <p v-if="errors.description" class="text-xs text-destructive">
            {{ errors.description }}
          </p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="grid gap-1.5">
            <UiLabel>Color</UiLabel>
            <FoldersColorSelect
              :model-value="values.color || DEFAULT_COLOR_KEY"
              @update:model-value="handleColor"
            />
          </div>
          <div class="grid gap-1.5">
            <UiLabel>Icon</UiLabel>
            <FoldersIconSelect
              :model-value="values.icon || DEFAULT_ICON_KEY"
              :color-hex="selectedColorHex"
              @update:model-value="handleIcon"
            />
          </div>
        </div>

        <UiDialogFooter class="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2">
          <UiButton type="button" variant="ghost" class="w-full sm:w-auto" @click="closeModal">Cancel</UiButton>
          <UiButton
            type="submit"
            data-testid="folder-form-submit"
            class="w-full sm:w-auto"
            :disabled="isSubmitting"
          >
            {{ props.mode === 'create' ? 'Create folder' : 'Save changes' }}
          </UiButton>
        </UiDialogFooter>
      </form>

      <template v-if="props.mode === 'edit' && props.folder">
        <UiSeparator />
        <div class="grid gap-2" data-testid="folder-danger-zone">
          <h4 class="text-sm font-semibold text-destructive">Danger Zone</h4>
          <p class="text-xs text-muted-foreground">
            Deleting this folder removes all documents and subfolders inside. This cannot be undone.
          </p>
          <UiButton
            type="button"
            variant="ghost"
            class="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
            data-testid="folder-delete-button"
            @click="showDeleteConfirm = true"
          >
            <Trash2 class="mr-2 h-4 w-4" />
            Delete folder
          </UiButton>
        </div>
      </template>
    </UiDialogContent>
  </UiDialog>

  <UiAlertDialog v-model:open="showDeleteConfirm">
    <UiAlertDialogContent data-testid="folder-delete-confirm">
      <UiAlertDialogHeader>
        <UiAlertDialogTitle>Delete folder?</UiAlertDialogTitle>
        <UiAlertDialogDescription>
          "{{ props.folder?.name }}" and everything inside will be permanently removed.
        </UiAlertDialogDescription>
      </UiAlertDialogHeader>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel :disabled="isDeleting">Cancel</UiAlertDialogCancel>
        <UiAlertDialogAction
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          :disabled="isDeleting"
          @click="confirmDelete"
        >
          {{ isDeleting ? 'Deleting…' : 'Delete' }}
        </UiAlertDialogAction>
      </UiAlertDialogFooter>
    </UiAlertDialogContent>
  </UiAlertDialog>
</template>
