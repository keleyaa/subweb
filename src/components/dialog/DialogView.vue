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
      return this.$store.state.app.dialog;
    },
    toneSymbol() {
      return TONE_SYMBOLS[this.dialog.tone] || TONE_SYMBOLS.info;
    },
  },
  methods: {
    closeDialog() {
      this.$store.commit('SET_DIALOG_CLOSE');
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
  background: rgba(29, 29, 31, 0.36);
}

.dialog-panel {
  display: grid;
  width: min(100%, 28rem);
  gap: 14px;
  padding: 24px;
  border: 1px solid #d2d2d7;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(29, 29, 31, 0.2);
}

.dialog-tone {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  background: #e8e8ed;
  color: #1d1d1f;
  font-size: 18px;
  font-weight: 700;
}

.dialog-tone--error {
  background: #fce8e6;
  color: #b3261e;
}

.dialog-tone--success {
  background: #e5f4ea;
  color: #1f7a35;
}

.dialog-tone--warning {
  background: #fff3d6;
  color: #8a5a00;
}

.dialog-panel h2,
.dialog-panel p {
  margin: 0;
}

.dialog-panel h2 {
  color: #1d1d1f;
  font-size: 20px;
  line-height: 1.3;
}

.dialog-panel p {
  color: #424245;
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
  border: 1px solid #0071e3;
  border-radius: 8px;
  background: #0071e3;
  color: #fff;
  font: inherit;
  font-weight: 500;
}

.dialog-button--secondary {
  border-color: #c7c7cc;
  background: #fff;
  color: #1d1d1f;
}

.dialog-button:focus-visible {
  outline: 3px solid #0066cc;
  outline-offset: 2px;
}
</style>
