<template>
  <header class="site-header">
    <nav class="site-header__inner" aria-label="主导航">
      <AppBrand />
    </nav>
  </header>
</template>

<script>
import AppBrand from './AppBrand.vue';

export default {
  name: 'NavBar',
  components: { AppBrand },
};
</script>

<style scoped>
.site-header {
  width: 100%;
  padding: 30px 30px 0;
}

.site-header__inner {
  display: flex;
  width: 100%;
  align-items: center;
  max-width: 860px;
  margin: 0 auto;
  justify-content: flex-start;
}

@media (max-width: 640px) {
  .site-header {
    padding: 18px 18px 0;
  }
}
</style>
