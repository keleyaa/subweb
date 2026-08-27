<template>
  <MainLayout />
  <DialogView v-if="dialog.active" />
</template>

<script>
import DialogView from '@/components/dialog/DialogView.vue';
import { dialogState } from '@/components/dialog';
import MainLayout from '@/layouts/main/MainLayout.vue';

export default {
  name: 'App',
  components: { DialogView, MainLayout },
  computed: {
    dialog() {
      return dialogState;
    },
  },
};
</script>

<style>
@import '@/styles/base.css';
</style>
