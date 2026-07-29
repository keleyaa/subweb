<template>
  <div
    id="navbarSupportedContent"
    class="navbar-collapse landing-nav-menu collapse"
    :class="{ show: styleFacade.isCollapsed }"
    :inert="isMobileDrawerClosed"
    :aria-hidden="String(isMobileDrawerClosed)"
    @keydown.esc.stop.prevent="closeMenu"
  >
    <button
      class="navbar-toggler border-0 text-heading position-absolute end-0 top-0 scaleX-n1-rtl mobile-menu-toggle"
      type="button"
      data-bs-toggle="collapse"
      data-bs-target="#navbarSupportedContent"
      aria-controls="navbarSupportedContent"
      :aria-expanded="String(styleFacade.isCollapsed)"
      aria-label="关闭导航"
      @click="closeMenu"
    >
      <Close class="mobile-menu-icon" aria-hidden="true" />
    </button>
    <ul class="navbar-nav ms-auto">
      <li class="nav-item" v-for="i in navBarItem" :key="i">
        <a :href="i.link" :target="i.target" class="nav-link fw-medium">{{ i.title }}</a>
      </li>
    </ul>
  </div>
  <div class="landing-menu-overlay d-lg-none" @click="closeMenu"></div>
</template>

<script>
import { Close } from '@element-plus/icons-vue';
import { useStyleFacadeStore } from '@/stores/styleFacade';

export default {
  name: 'NavMenu',
  components: { Close },
  emits: ['close'],
  setup() {
    return { styleFacade: useStyleFacadeStore() };
  },
  data() {
    return {
      navBarItem: [],
      isMobileViewport: window.matchMedia('(max-width: 991.98px)').matches,
    };
  },
  computed: {
    isMobileDrawerClosed() {
      return this.isMobileViewport && !this.styleFacade.isCollapsed;
    },
  },
  created() {
    this.navBarItem = window.config.menuItem;
  },
  mounted() {
    this.mobileViewportQuery = window.matchMedia('(max-width: 991.98px)');
    this.mobileViewportChangeHandler = (event) => this.updateMobileViewport(event);
    this.mobileViewportQuery.addEventListener('change', this.mobileViewportChangeHandler);
  },
  beforeUnmount() {
    this.mobileViewportQuery?.removeEventListener('change', this.mobileViewportChangeHandler);
  },
  methods: {
    updateMobileViewport(event) {
      this.isMobileViewport = event.matches;
      if (!event.matches) {
        this.styleFacade.closeMenu();
      }
    },
    closeMenu() {
      if (!this.styleFacade.isCollapsed) {
        return;
      }

      this.styleFacade.closeMenu();
      this.$nextTick(() => {
        this.$emit('close');
      });
    },
  },
};
</script>

<style scoped>
.mobile-menu-toggle {
  width: 32px;
  height: 32px;
}

.mobile-menu-icon {
  width: 20px;
  height: 20px;
}

@media (max-width: 991.98px) {
  .mobile-menu-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .landing-nav-menu {
    position: fixed;
    top: 0;
    inset-inline-start: -100%;
    z-index: 9999;
    display: block !important;
    width: 80%;
    max-width: 300px;
    height: 100%;
    padding: 16px;
    overflow-y: auto;
    background-color: #fff;
    transition: all 0.3s ease-in-out;
  }

  .landing-nav-menu.show {
    inset-inline-start: 0;
  }

  .landing-menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 9998;
    display: none;
    background-color: rgba(75, 70, 92, 0.78);
    transition: all 0.2s ease-in-out;
  }

  .landing-nav-menu.show ~ .landing-menu-overlay {
    display: block;
  }
}

@media (min-width: 992px) {
  .mobile-menu-toggle {
    display: none !important;
  }
}
</style>
