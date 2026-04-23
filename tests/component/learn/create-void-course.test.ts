import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CreateVoidDialog from '~/components/voids/CreateVoidDialog.vue'

describe('CreateVoidDialog — Course type', () => {
  const baseProps = {
    open: true,
    folderName: 'Biology 101',
  }

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('includes Course type option', async () => {
    const w = await mountSuspended(CreateVoidDialog, { props: baseProps, attachTo: document.body })
    const html = document.body.innerHTML
    expect(html).toContain('Course')
    expect(html).toContain('Structured learning from your knowledge')
    w.unmount()
  })

  it('emits create with type course when selected and submitted', async () => {
    const w = await mountSuspended(CreateVoidDialog, { props: baseProps, attachTo: document.body })

    const courseBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="void-type-course"]')
    expect(courseBtn).not.toBeNull()
    courseBtn?.click()
    await w.vm.$nextTick()

    const submit = document.body.querySelector<HTMLButtonElement>('[data-testid="create-void-submit"]')
    expect(submit?.disabled).toBe(false)
    expect(submit?.textContent).toContain('Create course void')

    submit?.click()
    await w.vm.$nextTick()

    expect(w.emitted('create')).toBeTruthy()
    expect(w.emitted('create')?.[0]).toEqual([{ type: 'course', name: undefined }])
    w.unmount()
  })
})
