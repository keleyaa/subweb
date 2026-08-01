<template>
  <main class="home-workspace" aria-labelledby="conversion-title">
    <div class="home-workspace__inner">
      <h2 id="conversion-title" class="visually-hidden">订阅转换</h2>
      <SubTable />
    </div>
  </main>
</template>

<script>
import SubTable from './SubTable.vue';

export default {
  name: 'HomeView',
  components: {
    SubTable,
  },
};
</script>

<style scoped>
.home-workspace {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.home-workspace__inner {
  width: 100%;
  max-width: 52rem;
  margin: 0 auto;
  padding: 20px 20px 48px;
}

@media (max-width: 575.98px) {
  .home-workspace__inner {
    padding: 16px 16px 32px;
  }
}
</style>
