<template>
  <div class="main-layout" dir="ltr">
    <NavBar />
    <div class="main-layout__content"><HomeView /></div>
    <FooterBar />
  </div>
</template>

<script>
import FooterBar from './footer/FooterBar.vue';
import NavBar from './navbar/NavBar.vue';
import HomeView from '@/views/home/HomeView.vue';

export default {
  components: { FooterBar, HomeView, NavBar },
  name: 'MainLayout',
};
</script>

<style scoped>
.main-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: transparent;
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  letter-spacing: 0;
}

.main-layout__content {
  display: flex;
  flex: 1;
  flex-direction: column;
}
</style>
