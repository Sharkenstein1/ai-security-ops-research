'use strict';

const { AppError, userIdFor } = require('./domain');

function makeHandler(service, getContext, logger = console) {
  return async event => {
    try {
      const context = getContext();
      const userId = userIdFor(context && context.OPENID);
      const input = event && typeof event === 'object' ? event : {};
      const data = await service.execute(input.action, userId, input.payload);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof AppError) return { ok: false, error: { code: error.code, message: error.message } };
      // 不记录事件、用户身份或错误正文，避免日志携带个人信息和数据库内容。
      logger.error('gameApi unexpected error', { code: error && (error.errCode || error.code) || 'UNKNOWN' });
      return { ok: false, error: { code: 'SERVER_ERROR', message: '服务暂时不可用，请稍后重试；如持续失败请查看云函数日志与数据库配置' } };
    }
  };
}

module.exports = { makeHandler };
