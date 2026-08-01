<template>
  <router-link to="/" class="app-brand-link" aria-label="Subconverter Web，返回首页">
    <span class="app-brand-text">Subconverter Web</span>
    <span class="app-brand-dot" aria-hidden="true">.</span>
  </router-link>
</template>

<style scoped>
.app-brand-link {
  display: inline-flex;
  align-items: center;
  color: var(--text-primary);
  text-decoration: none;
}

.app-brand-link:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: 8px;
}

.app-brand-text {
  font-size: 18px;
  font-weight: 650;
}

.app-brand-dot {
  color: var(--accent);
  font-size: 22px;
  font-weight: 700;
}
</style>
