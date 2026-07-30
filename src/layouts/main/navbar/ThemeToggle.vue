<template>
  <button
    type="button"
    class="theme-toggle"
    :aria-label="label"
    :aria-pressed="isDark"
    :title="label"
    @click="toggleTheme"
  >
    <svg v-if="isDark" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path
        d="M12 4v2m0 12v2M4 12h2m12 0h2m-14.34-5.66 1.42 1.42m10.24 10.24 1.42 1.42m0-12.66-1.42 1.42M7.08 16.92l-1.42 1.42M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
    <svg v-else aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M20.31 15.56A8 8 0 0 1 8.44 3.69 8 8 0 1 0 20.31 15.56Z" />
    </svg>
  </button>
</template>

<script>
import { THEMES, getNextTheme, isTheme, saveThemeAndApply } from '@/features/theme/theme';

function getAppliedTheme() {
  if (typeof document === 'undefined') {
    return THEMES.LIGHT;
  }

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
  width: 44px;
  min-width: 44px;
  height: 44px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  transition: background-color 180ms ease-out, border-color 180ms ease-out, color 180ms ease-out,
    transform 180ms ease-out;
}

.theme-toggle:hover {
  border-color: var(--separator);
  background: var(--surface-muted);
  color: var(--text-primary);
}

.theme-toggle:active {
  transform: scale(0.985);
}

.theme-toggle:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}

.theme-toggle svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

@media (prefers-reduced-motion: reduce) {
  .theme-toggle {
    transition-duration: 0.01ms;
  }

  .theme-toggle:active {
    transform: none;
  }
}
</style>
