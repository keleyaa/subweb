<template>
  <router-link to="/" class="app-brand-link" aria-label="Subconverter Web，返回首页">
    <img class="app-brand-mark" src="/favicon.svg" width="28" height="28" alt="" />
    <span class="app-brand-text">Subconverter Web</span>
  </router-link>
</template>

<style scoped>
.app-brand-link {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--text-primary);
  text-decoration: none;
}

.app-brand-link:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: 8px;
}

.app-brand-mark {
  display: block;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
}

.app-brand-text {
  font-size: 15px;
  font-weight: 600;
}
</style>
