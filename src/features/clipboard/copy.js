function copyWithExecCommand(value, documentObject) {
  if (!documentObject?.body || typeof documentObject.createElement !== 'function') {
    throw new Error('copy failed');
  }

  const input = documentObject.createElement('input');
  try {
    input.setAttribute('value', value);
    documentObject.body.appendChild(input);
    input.select();

    if (typeof documentObject.execCommand !== 'function' || !documentObject.execCommand('copy')) {
      throw new Error('copy failed');
    }
  } finally {
    if (input.parentNode) {
      input.parentNode.removeChild(input);
    }
  }
}

export async function copyText(
  value,
  { navigatorObject = globalThis.navigator, documentObject = globalThis.document } = {}
) {
  if (typeof navigatorObject?.clipboard?.writeText === 'function') {
    try {
      await navigatorObject.clipboard.writeText(value);
      return;
    } catch {
      // Some browsers expose Clipboard API but deny it outside a user gesture.
    }
  }

  copyWithExecCommand(value, documentObject);
}
