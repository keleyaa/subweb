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
  width: calc(100% - 40px);
  max-width: 860px;
  margin: 0 auto 24px;
  padding: 14px 20px;
  border: 1px solid var(--surface-glass-edge);
  border-radius: 20px;
  background: var(--surface-glass-strong);
  box-shadow: var(--shadow-glass-soft);
  backdrop-filter: blur(18px) saturate(120%);
  text-align: center;
}

.footer-bar a {
  color: var(--text-secondary);
  font-size: 13px;
  text-decoration: none;
  transition: color 180ms ease-out;
}

.footer-bar a:hover,
.footer-bar a:focus-visible {
  color: var(--text-primary);
}

.footer-bar a:focus-visible {
  border-radius: 4px;
  outline: 3px solid var(--focus-ring);
  outline-offset: 3px;
}

@media (prefers-reduced-transparency: reduce) {
  .footer-bar {
    backdrop-filter: none;
  }
}

@media (max-width: 575.98px) {
  .footer-bar {
    width: calc(100% - 32px);
    margin-bottom: 16px;
  }
}
</style>
