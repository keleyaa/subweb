<template>
  <footer class="footer-bar">
    <span>Subconverter Web. / Public utility</span>
    <a
      v-if="githubItem && repositoryLabel"
      :href="githubItem.link"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="在新窗口打开 GitHub 项目"
    >
      {{ repositoryLabel }}
    </a>
    <span v-else>隐私优先 · 无需登录</span>
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
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 30px 30px;
  color: #737674;
  font-size: 11px;
}

.footer-bar a {
  color: #8d918f;
  text-decoration: none;
}

.footer-bar a:hover {
  color: var(--text-primary);
}

.footer-bar a:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 3px;
}

@media (max-width: 640px) {
  .footer-bar {
    padding: 0 18px 18px;
    font-size: 10px;
  }

  .footer-bar a {
    display: none;
  }
}
</style>
