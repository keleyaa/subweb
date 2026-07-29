import { computed } from 'vue';
import { defineStore } from 'pinia';
import vuexStore from '@/store';

export const useStyleFacadeStore = defineStore('style-facade', () => {
  const isCollapsed = computed(() => vuexStore.state.style.main.isCollapsed);
  const navStyles = computed(() => Array.from(vuexStore.state.style.main.navStyles));

  function toggleMenu() {
    vuexStore.commit('MAIN_LAYOUT_MENU_EXPAND');
  }

  function closeMenu() {
    vuexStore.commit('MAIN_LAYOUT_MENU_EXPAND_CLOSE');
  }

  function setNavActive(active) {
    vuexStore.commit('MAIN_LAYOUT_NAV_ACTIVE', active);
  }

  return {
    isCollapsed,
    navStyles,
    toggleMenu,
    closeMenu,
    setNavActive,
  };
});
