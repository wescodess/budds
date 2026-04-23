<script setup lang="ts">
const route = useRoute()
const folderId = route.params.id as string

definePageMeta({ layout: false })

await navigateTo(`/app/folders/${folderId}/chat`, { replace: true })
</script>
