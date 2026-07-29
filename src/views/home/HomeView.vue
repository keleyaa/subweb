<template>
  <main class="home-workspace">
    <div class="home-workspace__inner">
      <header class="home-workspace__heading">
        <h1>订阅转换</h1>
        <p>将订阅链接和节点转换为目标客户端配置。</p>
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
  min-height: calc(100vh - 57px);
}

.home-workspace__inner {
  max-width: 860px;
  margin: 0 auto;
  padding: 48px 20px 64px;
}

.home-workspace__heading {
  margin-bottom: 28px;
}

.home-workspace__heading h1 {
  margin: 0 0 8px;
  color: #1d1d1f;
  font-size: 32px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.2;
}

.home-workspace__heading p {
  margin: 0;
  color: #6e6e73;
  font-size: 15px;
  line-height: 1.5;
}

@media (max-width: 575.98px) {
  .home-workspace__inner {
    padding: 28px 16px 40px;
  }

  .home-workspace__heading {
    margin-bottom: 20px;
  }

  .home-workspace__heading h1 {
    font-size: 27px;
  }
}
</style>
