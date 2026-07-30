<template>
  <footer v-if="githubItem && repositoryLabel" class="footer-bar">
    <a :href="githubItem.link" target="_blank" rel="noopener noreferrer" aria-label="在新窗口打开 GitHub 项目">
      GitHub 项目 · {{ repositoryLabel }}
    </a>
  </footer>
</template>

<script>
import { getGithubMenuItem, getGithubRepositoryLabel } from '@/features/site/github';

export default {
  name: 'FooterBar',
  data() {
    return {
      menuItems: Array.isArray(window.config?.menuItem) ? window.config.menuItem : [],
    };
  },
  computed: {
    githubItem() {
      return getGithubMenuItem(this.menuItems);
    },
    repositoryLabel() {
      return getGithubRepositoryLabel(this.githubItem);
    },
  },
};
</script>

<style scoped>
.footer-bar {
  padding: 20px;
  text-align: center;
}

.footer-bar a {
  color: inherit;
}
</style>
