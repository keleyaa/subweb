import { createApp } from 'vue';
import App from './App.vue';
import { showDialog, closeDialog } from '@/components/dialog';
import { installRuntimeConfig } from './runtime/config';
installRuntimeConfig(window);
const app = createApp(App);

app.config.globalProperties.$showDialog = showDialog;
app.config.globalProperties.$closeDialog = closeDialog;
app.mount('#app');
