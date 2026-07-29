<template>
  <nav class="layout-navbar shadow-none py-0" :class="styleFacade.navStyles">
    <div class="container">
      <div class="navbar navbar-expand-lg landing-navbar px-3 px-md-4">
        <AppBrand ref="appBrand" />
        <NavMenu @close="focusMenuToggle" />
      </div>
    </div>
  </nav>
</template>

<script>
import AppBrand from './AppBrand.vue';
import NavMenu from './NavMenu.vue';
import { useStyleFacadeStore } from '@/stores/styleFacade';
export default {
  name: 'NavBar',
  components: {
    AppBrand,
    NavMenu,
  },
  setup() {
    return { styleFacade: useStyleFacadeStore() };
  },
  methods: {
    focusMenuToggle() {
      this.$refs.appBrand.focusMenuToggle();
    },
  },
};
</script>

<style scoped>
.navbar.landing-navbar {
  transform: none !important;
}
</style>
