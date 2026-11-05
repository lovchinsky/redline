<script setup lang="ts">
import { reactive } from 'vue';

const preferences = reactive({ comments: true, digest: true, product: false });
const keys = ['comments', 'digest', 'product'] as const;
</script>

<template>
  <section id="notifications" class="panel">
    <h2>{{ $t('notifications.heading') }}</h2>
    <ul class="toggles">
      <li v-for="key in keys" :key="key" class="toggle-row">
        <span>{{ $t(`notifications.${key}`) }}</span>
        <input v-model="preferences[key]" type="checkbox" role="switch" :name="`notify-${key}`" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.panel {
  padding: 20px;
  border: 1px solid #e6e1d8;
  border-radius: 10px;
  background: #fff;
}
.toggles {
  margin: 0;
  padding: 0;
  list-style: none;
}
.toggle-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f0ece5;
}
</style>
