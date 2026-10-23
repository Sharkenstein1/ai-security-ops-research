'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const compiler = require('miniprogram-compiler');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'miniprogram');
const app = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'app.json'), 'utf8'));

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

const all = files(root);
for (const file of all) {
  if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

for (const page of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok(fs.existsSync(path.join(sourceRoot, `${page}.${extension}`)), `Missing ${page}.${extension}`);
  }
  const script = path.join(sourceRoot, `${page}.js`);
  let definition;
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
    Page: value => { definition = value; }, require: createRequire(script),
    getApp: () => ({ globalData: {} }), setInterval, clearInterval
  }, { filename: script });
  const template = fs.readFileSync(path.join(sourceRoot, `${page}.wxml`), 'utf8');
  for (const [, handler] of template.matchAll(/\bbind\w+="([A-Za-z]\w*)"/g)) {
    assert.equal(typeof definition[handler], 'function', `${page}: missing handler ${handler}`);
  }
  for (const [, condition] of template.matchAll(/wx:(?:if|elif)="([^"]+)"/g)) {
    assert.ok(condition.startsWith('{{') && condition.endsWith('}}'), `${page}: condition must be a binding`);
  }
  const nativeTags = new Set(['view', 'text', 'input', 'button', 'block']);
  for (const [, tag] of template.matchAll(/<([A-Za-z][\w-]*)\b/g)) {
    assert.ok(nativeTags.has(tag), `${page}: unsupported native tag ${tag}`);
  }
}
for (const tab of app.tabBar.list) assert.ok(app.pages.includes(tab.pagePath), 'Tab page is not registered');

// 使用微信公开的 WCC/WCSC 编译器。只验证本地编译，不模拟微信登录或云部署。
const wxml = compiler.wxmlToJs(sourceRoot, { maxBuffer: 4 * 1024 * 1024 });
const render = new Function('global', 'window', wxml)({}, {});
for (const page of app.pages) assert.equal(typeof render(`${page}.wxml`), 'function');
const wxss = compiler.wxssToJs(sourceRoot, { maxBuffer: 4 * 1024 * 1024 });
const compiledStyles = new Map();
const styles = new Function('global', 'window', 'navigator', wxss)({}, {
  screen: { width: 390, height: 844 }, devicePixelRatio: 3,
  __styleSheetManager2__: {
    addItem() {},
    setCss(key, css) { compiledStyles.set(key, css); }
  }
}, { userAgent: 'iPhone' });
for (const page of app.pages) {
  assert.equal(typeof styles(`${page}.wxss`), 'function');
  styles(`${page}.wxss`)('');
}
assert.equal(typeof styles('app.wxss'), 'function');
assert.ok(compiledStyles.size >= app.pages.length, 'Stylesheets were not generated');
console.log(`已通过：JS 语法、JSON、${app.pages.length} 个页面的路由和事件绑定、WXML/WXSS 本地编译。`);
