import { ElNotification } from 'element-plus';
import 'element-plus/es/components/notification/style/css';

const showNotification = function (message = '', title = '成功', type = title === '成功' ? 'success' : 'error') {
  if (typeof type === 'boolean') {
    type = type ? 'success' : 'error';
  }

  ElNotification({
    type: type,
    title: title,
    message: message,
    showClose: false,
    offset: 70,
    duration: 1500,
  });
};

export default showNotification;
