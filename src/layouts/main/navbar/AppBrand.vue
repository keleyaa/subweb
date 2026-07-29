<template>
  <router-link to="/" class="app-brand-link" :aria-label="`${siteName}，返回首页`">
    <span class="app-brand-mark" aria-hidden="true">S</span>
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
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  background: #1d1d1f;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}

.app-brand-text {
  font-size: 15px;
  font-weight: 600;
}
</style>
