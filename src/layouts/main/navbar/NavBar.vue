<template>
  <nav class="minimal-navbar">
    <div class="minimal-navbar__inner">
      <AppBrand />
      <ThemeToggle />
    </div>
  </nav>
</template>

<script>
import AppBrand from './AppBrand.vue';
import ThemeToggle from './ThemeToggle.vue';

export default {
  name: 'NavBar',
  components: {
    AppBrand,
    ThemeToggle,
  },
};
</script>

<style scoped>
.minimal-navbar {
  position: sticky;
  top: 12px;
  z-index: 100;
  width: min(calc(100% - 32px), 900px);
  margin: 12px auto 0;
  border: 1px solid var(--surface-glass-edge);
  border-radius: 20px;
  background: var(--surface-glass-strong);
  box-shadow: var(--shadow-glass-soft);
  backdrop-filter: blur(18px) saturate(120%);
}

.minimal-navbar__inner {
  display: flex;
  max-width: 860px;
  min-height: 56px;
  margin: 0 auto;
  padding: 0 20px;
  align-items: center;
  justify-content: space-between;
}

@media (prefers-reduced-transparency: reduce) {
  .minimal-navbar {
    background: var(--surface-glass-strong);
    backdrop-filter: none;
  }
}

@media (max-width: 575.98px) {
  .minimal-navbar {
    top: 8px;
    width: calc(100% - 24px);
    margin-top: 8px;
  }

  .minimal-navbar__inner {
    padding: 0 14px;
  }
}
</style>
