async function call(action, payload = {}) {
  if (!getApp().globalData.cloudReady) {
    const error = new Error('服务尚未配置，请按 README 设置云环境后重试');
    error.code = 'CONFIG_REQUIRED';
    throw error;
  }
  let response;
  try {
    response = await wx.cloud.callFunction({ name: 'gameApi', data: { action, payload } });
  } catch (cause) {
    const error = new Error('连接失败，请检查网络，以及云函数是否已部署到当前环境');
    error.code = 'NETWORK_ERROR';
    throw error;
  }
  const result = response.result;
  if (!result || result.ok !== true) {
    const detail = result && result.error;
    const error = new Error(detail && detail.message || '服务返回异常，请稍后重试');
    error.code = detail && detail.code || 'SERVER_ERROR';
    throw error;
  }
  return result.data;
}

function showError(error) {
  wx.showModal({ title: '暂时无法完成', content: error.message || '请稍后重试', showCancel: false });
}

function requestKey() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = { call, showError, requestKey };
