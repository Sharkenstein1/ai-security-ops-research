'use strict';

const express = require('express');
const { AppError } = require('./domain');
const { makeHandler } = require('./handler');

function statusFor(code) {
  if (code === 'UNAUTHENTICATED') return 401;
  if (code === 'FORBIDDEN' || code === 'OWNER_ONLY') return 403;
  if (code === 'SERVER_ERROR' || code === 'WECHAT_CONFIG_ERROR') return 503;
  if (code === 'RATE_LIMITED') return 429;
  return 400;
}

function createApp({ service, sessions, store, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb', strict: true }));
  const handler = makeHandler(service, logger);

  app.get(['/', '/healthz'], async (request, response) => {
    try {
      await store.health();
      response.json({ status: 'ok' });
    } catch (error) { response.status(503).json({ status: 'unavailable' }); }
  });

  app.post('/api/game', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      const { action, payload } = request.body || {};
      let result;
      if (action === 'login' && payload && Object.prototype.hasOwnProperty.call(payload, 'code')) {
        result = { ok: true, data: await sessions.login(payload.code) };
      } else {
        // 不信任可伪造的 OPENID 请求字段或 X-WX-* 头；身份只由服务端校验的会话决定。
        const userId = await sessions.authenticate(request.get('X-Points-Session'));
        result = await handler(action, userId, payload);
      }
      response.status(result.ok ? 200 : statusFor(result.error.code)).json(result);
    } catch (error) {
      if (error instanceof AppError) {
        response.status(statusFor(error.code)).json({ ok: false, error: { code: error.code, message: error.message } });
      } else {
        logger.error('gameApi request failed', { code: error.code || 'UNKNOWN' });
        response.status(503).json({ ok: false, error: { code: 'SERVER_ERROR', message: '服务暂时不可用，请查看服务日志与数据库配置' } });
      }
    }
  });

  app.use((request, response) => response.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在，请核对部署版本与请求路径' } }));
  app.use((error, request, response, next) => {
    const tooLarge = error.type === 'entity.too.large';
    response.status(tooLarge ? 413 : 400).json({ ok: false, error: { code: 'INVALID_INPUT', message: tooLarge ? '请求内容过大' : '请求格式无效' } });
  });
  return app;
}

module.exports = { createApp };
