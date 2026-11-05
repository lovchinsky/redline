<template>
  <section id="security" class="panel security-card" data-testid="two-factor">
    <h2>{{ $t('security.heading') }}</h2>
    <p class="status">✔ {{ $t('security.enabled') }}</p>
    <button type="button" class="link-button">{{ $t('security.recovery') }}</button>
  </section>
</template>

<style scoped>
.panel {
  padding: 20px;
  border: 1px solid #e6e1d8;
  border-radius: 10px;
  background: #fff;
}
.status {
  color: #2e6b3a;
}
.link-button {
  border: none;
  background: none;
  color: #7a3e2b;
  text-decoration: underline;
}
</style>
