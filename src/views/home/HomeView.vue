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
  display: flex;
  flex: 1;
  flex-direction: column;
}

.home-workspace__inner {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 52px 20px 44px;
}

.home-workspace__heading {
  margin-bottom: 32px;
  text-align: center;
}

.home-workspace__heading h1 {
  margin: 0 0 8px;
  color: var(--text-primary);
  font-size: 34px;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.2;
}

.home-workspace__heading p {
  max-width: 480px;
  margin: 0 auto;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.5;
}

@media (max-width: 575.98px) {
  .home-workspace__inner {
    padding: 32px 16px 28px;
  }

  .home-workspace__heading {
    margin-bottom: 24px;
  }

  .home-workspace__heading h1 {
    font-size: 28px;
  }
}
</style>
