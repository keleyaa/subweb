<template>
  <a href="/" class="app-brand-link" aria-label="Subconverter Web，返回首页">
    Subconverter Web<span aria-hidden="true">.</span>
  </a>
</template>

<style scoped>
.app-brand-link {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 720;
  letter-spacing: 0;
  text-decoration: none;
}

.app-brand-link span {
  margin-left: 1px;
  color: var(--accent);
  font-size: 24px;
}

.app-brand-link:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 4px;
}
</style>
