<template>
  <div>
    <router-view />
    <dialog-view v-if="$store.state.app.dialog.active"></dialog-view>
  </div>
</template>

<script>
export default {
  name: 'app',
};
</script>

<style>
@import '@/styles/base.css';
</style>
