<template>
  <main class="home-workspace">
    <div class="home-workspace__inner">
      <header class="home-workspace__heading">
        <h1>订阅转换</h1>
      </header>
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
  max-width: 46rem;
  margin: 0 auto;
  padding: 36px 20px 40px;
}

.home-workspace__heading {
  margin-bottom: 24px;
  text-align: center;
}

.home-workspace__heading h1 {
  margin: 0;
  color: var(--text-primary);
  font-size: 30px;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.2;
}

@media (max-width: 575.98px) {
  .home-workspace__inner {
    padding: 24px 16px 28px;
  }

  .home-workspace__heading {
    margin-bottom: 20px;
  }

  .home-workspace__heading h1 {
    font-size: 28px;
  }
}
</style>
