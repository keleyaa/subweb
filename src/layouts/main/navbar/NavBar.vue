<template>
  <nav class="minimal-navbar">
    <div class="minimal-navbar__inner">
      <AppBrand />
      <NavMenu />
    </div>
  </nav>
</template>

<script>
import AppBrand from './AppBrand.vue';
import NavMenu from './NavMenu.vue';

export default {
  name: 'NavBar',
  components: {
    AppBrand,
    NavMenu,
  },
};
</script>

<style scoped>
.minimal-navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid #d2d2d7;
  background: rgba(245, 245, 247, 0.96);
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
    background: #f5f5f7;
  }
}
</style>
