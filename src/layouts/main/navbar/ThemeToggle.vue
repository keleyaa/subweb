<template>
  <button
    type="button"
    class="theme-toggle"
    :aria-label="label"
    :aria-pressed="isDark"
    :title="label"
    @click="toggleTheme"
  >
    <span class="theme-toggle__indicator" aria-hidden="true"></span>
    <span>{{ modeLabel }}</span>
  </button>
</template>

<script>
import { THEMES, getNextTheme, isTheme, saveThemeAndApply } from '@/features/theme/theme';

function getAppliedTheme() {
  if (typeof document === 'undefined') return THEMES.LIGHT;

  try {
    const theme = document.documentElement?.dataset?.theme;
    return isTheme(theme) ? theme : THEMES.LIGHT;
  } catch {
    return THEMES.LIGHT;
  }
}

export default {
  name: 'ThemeToggle',
  data() {
    return {
      theme: getAppliedTheme(),
    };
  },
  computed: {
    isDark() {
      return this.theme === THEMES.DARK;
    },
    label() {
      return this.isDark ? '切换到浅色模式' : '切换到深色模式';
    },
    modeLabel() {
      return this.isDark ? '深色显示' : '浅色显示';
    },
  },
  methods: {
    toggleTheme() {
      this.theme = saveThemeAndApply(getNextTheme(this.theme));
    },
  },
};
</script>

<style scoped>
.theme-toggle {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  transition: border-color 180ms ease, color 180ms ease, background-color 180ms ease;
}

.theme-toggle__indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}

.theme-toggle:hover {
  border-color: var(--line-strong);
  background: var(--surface-hover);
  color: var(--text-primary);
}

.theme-toggle:active {
  transform: translateY(1px);
}

.theme-toggle:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 3px;
}
</style>
