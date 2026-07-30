<template>
  <div class="main-layout" dir="ltr">
    <NavBar />
    <div class="main-layout__content"><router-view /></div>
    <FooterBar />
  </div>
</template>

<script>
import FooterBar from './footer/FooterBar.vue';
import NavBar from './navbar/NavBar.vue';

export default {
  components: { FooterBar, NavBar },
  name: 'MainLayout',
};
</script>

<style scoped>
.main-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: #f5f5f7;
  color: #1d1d1f;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  letter-spacing: 0;
}

.main-layout__content {
  flex: 1;
}
</style>
