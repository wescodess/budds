import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { CONVEX_INJECTION_KEY } from '@convex-vue/core'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { convexToJson, type Value } from 'convex/values'
import { defineComponent, ref } from 'vue'
import AudioOverviewShell from '~/components/audio-overview/AudioOverviewShell.vue'

// Runs in the Nuxt environment so the shell uses the installed nuxt-convex
// useConvexQuery; the audio harness stubs that wrapper and cannot see this bug.

const generate = vi.fn()

mockNuxtImport('useTasks', () => () => ({ tasks: ref([]), cancel: vi.fn() }))
mockNuxtImport('useDocuments', () => () => ({ documents: ref([{ _id: 'document_1', status: 'success' }]) }))
mockNuxtImport('$fetch', () => (...args: unknown[]) => generate(...args))

type Subscription = {
  name: string
  args: Record<string, Value>
  active: boolean
  deliver: (value: unknown) => void
}

const LIST_BY_ROOM = 'audioOverviews:listByRoom'
const ROOM_FOR_CONVERSATION = 'audioOverviewRooms:getForConversation'
const REQUIRED_ID: Record<string, string> = {
  [LIST_BY_ROOM]: 'roomId',
  [ROOM_FOR_CONVERSATION]: 'conversationId',
}

const subscriptions: Subscription[] = []
const createRoom = vi.fn()
const convexClient = {
  onUpdate(query: FunctionReference<'query'>, args: Record<string, Value> | undefined, callback: (value: unknown) => void) {
    const subscription: Subscription = {
      name: getFunctionName(query),
      args: convexToJson(args ?? {}) as Record<string, Value>,
      active: true,
      deliver: callback,
    }
    subscriptions.push(subscription)
    return () => { subscription.active = false }
  },
  async mutation(mutation: FunctionReference<'mutation'>, args: Record<string, Value>) {
    if (getFunctionName(mutation) === 'audioOverviewRooms:create') return createRoom(args)
    return null
  },
}

function rejectedByServer() {
  return subscriptions.flatMap(({ name, args }) => {
    const field = REQUIRED_ID[name]
    if (!field || typeof args[field] === 'string') return []
    return field in args
      ? [`${name} ArgumentValidationError: Path: .${field} Value: ${JSON.stringify(args[field])}`]
      : [`${name} ArgumentValidationError: Object is missing the required field \`${field}\``]
  })
}

function subscribedTo(name: string) {
  return subscriptions.filter(subscription => subscription.name === name)
}

function activeArgs(name: string) {
  return subscribedTo(name).filter(subscription => subscription.active).map(subscription => subscription.args)
}

async function deliver(name: string, value: unknown) {
  for (const subscription of subscribedTo(name).filter(candidate => candidate.active)) subscription.deliver(value)
  await flushPromises()
}

function readyOverview(id: string) {
  return {
    _id: id,
    _creationTime: 1,
    title: 'Cell biology',
    status: 'ready',
    turnCount: 4,
    totalDurationMs: 60_000,
  }
}

const stubs = {
  AudioOverviewCard: defineComponent({
    emits: ['generate'],
    template: '<button data-testid="audio-overview-card" @click="$emit(\'generate\')">Generate</button>',
  }),
  AudioOverviewPlayer: defineComponent({
    props: { overviewId: { type: String, required: true } },
    template: '<div data-testid="audio-overview-player" :data-overview-id="overviewId" />',
  }),
  AudioOverviewCustomize: defineComponent({
    props: { open: Boolean },
    emits: ['submit'],
    template: `<button v-if="open" data-testid="audio-overview-customize-submit" @click="$emit('submit', {
      lengthMinutes: 10,
      complexity: 'beginner',
      hostNames: { hostA: 'Maya', hostB: 'Leo' },
    })">Submit</button>`,
  }),
  AudioOverviewGenerating: true,
  AudioOverviewShareDialog: true,
  Sheet: true,
  SheetContent: true,
  SheetHeader: true,
  SheetTitle: true,
}

async function mountShell(props: Record<string, unknown>) {
  const wrapper = await mountSuspended(AudioOverviewShell, {
    props: { folderId: 'folder_1', ...props },
    global: { stubs },
  })
  await flushPromises()
  return wrapper
}

describe('AudioOverviewShell Convex subscriptions', () => {
  beforeAll(() => {
    useNuxtApp().vueApp.provide(CONVEX_INJECTION_KEY, convexClient)
  })

  beforeEach(() => {
    subscriptions.length = 0
    createRoom.mockReset()
    generate.mockReset()
    useRuntimeConfig().public.convex.url = 'https://audio-overview-shell.convex.cloud'
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Network access is disabled in Audio Overview subscription tests')
    }))
  })

  afterEach(() => {
    useRuntimeConfig().public.convex.url = ''
    vi.unstubAllGlobals()
  })

  it('[P0] opens without a room or conversation and sends no invalid audio queries', async () => {
    const wrapper = await mountShell({})

    expect(rejectedByServer()).toEqual([])
    expect(subscribedTo(LIST_BY_ROOM)).toEqual([])
    expect(subscribedTo(ROOM_FOR_CONVERSATION)).toEqual([])
    expect(wrapper.find('[data-testid="audio-overview-card"]').exists()).toBe(true)
  })

  it('[P0] waits for the conversation room before listing its overviews', async () => {
    const wrapper = await mountShell({ conversationId: 'conversation_1' })

    expect(activeArgs(ROOM_FOR_CONVERSATION)).toEqual([{ conversationId: 'conversation_1' }])
    expect(subscribedTo(LIST_BY_ROOM)).toEqual([])

    await deliver(ROOM_FOR_CONVERSATION, null)
    expect(subscribedTo(LIST_BY_ROOM)).toEqual([])

    await deliver(ROOM_FOR_CONVERSATION, { _id: 'room_1' })
    expect(activeArgs(LIST_BY_ROOM)).toEqual([{ roomId: 'room_1' }])

    await deliver(LIST_BY_ROOM, [readyOverview('overview_1')])
    expect(wrapper.get('[data-testid="audio-overview-player"]').attributes('data-overview-id')).toBe('overview_1')
    expect(rejectedByServer()).toEqual([])
  })

  it('[P0] loads a room page from its room without resolving a conversation', async () => {
    const wrapper = await mountShell({ roomId: 'room_1' })

    expect(activeArgs(LIST_BY_ROOM)).toEqual([{ roomId: 'room_1' }])
    expect(subscribedTo(ROOM_FOR_CONVERSATION)).toEqual([])

    await deliver(LIST_BY_ROOM, [readyOverview('overview_1')])
    expect(wrapper.get('[data-testid="audio-overview-player"]').attributes('data-overview-id')).toBe('overview_1')
    expect(rejectedByServer()).toEqual([])
  })

  it('[P1] drops the room subscription and its overviews when the room goes away', async () => {
    const wrapper = await mountShell({ roomId: 'room_1' })
    await deliver(LIST_BY_ROOM, [readyOverview('overview_1')])
    expect(wrapper.find('[data-testid="audio-overview-player"]').exists()).toBe(true)

    await wrapper.setProps({ roomId: undefined })
    await flushPromises()

    expect(activeArgs(LIST_BY_ROOM)).toEqual([])
    expect(rejectedByServer()).toEqual([])
    expect(wrapper.find('[data-testid="audio-overview-player"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="audio-overview-card"]').exists()).toBe(true)
  })

  it('[P1] lists overviews for the room created by the first generation', async () => {
    generate.mockResolvedValue({
      accepted: true,
      status: 'accepted',
      taskId: 'task_1',
      quota: { used: 1, cap: 10, date: '2026-11-05' },
    })
    createRoom.mockResolvedValue({ roomId: 'room_created' })
    const wrapper = await mountShell({ conversationId: 'conversation_1' })
    await deliver(ROOM_FOR_CONVERSATION, null)

    await wrapper.get('[data-testid="audio-overview-card"]').trigger('click')
    await wrapper.get('[data-testid="audio-overview-customize-submit"]').trigger('click')
    await flushPromises()

    expect(createRoom).toHaveBeenCalledWith({ folderId: 'folder_1', conversationId: 'conversation_1' })
    expect(generate).toHaveBeenCalledWith('/api/audio-overview/generate', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ roomId: 'room_created' }),
    }))
    expect(activeArgs(LIST_BY_ROOM)).toEqual([{ roomId: 'room_created' }])
    expect(rejectedByServer()).toEqual([])
  })

  it('[P1] stops listening to the room when the shell unmounts', async () => {
    const wrapper = await mountShell({ roomId: 'room_1' })
    expect(activeArgs(LIST_BY_ROOM)).toEqual([{ roomId: 'room_1' }])

    wrapper.unmount()

    expect(activeArgs(LIST_BY_ROOM)).toEqual([])
  })
})
