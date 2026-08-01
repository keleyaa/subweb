<template>
  <header class="minimal-navbar">
    <nav class="minimal-navbar__inner" aria-label="主导航">
      <AppBrand />
      <ThemeToggle />
    </nav>
  </header>
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
  width: 100%;
  padding: 56px 20px 0;
}

.minimal-navbar__inner {
  position: relative;
  display: flex;
  max-width: 52rem;
  min-height: 84px;
  margin: 0 auto;
  align-items: center;
  justify-content: center;
}

.minimal-navbar__inner :deep(.theme-toggle) {
  position: absolute;
  right: 0;
}

@media (max-width: 575.98px) {
  .minimal-navbar {
    padding: 40px 16px 0;
  }

  .minimal-navbar__inner {
    min-height: 64px;
  }

  .minimal-navbar__inner :deep(.theme-toggle) {
    top: -32px;
    right: -4px;
  }
}
</style>
