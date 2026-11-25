<script setup lang="ts">
import type { Infer } from 'convex/values'
import type { todayCheckPointersValidator } from '~~/convex/lib/learnV2PublicContract'
import { api } from '#convex/api'
import { learnTodayCheckPointerSchema, type LearnTodayCheckPointer } from '#shared/learn-v2-today-check'

type TodayCheckEnvelope = Infer<typeof todayCheckPointersValidator>
type Link = { token: object, cursor: string | null, page: TodayCheckEnvelope | null, stop: () => void }

const MAX_RESTARTS = 3
const { envelope, lock = null } = defineProps<{ envelope: TodayCheckEnvelope | null, lock?: LearnTodayCheckPointer | null }>()

const client = import.meta.client ? useConvex() : null
const links = shallowRef<Link[]>([])
let fresh = false
let restarts = 0

function truncate(from: number) {
  for (const link of links.value.slice(from)) link.stop()
  if (links.value.length > from) links.value = links.value.slice(0, from)
}

function setLink(index: number, link: Link) {
  truncate(index)
  links.value = [...links.value, link]
}

function open(index: number, cursor: string | null) {
  truncate(index)
  if (!client) return
  const token = {}
  setLink(index, { token, cursor, page: null, stop: () => {} })
  const stop = client.onUpdate(api.learnV2Today.getCheckPointers, cursor === null ? {} : { cursor }, (page) => {
    if (links.value[index]?.token !== token) return
    links.value = links.value.map((link, position) => position === index ? { ...link, page: page as TodayCheckEnvelope } : link)
    advance(index)
  }, () => {
    if (links.value[index]?.token === token) truncate(index + 1)
  })
  const current = links.value[index]
  if (current?.token === token) current.stop = stop
  else stop()
}

function restart() {
  truncate(0)
  if (restarts >= MAX_RESTARTS) return
  restarts += 1
  fresh = true
  open(0, null)
}

function advance(index: number) {
  const page = links.value[index]?.page
  if (!page) return
  if (page.status === 'restart_required') return restart()
  const cursor = page.status === 'available' && !page.isDone ? page.continueCursor : null
  if (!cursor) {
    restarts = 0
    return truncate(index + 1)
  }
  if (links.value[index + 1]?.cursor !== cursor) open(index + 1, cursor)
}

watch(() => envelope, (head) => {
  if (!head) {
    fresh = false
    return truncate(0)
  }
  if (head.status === 'unavailable' && head.reasonCode === 'pointer_page_budget') {
    if (!fresh) restart()
    return
  }
  fresh = false
  setLink(0, { token: {}, cursor: null, page: head, stop: () => {} })
  advance(0)
}, { immediate: true })

onScopeDispose(() => truncate(0))

const checks = computed(() => {
  const seen = new Set<string>()
  const rows: LearnTodayCheckPointer[] = []
  const candidates = [lock, ...links.value.flatMap(link => link.page?.status === 'available' ? link.page.checks : [])]
  for (const candidate of candidates) {
    const parsed = candidate ? learnTodayCheckPointerSchema.safeParse(candidate) : null
    if (!parsed?.success || seen.has(parsed.data.reference)) continue
    seen.add(parsed.data.reference)
    rows.push(parsed.data)
  }
  return rows
})
const primaryReference = computed(() => checks.value.find(check => check.state === 'ready')?.reference ?? null)
</script>

<template>
  <ul v-if="checks.length" data-testid="learn-v2-today-checks" aria-label="Your checks" class="space-y-3">
    <li v-for="check in checks" :key="check.reference">
      <LearnV2MeasurementTodayCheckRow :pointer="check" :primary="check.reference === primaryReference" />
    </li>
  </ul>
</template>
