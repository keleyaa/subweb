<template>
  <a
    v-if="githubItem"
    :href="githubItem.link"
    :target="githubItem.target"
    :title="githubItem.title"
    class="minimal-nav-link"
    rel="noopener noreferrer"
  >
    {{ githubItem.title }}
  </a>
</template>

<script>
import { getGithubMenuItem } from './navigation';

export default {
  name: 'NavMenu',
  data() {
    return {
      navBarItem: Array.isArray(window.config?.menuItem) ? window.config.menuItem : [],
    };
  },
  computed: {
    githubItem() {
      return getGithubMenuItem(this.navBarItem);
    },
  },
};
</script>

<style scoped>
.minimal-nav-link {
  display: inline-flex;
  min-height: 44px;
  padding: 0 4px;
  align-items: center;
  color: #424245;
  font-size: 14px;
  text-decoration: none;
}

.minimal-nav-link:hover,
.minimal-nav-link:focus-visible {
  color: #06c;
}

.minimal-nav-link:focus-visible {
  border-radius: 4px;
  outline: 3px solid #0066cc;
  outline-offset: 2px;
}
</style>
