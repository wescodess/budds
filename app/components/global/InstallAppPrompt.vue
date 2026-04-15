<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { Download, Share, Smartphone, X } from 'lucide-vue-next'

interface BeforeInstallPromptEvent extends Event {
  platforms?: string[]
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed', platform: string }>
  prompt: () => Promise<void>
}

const PWA_INSTALL_DISMISS_KEY = 'budds.pwa-install.dismissed-until'
const DISMISS_MS = 1000 * 60 * 60 * 24 * 7
const SHORT_DISMISS_MS = 1000 * 60 * 60 * 24

const route = useRoute()
const isTouchLike = useMediaQuery('(pointer: coarse)')

const showGuide = ref(false)
const isMounted = ref(false)
const isStandalone = ref(false)
const canInstall = ref(false)
const isInstalling = ref(false)
const isIos = ref(false)
const isSafari = ref(false)
const dismissedUntil = ref(0)
const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)

let mediaQueryList: MediaQueryList | null = null
let cleanupStandaloneListener: (() => void) | null = null

const eligibleRoute = computed(() => {
  return !['/login', '/privacy', '/terms'].includes(route.path)
})

const isDismissed = computed(() => dismissedUntil.value > Date.now())
const shouldShowIosGuide = computed(() => isIos.value && !isStandalone.value)
const shouldShowPrompt = computed(() => {
  return isMounted.value
    && eligibleRoute.value
    && !isStandalone.value
    && !isDismissed.value
    && (canInstall.value || shouldShowIosGuide.value)
})

const promptTitle = computed(() => {
  if (canInstall.value) return 'Install Budds'
  if (isSafari.value) return 'Add Budds to your Home Screen'
  return 'Install Budds from Safari'
})

const promptBody = computed(() => {
  if (canInstall.value) {
    return 'Launch Budds in a standalone app window with faster access from your Home Screen.'
  }

  if (isSafari.value) {
    return 'Use Safari’s Share menu, then choose Add to Home Screen so Budds opens like an app.'
  }

  return 'iPhone and iPad installs still work best from Safari. Open this page there, then add Budds to your Home Screen.'
})

const primaryLabel = computed(() => canInstall.value ? 'Install app' : 'Show steps')

const guideTitle = computed(() => {
  if (canInstall.value) return 'Install Budds'
  if (isSafari.value) return 'Add Budds from Safari'
  return 'Open in Safari, then install'
})

const guideDescription = computed(() => {
  if (canInstall.value) {
    return 'If Budds was previously saved as a bookmark, remove the old shortcut first and install again.'
  }

  if (isSafari.value) {
    return 'Safari is the install path on iPhone and iPad. The Home Screen icon will launch Budds in standalone mode.'
  }

  return 'Open the same page in Safari, then use the Share menu to add Budds properly.'
})

function syncStandalone() {
  if (!import.meta.client) return

  const standaloneMatch = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  isStandalone.value = standaloneMatch || iosStandalone
}

function persistDismiss(until: number) {
  dismissedUntil.value = until

  try {
    window.localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(until))
  } catch {
    // Ignore storage failures.
  }
}

function dismissPrompt(durationMs = DISMISS_MS) {
  persistDismiss(Date.now() + durationMs)
  showGuide.value = false
}

function handleBeforeInstallPrompt(event: Event) {
  const installEvent = event as BeforeInstallPromptEvent
  installEvent.preventDefault()
  deferredPrompt.value = installEvent
  canInstall.value = true
}

async function handlePrimaryAction() {
  if (!canInstall.value || !deferredPrompt.value) {
    showGuide.value = true
    return
  }

  isInstalling.value = true

  try {
    await deferredPrompt.value.prompt()
    const choice = await deferredPrompt.value.userChoice

    if (choice.outcome === 'accepted') {
      canInstall.value = false
      deferredPrompt.value = null
      showGuide.value = false
      persistDismiss(Number.MAX_SAFE_INTEGER)

      const { toast } = await import('vue-sonner')
      toast.success('Budds install started.')
      return
    }

    dismissPrompt(SHORT_DISMISS_MS)
  } catch (error) {
    console.error('PWA install prompt failed', error)
    const { toast } = await import('vue-sonner')
    toast.error('We could not start the install flow.')
  } finally {
    isInstalling.value = false
  }
}

function handleAppInstalled() {
  canInstall.value = false
  deferredPrompt.value = null
  showGuide.value = false
  persistDismiss(Number.MAX_SAFE_INTEGER)
  syncStandalone()
}

onMounted(() => {
  isMounted.value = true

  try {
    const stored = Number(window.localStorage.getItem(PWA_INSTALL_DISMISS_KEY) || '0')
    dismissedUntil.value = Number.isFinite(stored) ? stored : 0
  } catch {
    dismissedUntil.value = 0
  }

  const ua = window.navigator.userAgent
  isIos.value = /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  isSafari.value = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua)

  syncStandalone()

  mediaQueryList = window.matchMedia('(display-mode: standalone)')
  const onDisplayModeChange = () => syncStandalone()
  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', onDisplayModeChange)
    cleanupStandaloneListener = () => mediaQueryList?.removeEventListener('change', onDisplayModeChange)
  } else {
    mediaQueryList.addListener(onDisplayModeChange)
    cleanupStandaloneListener = () => mediaQueryList?.removeListener(onDisplayModeChange)
  }

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.addEventListener('appinstalled', handleAppInstalled)
})

onBeforeUnmount(() => {
  cleanupStandaloneListener?.()
  window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.removeEventListener('appinstalled', handleAppInstalled)
})
</script>

<template>
  <div
    v-if="shouldShowPrompt"
    data-testid="pwa-install-prompt"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-full sm:max-w-md sm:px-0 sm:pb-0"
  >
    <section
      class="pointer-events-auto overflow-hidden rounded-[1.4rem] border border-border/70 bg-card/95 shadow-2xl shadow-black/30 backdrop-blur"
    >
      <div class="bg-gradient-to-r from-primary/16 via-primary/8 to-transparent px-4 py-3">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Download class="h-5 w-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-dm-sans text-sm font-semibold text-foreground">
              {{ promptTitle }}
            </p>
            <p class="mt-1 text-sm leading-6 text-muted-foreground">
              {{ promptBody }}
            </p>
          </div>
          <UiButton
            variant="ghost"
            size="icon"
            class="-mr-1 -mt-1 h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            @click="dismissPrompt()"
          >
            <X class="h-4 w-4" />
            <span class="sr-only">Dismiss install prompt</span>
          </UiButton>
        </div>
      </div>

      <div class="flex flex-col gap-3 px-4 py-4">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
            <Smartphone class="h-3.5 w-3.5" />
            Home Screen launch
          </span>
          <span
            v-if="canInstall"
            class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-primary"
          >
            App mode ready
          </span>
          <span
            v-else-if="shouldShowIosGuide"
            class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-primary"
          >
            Manual install on iPhone/iPad
          </span>
        </div>

        <div class="flex flex-col gap-2 sm:flex-row">
          <UiButton
            data-testid="pwa-install-primary"
            class="flex-1 rounded-xl"
            :disabled="isInstalling"
            @click="handlePrimaryAction"
          >
            {{ isInstalling ? 'Starting…' : primaryLabel }}
          </UiButton>
          <UiButton
            v-if="!canInstall"
            variant="outline"
            class="rounded-xl"
            @click="showGuide = true"
          >
            Install guide
          </UiButton>
          <UiButton
            variant="ghost"
            class="rounded-xl"
            @click="dismissPrompt()"
          >
            Not now
          </UiButton>
        </div>
      </div>
    </section>
  </div>

  <UiDrawer
    v-if="isTouchLike"
    v-model:open="showGuide"
  >
    <UiDrawerContent data-testid="pwa-install-guide" class="gap-0">
      <UiDrawerHeader class="text-left">
        <UiDrawerTitle>{{ guideTitle }}</UiDrawerTitle>
        <UiDrawerDescription>{{ guideDescription }}</UiDrawerDescription>
      </UiDrawerHeader>

      <div class="space-y-4 px-4 pb-4 text-sm text-muted-foreground">
        <template v-if="canInstall">
          <div class="rounded-2xl border border-border bg-muted/30 p-4">
            <p class="font-medium text-foreground">Fast path</p>
            <p class="mt-1">Tap <span class="font-semibold text-foreground">Install app</span> and accept the browser install prompt.</p>
          </div>
          <ol class="space-y-3">
            <li>1. Remove any old Budds bookmark or shortcut that still opens in the browser.</li>
            <li>2. Return here and tap <span class="font-semibold text-foreground">Install app</span>.</li>
            <li>3. Launch Budds from the new Home Screen icon.</li>
          </ol>
        </template>

        <template v-else-if="isSafari">
          <ol class="space-y-3">
            <li class="flex gap-3">
              <span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">1</span>
              <div>
                <p class="font-medium text-foreground">Open Safari’s Share menu</p>
                <p class="mt-1 flex items-center gap-1">
                  Tap
                  <Share class="h-3.5 w-3.5 text-primary" />
                  in the toolbar.
                </p>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">2</span>
              <div>
                <p class="font-medium text-foreground">Choose Add to Home Screen</p>
                <p class="mt-1">Scroll the share sheet if needed, then confirm the Budds icon.</p>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">3</span>
              <div>
                <p class="font-medium text-foreground">Launch the new icon</p>
                <p class="mt-1">Budds should open without the normal Safari browser chrome.</p>
              </div>
            </li>
          </ol>
        </template>

        <template v-else>
          <ol class="space-y-3">
            <li>1. Open this same page in <span class="font-semibold text-foreground">Safari</span>.</li>
            <li>2. Tap <span class="font-semibold text-foreground">Share</span>, then choose <span class="font-semibold text-foreground">Add to Home Screen</span>.</li>
            <li>3. Launch Budds from the new icon instead of the old browser shortcut.</li>
          </ol>
        </template>

        <div class="rounded-2xl border border-border bg-muted/30 p-4">
          <p class="font-medium text-foreground">If it still opens in the browser</p>
          <p class="mt-1">Delete the old shortcut from your Home Screen and install Budds again. Old saved bookmarks keep opening as normal web pages.</p>
        </div>
      </div>

      <UiDrawerFooter class="pt-0">
        <UiButton
          v-if="canInstall"
          class="rounded-xl"
          :disabled="isInstalling"
          @click="handlePrimaryAction"
        >
          {{ isInstalling ? 'Starting…' : 'Install app' }}
        </UiButton>
        <UiButton variant="outline" class="rounded-xl" @click="showGuide = false">
          Close
        </UiButton>
      </UiDrawerFooter>
    </UiDrawerContent>
  </UiDrawer>

  <UiDialog
    v-else
    v-model:open="showGuide"
  >
    <UiDialogContent data-testid="pwa-install-guide" class="max-w-lg rounded-[1.5rem]">
      <UiDialogHeader>
        <UiDialogTitle>{{ guideTitle }}</UiDialogTitle>
        <UiDialogDescription>{{ guideDescription }}</UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-4 text-sm text-muted-foreground">
        <template v-if="canInstall">
          <div class="rounded-2xl border border-border bg-muted/30 p-4">
            <p class="font-medium text-foreground">Fast path</p>
            <p class="mt-1">Use the browser install prompt. If an older bookmark exists, remove it first and reinstall Budds.</p>
          </div>
          <ol class="space-y-3">
            <li>1. Click <span class="font-semibold text-foreground">Install app</span>.</li>
            <li>2. Accept the browser install confirmation.</li>
            <li>3. Launch Budds from the installed app icon or launcher entry.</li>
          </ol>
        </template>

        <template v-else-if="isSafari">
          <ol class="space-y-3">
            <li>1. Click the browser Share button.</li>
            <li>2. Choose <span class="font-semibold text-foreground">Add to Home Screen</span>.</li>
            <li>3. Open Budds from the new Home Screen icon.</li>
          </ol>
        </template>

        <template v-else>
          <ol class="space-y-3">
            <li>1. Open this page in <span class="font-semibold text-foreground">Safari</span>.</li>
            <li>2. Use <span class="font-semibold text-foreground">Share</span> then <span class="font-semibold text-foreground">Add to Home Screen</span>.</li>
            <li>3. Open the newly installed Budds icon.</li>
          </ol>
        </template>

        <div class="rounded-2xl border border-border bg-muted/30 p-4">
          <p class="font-medium text-foreground">Installed app check</p>
          <p class="mt-1">A correct install launches without the normal browser tab bar and address bar.</p>
        </div>
      </div>

      <UiDialogFooter class="gap-2 sm:justify-between">
        <UiButton
          v-if="canInstall"
          class="rounded-xl"
          :disabled="isInstalling"
          @click="handlePrimaryAction"
        >
          {{ isInstalling ? 'Starting…' : 'Install app' }}
        </UiButton>
        <UiButton
          v-else
          variant="outline"
          class="rounded-xl"
          @click="showGuide = false"
        >
          Close
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
