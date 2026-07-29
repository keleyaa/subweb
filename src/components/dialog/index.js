const DIALOG_TONES = Object.freeze({
  default: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
  confirmDefault: 'info',
  confirmSuccess: 'success',
  confirmWarning: 'warning',
  confirmError: 'error',
});

const isConfirmation = (status) => typeof status === 'string' && status.startsWith('confirm');

export const createDialogPayload = function (
  status,
  title,
  message,
  callbackFunction = null,
  buttonText = { confirmText: '确认', cancelText: '取消' }
) {
  const labels = buttonText && typeof buttonText === 'object' ? buttonText : {};

  return {
    active: true,
    tone: DIALOG_TONES[status] || DIALOG_TONES.default,
    isConfirmation: isConfirmation(status),
    title: typeof title === 'string' ? title : '',
    message: typeof message === 'string' ? message : '',
    callbackFunction: typeof callbackFunction === 'function' ? callbackFunction : null,
    buttonText: {
      confirmText: typeof labels.confirmText === 'string' && labels.confirmText ? labels.confirmText : '确认',
      cancelText: typeof labels.cancelText === 'string' && labels.cancelText ? labels.cancelText : '取消',
    },
  };
};

const showDialog = function (...args) {
  const payload = createDialogPayload(...args);

  this.$store.commit('SET_DIALOG_ACTIVE', payload);
};

const closeDialog = function () {
  this.$store.commit('SET_DIALOG_CLOSE');
};

export { showDialog, closeDialog };
