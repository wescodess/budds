import { describe, expect, it } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'

const allowed = ref(true)
const checkingAccess = ref(false)
const hub = ref({ today: null, missions: [] })

mockNuxtImport('useLearnV2Journey', () => () => ({ allowed, checkingAccess, hub }))

describe('Learn V2 route entry', () => {
  it('renders the real Learn hub instead of the legacy Today-only destination', async () => {
    const Page = await import(['~', 'pages', 'app', 'learn', 'index.vue'].join('/'))
    const wrapper = await mountSuspended(Page.default, {
      global: { stubs: { LearnV2LearnHub: { props: ['snapshot'], template: '<section data-testid="hub" />' } } },
    })
    expect(wrapper.find('[data-testid="hub"]').exists()).toBe(true)
  })
})
