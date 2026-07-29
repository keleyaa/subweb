<template>
  <div
    lang="en"
    class="light-style layout-navbar-fixed layout-compact layout-menu-fixed swal2-shown swal2-height-auto"
    dir="ltr"
  >
    <div class="dialog-custom swal2-container swal2-center swal2-backdrop-show" style="overflow-y: auto">
      <div
        aria-labelledby="swal2-title"
        aria-describedby="swal2-html-container"
        class="swal2-popup swal2-modal swal2-icon-success swal2-show"
        tabindex="-1"
        role="dialog"
        aria-live="assertive"
        aria-modal="true"
        style="display: grid"
      >
        <component :is="$store.state.app.dialog.icon" />
        <!-- icon -->
        <h2 class="swal2-title" style="display: block">
          {{ $store.state.app.dialog.title }}
        </h2>
        <!-- title -->
        <div class="swal2-html-container" style="display: block">
          {{ $store.state.app.dialog.message }}
        </div>
        <!-- message -->
        <div class="swal2-actions" style="display: flex">
          <component :is="$store.state.app.dialog.button" />
        </div>
        <!-- button -->
      </div>
    </div>
  </div>
</template>

<script>
import IconSuccess from './icon/success.vue';
import IconInfo from './icon/info.vue';
import IconWarning from './icon/warning.vue';
import IconError from './icon/error.vue';
import ButtonDefault from './button/ButtonDefault.vue';
import ButtonSuccess from './button/ButtonSuccess.vue';
import ButtonWarning from './button/ButtonWarning.vue';
import ButtonError from './button/ButtonError.vue';
import ButtonConfirmDefault from './button/ConfirmDefault.vue';
import ButtonConfirmSuccess from './button/ConfirmSuccess.vue';
import ButtonConfirmWarning from './button/ConfirmWarning.vue';
import ButtonConfirmError from './button/ConfirmError.vue';
export default {
  name: 'DialogView',
  components: {
    ButtonConfirmDefault,
    ButtonConfirmSuccess,
    ButtonConfirmWarning,
    ButtonConfirmError,
    ButtonDefault,
    ButtonSuccess,
    ButtonWarning,
    ButtonError,
    IconSuccess,
    IconInfo,
    IconWarning,
    IconError,
  },
};
</script>

<style scoped>
.dialog-custom {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(32, 34, 51, 0.45);
}

.swal2-popup {
  width: min(100%, 30rem);
  gap: 16px;
  padding: 24px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 16px 40px rgba(32, 34, 51, 0.24);
}

.swal2-title {
  margin: 0;
  color: #2f3349;
  font-size: 20px;
}

.swal2-html-container {
  color: #5e5873;
}

.swal2-actions {
  justify-content: center;
  gap: 12px;
}
</style>
