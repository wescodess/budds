import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CreateVoidDialog from '~/components/voids/CreateVoidDialog.vue'

describe('CreateVoidDialog', () => {
  const baseProps = {
    open: true,
    folderName: 'Operating Systems',
  }

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders title with folder name and all three void types', async () => {
    const w = await mountSuspended(CreateVoidDialog, { props: baseProps, attachTo: document.body })
    const html = document.body.innerHTML
    expect(html).toContain('Operating Systems')
    expect(html).toContain('Chat')
    expect(html).toContain('Flash Cards')
    expect(html).toContain('Quiz')
    w.unmount()
  })

  it('submit button is disabled until a type is selected', async () => {
    const w = await mountSuspended(CreateVoidDialog, { props: baseProps, attachTo: document.body })
    const submit = document.body.querySelector<HTMLButtonElement>('[data-testid="create-void-submit"]')
    expect(submit?.disabled).toBe(true)

    document.body.querySelector<HTMLButtonElement>('[data-testid="void-type-chat"]')?.click()
    await w.vm.$nextTick()

    expect(submit?.disabled).toBe(false)
    expect(submit?.textContent).toContain('Create chat void')
    w.unmount()
  })

  it('emits create with { type, name? } payload', async () => {
    const w = await mountSuspended(CreateVoidDialog, { props: baseProps, attachTo: document.body })
    document.body.querySelector<HTMLButtonElement>('[data-testid="void-type-quiz"]')?.click()
    await w.vm.$nextTick()

    const nameInput = document.body.querySelector<HTMLInputElement>('[data-testid="create-void-name"]')
    expect(nameInput).not.toBeNull()
    nameInput!.value = '  My Quiz  '
    nameInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await w.vm.$nextTick()

    document.body.querySelector<HTMLButtonElement>('[data-testid="create-void-submit"]')?.click()
    await w.vm.$nextTick()

    expect(w.emitted('create')).toBeTruthy()
    expect(w.emitted('create')?.[0]).toEqual([{ type: 'quiz', name: 'My Quiz' }])
    w.unmount()
  })

  it('emits create with undefined name when input is blank', async () => {
    const w = await mountSuspended(CreateVoidDialog, { props: baseProps, attachTo: document.body })
    document.body.querySelector<HTMLButtonElement>('[data-testid="void-type-flashcards"]')?.click()
    await w.vm.$nextTick()

    document.body.querySelector<HTMLButtonElement>('[data-testid="create-void-submit"]')?.click()
    await w.vm.$nextTick()

    expect(w.emitted('create')?.[0]).toEqual([{ type: 'flashcards', name: undefined }])
    w.unmount()
  })

  it('emits update:open false on cancel', async () => {
    const w = await mountSuspended(CreateVoidDialog, { props: baseProps, attachTo: document.body })
    const cancelBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find(b => b.textContent?.trim() === 'Cancel')
    cancelBtn?.click()
    await w.vm.$nextTick()

    expect(w.emitted('update:open')).toBeTruthy()
    expect(w.emitted('update:open')?.at(-1)).toEqual([false])
    w.unmount()
  })

  it('disables submit and ignores clicks while submitting=true', async () => {
    const w = await mountSuspended(CreateVoidDialog, {
      props: { ...baseProps, submitting: true },
      attachTo: document.body,
    })
    document.body.querySelector<HTMLButtonElement>('[data-testid="void-type-chat"]')?.click()
    await w.vm.$nextTick()

    const submit = document.body.querySelector<HTMLButtonElement>('[data-testid="create-void-submit"]')
    expect(submit?.disabled).toBe(true)

    submit?.click()
    await w.vm.$nextTick()
    expect(w.emitted('create')).toBeFalsy()
    w.unmount()
  })
})
