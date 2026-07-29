<template>
  <div class="main-layout light-style" dir="ltr">
    <nav-bar />
    <router-view />
  </div>
</template>

<script>
import NavBar from './navbar/NavBar.vue';

export default {
  components: { NavBar },
  name: 'MainLayout',
};
</script>

<style scoped>
.main-layout {
  min-height: 100vh;
  background-color: #f5f5f7;
  color: #1d1d1f;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  letter-spacing: 0;
}
</style>
