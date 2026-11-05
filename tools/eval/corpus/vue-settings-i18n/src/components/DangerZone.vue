<script setup lang="ts">
import { ref } from 'vue';

const confirming = ref(false);
</script>

<template>
  <section id="danger" class="danger-zone">
    <h2>{{ $t('danger.heading') }}</h2>
    <p>{{ $t('danger.warning') }}</p>
    <button type="button" class="danger-button" @click="confirming = true">
      {{ $t('danger.delete') }}
    </button>
  </section>
</template>

<style scoped>
.danger-zone {
  padding: 20px;
  border: 1px solid #e3b3a6;
  border-radius: 10px;
  background: #fff6f3;
}
.danger-button {
  padding: 8px 16px;
  border: 1px solid #b23b1e;
  border-radius: 6px;
  background: #fff;
  color: #b23b1e;
}
</style>
