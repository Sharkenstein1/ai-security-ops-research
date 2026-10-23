'use strict';

function readConfig(environment = process.env) {
  for (const name of ['MYSQL_ADDRESS', 'MYSQL_USERNAME', 'MYSQL_PASSWORD', 'WX_APPID', 'WX_APP_SECRET']) {
    if (typeof environment[name] !== 'string' || !environment[name].trim()) throw new Error(`缺少服务环境变量：${name}`);
  }
  const match = /^([A-Za-z0-9_.-]+)(?::(\d{1,5}))?$/.exec(environment.MYSQL_ADDRESS);
  if (!match) throw new Error('MYSQL_ADDRESS 须为数据库内网主机名或主机名:端口');
  const mysqlPort = Number(match[2] || 3306);
  const port = Number(environment.PORT || 80);
  if (mysqlPort < 1 || mysqlPort > 65535 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('端口配置无效');
  }
  if (!/^wx[a-fA-F0-9]{16}$/.test(environment.WX_APPID)) throw new Error('WX_APPID 须为小程序的真实 AppID');
  const database = environment.MYSQL_DATABASE || 'nodejs_demo';
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) throw new Error('MYSQL_DATABASE 名称无效');
  return {
    port, appId: environment.WX_APPID, appSecret: environment.WX_APP_SECRET,
    mysql: {
      host: match[1], port: mysqlPort, user: environment.MYSQL_USERNAME,
      password: environment.MYSQL_PASSWORD, database,
      charset: 'utf8mb4', waitForConnections: true, connectionLimit: 10,
      enableKeepAlive: true, supportBigNumbers: true,
      ...(environment.MYSQL_SSL_CA ? { ssl: { ca: environment.MYSQL_SSL_CA, rejectUnauthorized: true } } : {})
    }
  };
}

module.exports = { readConfig };
