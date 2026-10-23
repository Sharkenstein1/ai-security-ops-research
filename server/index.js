'use strict';

const mysql = require('mysql2/promise');
const { readConfig } = require('./config');
const { MysqlStore } = require('./mysql-store');
const { GameService } = require('./domain');
const { Sessions, createWeChatExchange } = require('./auth');
const { createApp } = require('./app');

async function start() {
  const config = readConfig();
  const pool = mysql.createPool(config.mysql);
  let server;
  let cleanup;
  try {
    const store = new MysqlStore(pool);
    await store.initialize();
    const service = new GameService(store);
    const sessions = new Sessions(store, service, createWeChatExchange(config));
    const app = createApp({ service, sessions, store });
    server = app.listen(config.port, '0.0.0.0', () => console.log('积分服务已启动', { port: config.port }));
    server.on('error', () => { console.error('服务端口监听失败'); process.exit(1); });
    cleanup = setInterval(() => store.pruneExpiredSessions(Date.now()).catch(() => console.error('过期会话清理失败')), 30 * 60 * 1000);
    cleanup.unref();
    const stop = () => {
      clearInterval(cleanup);
      const timer = setTimeout(() => process.exit(1), 10000);
      timer.unref();
      server.close(async () => { await pool.end(); clearTimeout(timer); process.exit(0); });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (error) {
    clearInterval(cleanup);
    await pool.end();
    throw error;
  }
}

if (require.main === module) {
  start().catch(error => {
    // 配置错误只包含变量名称；数据库错误不输出连接配置或 SQL 数据。
    const configuration = error.message && (error.message.startsWith('缺少服务环境变量') || /^(WX_APPID|MYSQL_|端口配置)/.test(error.message));
    console.error('启动失败', configuration ? error.message : { code: error.code || 'UNKNOWN' });
    process.exitCode = 1;
  });
}

module.exports = { start };
