'use strict';

const crypto = require('node:crypto');
const { AppError, userIdFor } = require('./domain');
const SESSION_TTL = 12 * 60 * 60 * 1000;

function createWeChatExchange({ appId, appSecret, fetcher = fetch }) {
  return async code => {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(code)) {
      throw new AppError('WECHAT_LOGIN_FAILED', '微信登录凭证无效，请重新登录');
    }
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({ appid: appId, secret: appSecret, js_code: code, grant_type: 'authorization_code' });
    let result;
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) throw new Error('upstream unavailable');
      result = await response.json();
    } catch (error) {
      throw new AppError('WECHAT_UNAVAILABLE', '暂时无法连接微信登录服务，请稍后重试');
    }
    if (result.errcode || typeof result.openid !== 'string' || !result.openid) {
      if ([40013, 40125, 40164].includes(Number(result.errcode))) {
        throw new AppError('WECHAT_CONFIG_ERROR', '微信登录配置异常，请核对服务环境变量中的 AppID、AppSecret 和接口 IP 白名单');
      }
      throw new AppError('WECHAT_LOGIN_FAILED', '微信登录凭证已失效，请重新登录');
    }
    return result.openid;
  };
}

class Sessions {
  constructor(store, service, exchange, options = {}) {
    this.store = store;
    this.service = service;
    this.exchange = exchange;
    this.now = options.now || Date.now;
    this.randomToken = options.randomToken || (() => crypto.randomBytes(32).toString('base64url'));
  }

  key(token) { return `s_${crypto.createHash('sha256').update(token).digest('hex')}`; }

  async login(code) {
    const openid = await this.exchange(code);
    const userId = userIdFor(openid);
    const profile = await this.service.execute('login', userId);
    const token = this.randomToken();
    const expiresAt = this.now() + SESSION_TTL;
    await this.store.transaction(tx => tx.set('sessions', this.key(token), { userId, expiresAt }));
    return { ...profile, session: { token, expiresAt } };
  }

  async authenticate(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new AppError('UNAUTHENTICATED', '请重新登录');
    }
    const session = await this.store.get('sessions', this.key(token));
    if (!session || session.expiresAt <= this.now()) throw new AppError('UNAUTHENTICATED', '登录已过期，请重新登录');
    return session.userId;
  }
}

module.exports = { Sessions, createWeChatExchange, SESSION_TTL };
