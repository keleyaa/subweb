import { createApp } from 'vue';
import App from './App.vue';
import { showDialog, closeDialog } from '@/components/dialog';
import { installRuntimeConfig } from './runtime/config';
import { initializeTheme } from './features/theme/theme';

installRuntimeConfig(window);
initializeTheme();
const app = createApp(App);

app.config.globalProperties.$showDialog = showDialog;
app.config.globalProperties.$closeDialog = closeDialog;
app.mount('#app');
