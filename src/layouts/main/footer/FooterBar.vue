<template>
  <footer v-if="githubItem && repositoryLabel" class="footer-bar">
    <a :href="githubItem.link" target="_blank" rel="noopener noreferrer" aria-label="在新窗口打开 GitHub 项目">
      <span class="footer-bar__mark" aria-hidden="true">GH</span>
      <span class="footer-bar__copy">
        <strong>{{ repositoryLabel }}</strong>
        <small>Vue 3 · GPL-3.0</small>
      </span>
      <span class="footer-bar__external" aria-hidden="true">↗</span>
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
  max-width: 52rem;
  margin: 0 auto 32px;
  padding: 8px 20px;
}

.footer-bar a {
  display: grid;
  grid-template-columns: auto minmax(0, auto) auto;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
  padding: 10px 12px;
  align-items: center;
  gap: 10px;
  border-radius: 14px;
  color: var(--text-secondary);
  font-size: 13px;
  text-decoration: none;
  transition: background-color 180ms ease-out, box-shadow 180ms ease-out, color 180ms ease-out,
    transform 110ms ease-out;
}

.footer-bar a:hover {
  background: var(--surface-control);
  box-shadow: var(--shadow-glass-soft);
  color: var(--text-primary);
}

.footer-bar a:active {
  transform: scale(0.98);
}

.footer-bar a:focus-visible {
  border-radius: 4px;
  outline: 3px solid var(--focus-ring);
  outline-offset: 3px;
}

.footer-bar__mark {
  display: grid;
  width: 34px;
  height: 34px;
  border: 1px solid var(--control-border);
  border-radius: 50%;
  place-items: center;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 750;
}

.footer-bar__copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.footer-bar strong,
.footer-bar small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-bar strong {
  color: var(--text-primary);
  font-size: 13px;
}

.footer-bar small {
  color: var(--text-muted);
  font-size: 11px;
}

.footer-bar__external {
  font-size: 14px;
}

@media (max-width: 575.98px) {
  .footer-bar {
    width: calc(100% - 32px);
    margin-bottom: 16px;
  }
}
</style>
