<template>
  <div
    class="main-layout light-style layout-navbar-fixed layout-wide"
    dir="ltr"
    data-theme="theme-default"
    data-assets-path="assets/"
    data-template="front-pages"
    @wheel="setNavActive"
  >
    <nav-bar />
    <router-view />
    <footer-bar />
  </div>
</template>

<script>
import NavBar from './navbar/NavBar.vue';
import FooterBar from './footer/FooterBar.vue';
import { useStyleFacadeStore } from '@/stores/styleFacade';

export default {
  components: { NavBar, FooterBar },
  name: 'MainLayout',
  setup() {
    return { styleFacade: useStyleFacadeStore() };
  },
  methods: {
    setNavActive() {
      const scrollY = window.scrollY || window.pageYOffset;
      // 设置 MAIN_LAYOUT_NAV_ACTIVE 根据滚动位置
      this.styleFacade.setNavActive(scrollY > 0);
    },
  },
  mounted() {
    // 在组件挂载后，添加滚动事件监听器
    window.addEventListener('scroll', this.setNavActive);
  },
  beforeUnmount() {
    // 在组件销毁前，移除滚动事件监听器，以防止内存泄漏
    window.removeEventListener('scroll', this.setNavActive);
  },
};
</script>

<style scoped>
@import '@/assets/vendor/css/pages/front-page.css';
@import '@/assets/vendor/css/pages/front-page-landing.css';

.main-layout.light-style {
  background-color: #fff;
}

.main-layout.dark-style {
  background-color: #2f3349;
}
</style>
