<template>
  <a href="/" class="app-brand-link" aria-label="Subconverter Web，返回首页">
    <h1>
      <span class="app-brand-text">Subconverter Web</span>
      <span class="app-brand-dot" aria-hidden="true">.</span>
    </h1>
  </a>
</template>

<style scoped>
.app-brand-link {
  display: inline-flex;
  align-items: center;
  color: var(--text-primary);
  text-decoration: none;
}

.app-brand-link h1 {
  position: relative;
  margin: 0;
  line-height: 1;
}

.app-brand-link:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: 8px;
}

.app-brand-text {
  font-size: 54px;
  font-weight: 800;
  letter-spacing: 0;
}

.app-brand-dot {
  position: absolute;
  inset-inline-start: 100%;
  bottom: 0;
  color: var(--accent);
  font-size: 54px;
  font-weight: 800;
  line-height: 1;
}

@media (max-width: 575.98px) {
  .app-brand-text,
  .app-brand-dot {
    font-size: 40px;
  }
}
</style>
