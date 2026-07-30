<template>
  <router-link to="/" class="app-brand-link" :aria-label="`${siteName}，返回首页`">
    <img class="app-brand-mark" src="/favicon.svg" width="28" height="28" alt="" />
    <span class="app-brand-text">{{ siteName }}</span>
  </router-link>
</template>

<script>
export default {
  name: 'AppBrand',
  data() {
    return {
      siteName: window.config.siteName,
    };
  },
};
</script>

<style scoped>
.app-brand-link {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #1d1d1f;
  text-decoration: none;
}

.app-brand-link:focus-visible {
  outline: 3px solid #0066cc;
  outline-offset: 2px;
  border-radius: 4px;
}

.app-brand-mark {
  display: block;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
}

.app-brand-text {
  font-size: 15px;
  font-weight: 600;
}
</style>
