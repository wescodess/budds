import { describe, it, expect, vi } from 'vitest'
import { h, defineComponent } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { TooltipProvider } from 'reka-ui'
import { createFolder } from '../../support/factories/folder.factory'

async function mountRail(props: Record<string, unknown>, listeners: Record<string, unknown> = {}) {
  const HomeRail = (await import('~/components/sidebar/HomeRail.vue')).default
  const Wrapper = defineComponent({
    setup() {
      return () => h(TooltipProvider, { delayDuration: 0 }, () => h(HomeRail, { ...props, ...listeners }))
    },
  })
  return mountSuspended(Wrapper)
}

describe('SidebarHomeRail', () => {
  it('[P0] renders home link with active state on /', async () => {
    const wrapper = await mountRail({
      folders: [],
      loading: false,
      activeRootId: null,
      isHome: true,
    })
    const home = wrapper.find('[data-testid="rail-home-link"]')
    expect(home.exists()).toBe(true)
    expect(home.attributes('data-active')).toBe('true')
  })

  it('[P0] empty state shows only the create-folder tile (no folder tiles)', async () => {
    const wrapper = await mountRail({
      folders: [],
      loading: false,
      activeRootId: null,
      isHome: true,
    })
    const create = wrapper.find('[data-testid="rail-create-folder"]')
    expect(create.exists()).toBe(true)
    expect(wrapper.findAll('[data-testid^="rail-folder-"]').length).toBe(0)
  })

  it('[P0] loading state renders skeleton tiles', async () => {
    const wrapper = await mountRail({
      folders: null,
      loading: true,
      activeRootId: null,
      isHome: true,
    })
    expect(wrapper.findAll('[data-testid^="rail-folder-"]').length).toBe(0)
    expect(wrapper.find('[data-testid="rail-create-folder"]').exists()).toBe(false)
  })

  it('[P0] renders only root folders (parentId == null)', async () => {
    const folders = [
      createFolder({ _id: 'root1', name: 'Math', parentId: undefined }),
      createFolder({ _id: 'sub1', name: 'Algebra', parentId: 'root1' }),
      createFolder({ _id: 'root2', name: 'Physics', parentId: undefined }),
    ]
    const wrapper = await mountRail({
      folders,
      loading: false,
      activeRootId: null,
      isHome: false,
    })
    expect(wrapper.find('[data-testid="rail-folder-root1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rail-folder-root2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rail-folder-sub1"]').exists()).toBe(false)
  })

  it('[P0] highlights active root via data-active', async () => {
    const folders = [
      createFolder({ _id: 'root1', name: 'Math', parentId: undefined }),
      createFolder({ _id: 'root2', name: 'Physics', parentId: undefined }),
    ]
    const wrapper = await mountRail({
      folders,
      loading: false,
      activeRootId: 'root2',
      isHome: false,
    })
    expect(wrapper.find('[data-testid="rail-folder-root2"]').attributes('data-active')).toBe('true')
    expect(wrapper.find('[data-testid="rail-folder-root1"]').attributes('data-active')).toBeUndefined()
  })

  it('[P0] emits create when + tile is clicked', async () => {
    const onCreate = vi.fn()
    const wrapper = await mountRail(
      {
        folders: [],
        loading: false,
        activeRootId: null,
        isHome: true,
      },
      { onCreate },
    )
    await wrapper.find('[data-testid="rail-create-folder"]').trigger('click')
    expect(onCreate).toHaveBeenCalledOnce()
  })
})
