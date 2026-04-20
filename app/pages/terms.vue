<script setup lang="ts">
definePageMeta({ layout: false })

useHead({
  title: 'Terms of Service — Budds',
  meta: [
    {
      name: 'description',
      content:
        'Terms of Service for Budds — the AI study assistant. Covers acceptable use, user responsibility for uploaded content, warranty disclaimers, and termination.',
    },
  ],
})

const lastUpdated = '2026-04-12'
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <div class="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <nav class="mb-10 flex items-center justify-between text-sm text-muted-foreground">
        <NuxtLink to="/" class="hover:text-foreground">&larr; Budds</NuxtLink>
        <NuxtLink to="/privacy" class="hover:text-foreground">Privacy Policy</NuxtLink>
      </nav>

      <h1 class="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p class="mt-2 text-sm text-muted-foreground">Last updated: {{ lastUpdated }}</p>

      <section class="mt-10 space-y-4">
        <h2 class="text-xl font-semibold">1. Use of service</h2>
        <p>
          Budds is an AI study assistant provided to individual learners. You must be 13 years of age or older
          to create an account. You are responsible for the security of your account credentials and for all
          activity that occurs under your account. Do not use Budds for purposes that violate applicable law
          or infringe on the rights of others.
        </p>
      </section>

      <section class="mt-10 space-y-4">
        <h2 class="text-xl font-semibold">2. User responsibility for uploaded content</h2>
        <p>
          You retain ownership of the materials you upload to Budds, including course notes, lecture slides,
          textbook excerpts, and any other documents. You are solely responsible for ensuring that you have
          the legal right to store and process these materials through Budds. Do not upload content that
          infringes copyright, contains personal information of other individuals without their consent, or
          otherwise violates any law or agreement.
        </p>
        <p>
          Budds stores your uploaded materials for your personal use only. The service does not redistribute,
          publish, or share your content with other users.
        </p>
      </section>

      <section class="mt-10 space-y-4">
        <h2 class="text-xl font-semibold">3. No warranty; limitation of liability</h2>
        <p>
          Budds is provided on an "as is" and "as available" basis without warranties of any kind, express or
          implied, including warranties of merchantability, fitness for a particular purpose, or
          non-infringement. AI-generated answers, summaries, quizzes, and flash cards may contain errors or
          omissions. Always verify critical information against primary sources.
        </p>
        <p>
          To the maximum extent permitted by law, Budds shall not be liable for any indirect, incidental,
          special, consequential, or punitive damages arising out of your use of the service.
        </p>
      </section>

      <section class="mt-10 space-y-4">
        <h2 class="text-xl font-semibold">4. Termination</h2>
        <p>
          You may delete your account at any time from within the application. Budds may suspend or terminate
          accounts that violate these terms, abuse the service, or create risk for other users. On
          termination we will remove your data in accordance with our
          <NuxtLink to="/privacy" class="underline">Privacy Policy</NuxtLink>.
        </p>
      </section>

      <section class="mt-10 space-y-4">
        <h2 class="text-xl font-semibold">5. Governing law</h2>
        <p>
          The governing jurisdiction for these terms is to be finalised before general availability. During
          the private-beta period these terms are provided for transparency; any disputes should be raised
          directly with Budds support.
        </p>
      </section>

      <section class="mt-10 space-y-4">
        <h2 class="text-xl font-semibold">6. Changes</h2>
        <p>
          We may update these terms from time to time. Material changes will be communicated through the
          product. Continued use of Budds after an update constitutes acceptance of the revised terms.
        </p>
      </section>

      <section class="mt-10 space-y-4">
        <h2 class="text-xl font-semibold">7. Contact</h2>
        <p>
          Questions about these terms can be sent to
          <a href="mailto:support@budds.app" class="underline">support@budds.app</a>.
        </p>
      </section>

      <footer class="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">
        <div class="flex items-center justify-between">
          <NuxtLink to="/" class="hover:text-foreground">Home</NuxtLink>
          <NuxtLink to="/privacy" class="hover:text-foreground">Privacy Policy</NuxtLink>
        </div>
      </footer>
    </div>
  </div>
</template>
