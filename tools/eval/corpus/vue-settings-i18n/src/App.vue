<script setup lang="ts">
import SettingsNav from './components/SettingsNav.vue';
import ProfileForm from './components/ProfileForm.vue';
import NotificationToggles from './components/NotificationToggles.vue';
import SecurityCard from './components/SecurityCard.vue';
import DangerZone from './components/DangerZone.vue';
</script>

<template>
  <div class="settings">
    <h1>{{ $t('settings.title') }}</h1>
    <div class="settings-layout">
      <SettingsNav />
      <div class="settings-panels">
        <ProfileForm />
        <NotificationToggles />
        <SecurityCard />
        <DangerZone />
      </div>
    </div>
  </div>
</template>

<style>
body {
  margin: 0;
  font-family: Georgia, serif;
  background: #faf8f5;
}
.settings {
  max-width: 960px;
  margin: 0 auto;
  padding: 32px;
}
.settings-layout {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 32px;
}
.settings-panels {
  display: grid;
  gap: 24px;
}
</style>
