<template>
  <main class="home-workspace" :class="presentation.rootClass">
    <div class="home-workspace__inner">
      <header class="home-workspace__heading">
        <h1>{{ presentation.title }}</h1>
        <p v-if="presentation.description">{{ presentation.description }}</p>
      </header>
      <SubTable :mode="uxMode" />
    </div>
  </main>
</template>

<script>
import SubTable from './SubTable.vue';
import { getHomePresentation } from './presentation';

export default {
  name: 'SubconverterView',
  components: {
    SubTable,
  },
  data() {
    return {
      uxMode: window.config.uxMode,
    };
  },
  computed: {
    presentation() {
      return getHomePresentation(this.uxMode);
    },
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
