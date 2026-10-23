'use strict';

// 创建独立、仅绑定本机的测试数据库；不读取生产 MYSQL_* 连接配置。
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');

async function main() {
  const name = `points-mysql-test-${crypto.randomBytes(6).toString('hex')}`;
  const password = crypto.randomBytes(32).toString('hex');
  let started = false;
  try {
    console.log('启动隔离 MySQL 8.4 测试数据库…');
    const run = spawnSync('docker', [
      'run', '--detach', '--rm', '--name', name, '-e', 'MYSQL_ROOT_PASSWORD',
      '-e', 'MYSQL_DATABASE=points_test', '-p', '127.0.0.1::3306', 'mysql:8.4'
    ], { env: { ...process.env, MYSQL_ROOT_PASSWORD: password }, encoding: 'utf8' });
    if (run.status !== 0) throw new Error('无法启动 Docker 测试数据库，请检查 Docker 是否运行及镜像是否可下载');
    started = true;
    const mapping = spawnSync('docker', ['port', name, '3306'], { encoding: 'utf8' });
    const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(mapping.stdout);
    if (!match) throw new Error('无法读取本机测试数据库端口');
    const port = Number(match[1]);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password, database: 'points_test', connectTimeout: 1000 });
        await connection.end();
        ready = true;
        break;
      } catch (error) { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    if (!ready) throw new Error('隔离测试数据库未能就绪');
    const tests = spawnSync(process.execPath, ['--test', 'tests/mysql.integration.js'], {
      stdio: 'inherit',
      env: { ...process.env, POINTS_MYSQL_TEST_PORT: String(port), POINTS_MYSQL_TEST_PASSWORD: password }
    });
    process.exitCode = tests.status === 0 ? 0 : 1;
  } finally {
    if (started) spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
