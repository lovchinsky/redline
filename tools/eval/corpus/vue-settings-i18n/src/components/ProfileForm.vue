<script setup lang="ts">
import { ref } from 'vue';

const displayName = ref('Ada Fairweather');
const bio = ref('Writes about typography and slow travel.');
</script>

<template>
  <section id="profile" class="panel">
    <h2>{{ $t('profile.heading') }}</h2>
    <label class="field">
      {{ $t('profile.displayName') }}
      <input v-model="displayName" name="displayName" />
    </label>
    <label class="field">
      {{ $t('profile.bio') }}
      <textarea v-model="bio" name="bio" rows="3" />
      <small class="hint">{{ $t('profile.bioHint') }}</small>
    </label>
    <button class="primary" type="button">{{ $t('profile.save') }}</button>
  </section>
</template>

<style scoped>
.panel {
  padding: 20px;
  border: 1px solid #e6e1d8;
  border-radius: 10px;
  background: #fff;
}
.field {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
}
.hint {
  color: #8a857b;
}
.primary {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #7a3e2b;
  color: #fff;
}
</style>
