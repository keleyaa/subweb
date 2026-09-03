<template>
  <section class="turnstile-challenge" aria-live="polite">
    <p>{{ message }}</p>
    <div ref="host" class="turnstile-host" aria-label="Turnstile 验证"></div>
  </section>
</template>

<script>
let scriptPromise;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-turnstile]');
    if (script && script.dataset.turnstileState !== 'loading') {
      script.remove();
      script = null;
    }

    if (!script) {
      script = document.createElement('script');
      script.dataset.turnstile = 'true';
      script.dataset.turnstileState = 'loading';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
    }

    script.addEventListener(
      'load',
      () => {
        script.dataset.turnstileState = 'loaded';
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => {
        script.remove();
        reject(new Error('Turnstile script failed to load'));
      },
      { once: true },
    );
    if (!script.isConnected) document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = undefined;
    throw error;
  });

  return scriptPromise;
}

export default {
  name: 'TurnstileChallenge',
  props: {
    siteKey: { type: String, required: true },
    message: { type: String, required: true },
  },
  emits: ['token', 'error'],
  data() {
    return { disposed: false, widgetId: undefined };
  },
  mounted() {
    loadTurnstileScript()
      .then(() => {
        if (this.disposed || !window.turnstile) return;
        this.widgetId = window.turnstile.render(this.$refs.host, {
          sitekey: this.siteKey,
          action: 'create_link',
          callback: (token) => this.$emit('token', token),
          'error-callback': () => this.$emit('error'),
          'expired-callback': () => this.$emit('error'),
        });
      })
      .catch(() => this.$emit('error'));
  },
  beforeUnmount() {
    this.disposed = true;
    if (this.widgetId !== undefined) {
      if (typeof window.turnstile?.remove === 'function') {
        window.turnstile.remove(this.widgetId);
      } else {
        window.turnstile?.reset?.(this.widgetId);
      }
    }
  },
};
</script>

<style scoped>
.turnstile-challenge {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--control-border);
  border-radius: 14px;
  background: var(--surface-control);
}

.turnstile-challenge p {
  margin: 0;
  color: var(--warning);
  font-size: 14px;
}

.turnstile-host {
  min-height: 65px;
  overflow: hidden;
}
</style>
