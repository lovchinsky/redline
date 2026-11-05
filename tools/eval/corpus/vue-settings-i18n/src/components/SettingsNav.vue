<script setup lang="ts">
const sections = ['profile', 'notifications', 'security', 'danger'];
</script>

<template>
  <nav class="settings-nav">
    <a v-for="section in sections" :key="section" :href="`#${section}`" class="nav-link">
      {{ $t(`nav.${section}`) }}
    </a>
  </nav>
</template>

<style scoped>
.settings-nav {
  display: grid;
  gap: 4px;
  align-content: start;
}
.nav-link {
  padding: 8px 12px;
  border-radius: 6px;
  color: #3b3a36;
  text-decoration: none;
}
</style>
