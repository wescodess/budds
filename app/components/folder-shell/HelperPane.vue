<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { Sheet, SheetContent } from '@/components/ui/sheet'

const props = defineProps<{
  mobile?: boolean
  excludeTabs?: string[]
}>()

const { isOpen, tabs, activeTabId, toggle, close } = useHelperPane()

const visibleTabs = computed(() =>
  props.excludeTabs?.length
    ? tabs.value.filter(t => !props.excludeTabs!.includes(t.id))
    : tabs.value,
)

const sheetOpen = computed({
  get: () => {
    if (!props.mobile || !isOpen.value) return false
    return visibleTabs.value.some(t => t.id === activeTabId.value)
  },
  set: (v: boolean) => { if (!v) close() },
})
</script>

<template>
  <template v-if="!props.mobile">
    <div v-if="isOpen" class="flex h-full min-h-0 flex-col overflow-hidden">
      <div v-if="visibleTabs.length > 1" class="flex shrink-0 items-center gap-1 border-b border-border/60 bg-card/50 px-2 py-1.5">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTabId === tab.id"
          :data-testid="`helper-tab-${tab.id}`"
          :class="[
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-inter text-[11px] font-medium transition-colors',
            activeTabId === tab.id
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground',
          ]"
          @click="toggle(tab.id)"
        >
          <component :is="tab.icon" class="h-3 w-3" />
          {{ tab.label }}
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-hidden">
        <slot :active-tab-id="activeTabId" />
      </div>
    </div>
  </template>

  <template v-else>
    <Sheet v-model:open="sheetOpen">
      <SheetContent
        side="right"
        class="w-[85vw] max-w-sm p-0"
        :aria-describedby="undefined"
      >
        <div class="flex h-full min-h-0 flex-col overflow-hidden">
          <div class="flex shrink-0 items-center justify-between border-b border-border/60 bg-card/50 px-2 py-1.5">
            <div class="flex items-center gap-1">
              <button
                v-for="tab in visibleTabs"
                :key="tab.id"
                type="button"
                role="tab"
                :aria-selected="activeTabId === tab.id"
                :data-testid="`helper-tab-${tab.id}`"
                :class="[
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-inter text-[11px] font-medium transition-colors',
                  activeTabId === tab.id
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground',
                ]"
                @click="toggle(tab.id)"
              >
                <component :is="tab.icon" class="h-3 w-3" />
                {{ tab.label }}
              </button>
            </div>
            <button
              type="button"
              aria-label="Close"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              @click="close()"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-hidden">
            <slot :active-tab-id="activeTabId" />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  </template>
</template>
