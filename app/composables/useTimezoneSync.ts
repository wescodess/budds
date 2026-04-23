import { api } from '#convex/api'

export function useTimezoneSync(profileData: Ref<any>) {
  if (!import.meta.client) return

  const setTimezone = useConvexMutation(api.learnProfile.setTimezone)
  const synced = ref(false)

  watch(
    () => profileData.value,
    (p) => {
      if (synced.value || !p) return
      if (p.timezone) {
        synced.value = true
        return
      }

      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (!detected) return

      synced.value = true
      setTimezone({ timezone: detected }).catch(() => {
        synced.value = false
      })
    },
    { immediate: true },
  )
}
