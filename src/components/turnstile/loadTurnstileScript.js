const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_SCRIPT_TIMEOUT_MS = 10_000;
let scriptPromise;

export function loadTurnstileScript({ documentObject = document, windowObject = window } = {}) {
  if (windowObject.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    let script = documentObject.querySelector('script[data-turnstile]');
    if (script && script.dataset.turnstileState !== 'loading') {
      script.remove();
      script = null;
    }

    if (!script) {
      script = documentObject.createElement('script');
      script.dataset.turnstile = 'true';
      script.dataset.turnstileState = 'loading';
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
    }

    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.dataset.turnstileState = 'failed';
      script.remove();
      reject(new Error('Turnstile script failed to load'));
    };
    script.addEventListener('load', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.dataset.turnstileState = 'loaded';
      resolve();
    }, { once: true });
    script.addEventListener('error', fail, { once: true });
    timeout = setTimeout(fail, TURNSTILE_SCRIPT_TIMEOUT_MS);
    if (!script.isConnected) documentObject.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = undefined;
    throw error;
  });

  return scriptPromise;
}

export function resetTurnstileScriptLoader() {
  scriptPromise = undefined;
}
