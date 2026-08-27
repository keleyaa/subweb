<template>
  <div class="dialog-layer" @click.self="closeDialog">
    <section
      class="dialog-panel"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-message"
      tabindex="-1"
    >
      <span class="dialog-tone" :class="`dialog-tone--${dialog.tone}`" aria-hidden="true">{{ toneSymbol }}</span>
      <h2 id="dialog-title">{{ dialog.title }}</h2>
      <p id="dialog-message">{{ dialog.message }}</p>
      <div class="dialog-actions">
        <button
          v-if="dialog.isConfirmation"
          type="button"
          class="dialog-button dialog-button--secondary"
          @click="closeDialog"
        >
          {{ dialog.buttonText.cancelText }}
        </button>
        <button type="button" class="dialog-button" @click="confirmDialog">
          {{ dialog.buttonText.confirmText }}
        </button>
      </div>
    </section>
  </div>
</template>

<script>
import { closeDialog, dialogState } from './index.js';

const TONE_SYMBOLS = {
  error: '×',
  info: 'i',
  success: '✓',
  warning: '!',
};

export default {
  name: 'DialogView',
  computed: {
    dialog() {
      return dialogState;
    },
    toneSymbol() {
      return TONE_SYMBOLS[this.dialog.tone] || TONE_SYMBOLS.info;
    },
  },
  methods: {
    closeDialog() {
      closeDialog();
    },
    confirmDialog() {
      const callback = this.dialog.callbackFunction;

      this.closeDialog();
      if (callback) {
        callback();
      }
    },
  },
};
</script>

<style scoped>
.dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: blur(6px);
}

.dialog-panel {
  display: grid;
  width: min(100%, 28rem);
  gap: 14px;
  padding: 24px;
  border: 1px solid var(--surface-glass-edge);
  border-radius: 16px;
  background: var(--surface-overlay);
  box-shadow: var(--shadow-glass);
  backdrop-filter: blur(20px) saturate(120%);
}

.dialog-tone {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  background: var(--tone-neutral);
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 700;
}

.dialog-tone--error {
  background: var(--tone-error);
  color: var(--error);
}

.dialog-tone--success {
  background: var(--tone-success);
  color: var(--success);
}

.dialog-tone--warning {
  background: var(--tone-warning);
  color: var(--warning);
}

.dialog-panel h2,
.dialog-panel p {
  margin: 0;
}

.dialog-panel h2 {
  color: var(--text-primary);
  font-size: 20px;
  line-height: 1.3;
}

.dialog-panel p {
  color: var(--text-secondary);
  line-height: 1.5;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}

.dialog-button {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--accent);
  border-radius: 12px;
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-weight: 500;
}

.dialog-button--secondary {
  border-color: var(--control-border);
  background: var(--surface-control);
  color: var(--text-primary);
}

.dialog-button:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}

@media (prefers-reduced-transparency: reduce) {
  .dialog-layer,
  .dialog-panel {
    backdrop-filter: none;
  }
}
</style>
