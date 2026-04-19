<script setup lang="ts">
import { BookOpen, ClipboardList, Layers, Calculator, PenLine, Mic, FileText } from 'lucide-vue-next'
import { api } from '#convex/api'

const { user } = useUserSession()
const { folders, allFolders, isLoading, allFoldersLoading } = useFolders()
const router = useRouter()

const hydrated = ref(false)
onMounted(() => { hydrated.value = true })
const showCoursesLoading = computed(() => !hydrated.value || isLoading.value)

const { data: recentChatsData } = useConvexQuery(api.conversations.listRecentForUser, {})
const mostRecent = computed(() => recentChatsData.value?.[0] ?? null)
const continueHref = computed(() => {
  const convo = mostRecent.value
  if (!convo) return null
  return `/app/folders/${convo.folderId}?conversationId=${convo._id}`
})
const continueLabel = computed(() => {
  const convo = mostRecent.value
  if (!convo) return null
  return `${convo.folderName} · ${convo.title}`
})

type ActionKind = 'study-guide' | 'quiz' | 'flashcards' | 'solve' | 'write' | 'recording' | 'notes'

const actionConfig: Record<ActionKind, { title: string; prompt?: string; tab?: string }> = {
  'study-guide': { title: 'Study guide', tab: 'chat', prompt: 'Create a comprehensive study guide for this course.' },
  'quiz':        { title: 'Quiz',        tab: 'quiz' },
  'flashcards':  { title: 'Flashcards',  tab: 'flashcards' },
  'solve':       { title: 'Solve',       tab: 'chat', prompt: 'Help me solve this problem step-by-step: ' },
  'write':       { title: 'Write',       tab: 'chat', prompt: 'Help me draft: ' },
  'recording':   { title: 'Recording',   tab: 'documents' },
  'notes':       { title: 'Notes',       tab: 'documents' },
}

const pickerOpen = ref(false)
const pickerAction = ref<ActionKind | null>(null)

const pickerTitle = computed(() => {
  if (!pickerAction.value) return ''
  return `Pick a course for ${actionConfig[pickerAction.value].title}`
})

function openPicker(kind: ActionKind) {
  pickerAction.value = kind
  pickerOpen.value = true
}

function handleFolderPicked(folderId: string) {
  const kind = pickerAction.value
  pickerAction.value = null
  if (!kind) return
  const { tab, prompt } = actionConfig[kind]
  const query: Record<string, string> = {}
  if (tab) query.tab = tab
  if (prompt) query.prompt = prompt
  void router.push({ path: `/app/folders/${folderId}`, query })
}

</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div class="flex-1 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6">
      <div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <DashboardGreeting
          :name="user?.name ?? null"
          :continue-href="continueHref"
          :continue-label="continueLabel"
        />

        <DashboardChatHero />

        <DashboardActionSection label="Studying" :columns="3">
          <DashboardActionCard
            :icon="BookOpen"
            title="Study guide"
            subtitle="Prepare for a test"
            :stagger-index="0"
            @select="openPicker('study-guide')"
          />
          <DashboardActionCard
            :icon="ClipboardList"
            title="Quiz"
            subtitle="Test your knowledge"
            :stagger-index="1"
            @select="openPicker('quiz')"
          />
          <DashboardActionCard
            :icon="Layers"
            title="Flashcards"
            subtitle="Bite-sized studying"
            :stagger-index="2"
            @select="openPicker('flashcards')"
          />
        </DashboardActionSection>

        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DashboardActionSection label="Homework" :columns="2">
            <DashboardActionCard
              :icon="Calculator"
              title="Solve"
              subtitle="Get answers and explanations"
              :stagger-index="3"
              @select="openPicker('solve')"
            />
            <DashboardActionCard
              :icon="PenLine"
              title="Write"
              subtitle="Draft paragraphs or papers"
              :stagger-index="4"
              @select="openPicker('write')"
            />
          </DashboardActionSection>

          <DashboardActionSection label="Notes" :columns="2">
            <DashboardActionCard
              :icon="Mic"
              title="Recording"
              subtitle="Automatic lecture notes"
              :stagger-index="5"
              @select="openPicker('recording')"
            />
            <DashboardActionCard
              :icon="FileText"
              title="Notes"
              subtitle="Detailed notes for any resource"
              :stagger-index="6"
              @select="openPicker('notes')"
            />
          </DashboardActionSection>
        </div>

        <section data-testid="dashboard-courses-section">
          <div class="mb-3 flex items-end justify-between">
            <p class="font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your Courses
            </p>
            <NuxtLink to="/app" class="text-xs text-muted-foreground hover:text-foreground">
              View all
            </NuxtLink>
          </div>

          <div v-if="showCoursesLoading" class="flex gap-4 overflow-hidden">
            <UiSkeleton v-for="i in 4" :key="i" class="h-[140px] w-[200px] shrink-0 rounded-xl" />
          </div>

          <Motion
            v-else-if="!folders?.length"
            :initial="{ opacity: 0, y: 10, scale: 0.98 }"
            :animate="{ opacity: 1, y: 0, scale: 1 }"
            :transition="{ type: 'spring', stiffness: 200, damping: 24 }"
            data-testid="dashboard-empty-state"
            class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10"
          >
            <p class="mb-4 font-dm-sans text-sm font-semibold text-foreground">
              Start by creating a course folder
            </p>
            <DashboardAddCourseCard inline />
          </Motion>

          <DashboardCoursesCarousel v-else :count="folders.length + 1">
            <div
              v-for="(folder, idx) in folders"
              :key="folder._id"
              class="w-[200px] shrink-0 snap-start"
            >
              <DashboardCourseCard :folder="{ ...folder, documentCount: (folder as any).documentCount ?? 0 }" :stagger-index="idx" />
            </div>
            <div class="w-[200px] shrink-0 snap-start">
              <DashboardAddCourseCard />
            </div>
          </DashboardCoursesCarousel>
        </section>
      </div>
    </div>

    <DashboardAskBar />

    <DashboardFolderPickerDialog
      v-model:open="pickerOpen"
      :title="pickerTitle"
      description="Choose a course — we'll open that course's workspace."
      :folders="allFolders as any"
      :loading="allFoldersLoading"
      @select="handleFolderPicked"
    />
  </div>
</template>
