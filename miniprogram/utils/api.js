const config = require('../config');
const storageKey = `points-session:${config.envId}:${config.service}`;
let session;
let loginPromise;

async function send(action, payload, token) {
  if (!getApp().globalData.cloudReady) {
    const error = new Error('服务尚未配置，请按 README 设置云环境后重试');
    error.code = 'CONFIG_REQUIRED';
    throw error;
  }
  let response;
  try {
    response = await wx.cloud.callContainer({
      config: { env: config.envId }, path: config.apiPath, method: 'POST', timeout: 20000,
      header: {
        'X-WX-SERVICE': config.service,
        'Content-Type': 'application/json',
        ...(token ? { 'X-Points-Session': token } : {})
      },
      data: { action, payload }
    });
  } catch (cause) {
    const error = new Error('连接失败，请检查网络和云托管服务部署状态');
    error.code = 'NETWORK_ERROR';
    throw error;
  }
  if (response.statusCode === 404) {
    const error = new Error('积分后端尚未部署，请先在当前云托管服务发布本项目，接口路径为 /api/game');
    error.code = 'BACKEND_NOT_DEPLOYED';
    throw error;
  }
  let result = response.data;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch (error) { result = null; }
  }
  if (!result || result.ok !== true) {
    const detail = result && result.error;
    const error = new Error(detail && detail.message || '服务返回异常，请稍后重试');
    error.code = detail && detail.code || 'SERVER_ERROR';
    throw error;
  }
  return result.data;
}

async function ensureSession(force = false) {
  if (force) {
    session = null;
    wx.removeStorageSync(storageKey);
  }
  if (!session) session = wx.getStorageSync(storageKey) || null;
  if (session && typeof session.token === 'string' && session.expiresAt > Date.now() + 60000) return session;
  if (!loginPromise) {
    loginPromise = (async () => {
      const credential = await wx.login({ timeout: 10000 });
      if (!credential.code) throw new Error('未取得微信登录凭证，请重新打开小程序');
      const result = await send('login', { code: credential.code });
      if (!result.session || typeof result.session.token !== 'string' || !Number.isFinite(result.session.expiresAt)) {
        throw new Error('登录服务返回异常，请检查后端部署版本');
      }
      session = result.session;
      wx.setStorageSync(storageKey, session);
      return session;
    })().finally(() => { loginPromise = null; });
  }
  return loginPromise;
}

async function call(action, payload = {}) {
  const current = await ensureSession();
  try {
    return await send(action, payload, current.token);
  } catch (error) {
    if (error.code !== 'UNAUTHENTICATED') throw error;
    const renewed = await ensureSession(true);
    return send(action, payload, renewed.token);
  }
}

function showError(error) {
  wx.showModal({ title: '暂时无法完成', content: error.message || '请稍后重试', showCancel: false });
}

function requestKey() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = { call, showError, requestKey };
