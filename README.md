# 积分小账本 · 微信云托管版

原生微信小程序 + Express + MySQL。当前版本已适配你开通的云托管服务，前端通过 `wx.cloud.callContainer` 调用后端。

在其他会话接续本项目，请先阅读[跨会话交接文档](docs/HANDOFF.md)，其中包含版本基准、已验证内容和待部署事项。

| 配置 | 已填写的值 |
| --- | --- |
| 云托管环境 | `prod-d8g8fsidhcdbfc1b3` |
| 服务名称 | `express-r6wu` |
| 应用接口 | `POST /api/game` |
| 容器端口 | `80` |
| 健康检查 | `GET /healthz`，就绪时返回 `{"status":"ok"}` |

环境 ID 和服务名是非密钥配置。真实 AppID 仍须在微信开发者工具中填写；AppSecret 仅在云托管服务的环境变量里设置。

## 现在怎么操作

### 1. 下载新版并导入小程序

从 [GitHub 的开发分支](https://github.com/Sharkenstein1/ai-security-ops-research/tree/codex/wechat-points-miniprogram)选择 **Code → Download ZIP**，解压后在微信开发者工具导入包含 `project.config.json` 的目录。

使用你自己的真实 AppID。仓库中的 `touristappid` 是占位值，不能进行真实微信登录。若更新已有本地项目，请保留自己填写的 AppID 和 `project.private.config.json`。

`miniprogram/config.js` 已填好你提供的环境信息：

```js
module.exports = {
  envId: 'prod-d8g8fsidhcdbfc1b3',
  service: 'express-r6wu',
  apiPath: '/api/game'
};
```

### 2. 在云托管服务设置中补齐环境变量

进入云托管控制台，选择服务 **express-r6wu**，打开服务设置中的环境变量配置。

**先查看已经存在的变量名称，复用模板提供的数据库配置，不要重复添加同名项。** 官方 Express 模板使用以下 `MYSQL_*` 变量：

| 变量名称 | 填写方式 |
| --- | --- |
| `MYSQL_ADDRESS` | 复用现有 MySQL 内网地址，通常为 `主机名:3306` |
| `MYSQL_USERNAME` | 复用现有数据库用户名 |
| `MYSQL_PASSWORD` | 复用现有数据库密码，值只保留在服务后台 |
| `MYSQL_DATABASE` | 可省略，默认使用模板已创建的 `nodejs_demo` 数据库 |
| `WX_APPID` | 与前端项目一致的真实小程序 AppID |
| `WX_APP_SECRET` | 该小程序的 AppSecret，值只在服务后台填写，不放进代码或聊天 |

小程序 AppSecret 可由管理员在微信公众平台的小程序开发设置／开发者信息中获取。数据库账号需有对现有数据库创建表和读写的权限；如果使用的不是模板数据库，请先创建目标数据库并设置 `MYSQL_DATABASE`。

配置变化后，按控制台提示发布或更新服务，使新变量生效。确认小程序已获得此云托管环境与服务的调用权限。

如果数据库连接要求 TLS，可设置 `MYSQL_SSL_CA` 为受信任 CA 证书内容；代码始终保留证书验证。默认配置沿用官方模板的 MySQL 内网连接方式。

### 3. 上传积分后端到当前服务

仓库中的 [releases/points-cloudrun-server.zip](releases/points-cloudrun-server.zip) 是**后端部署包**。从 GitHub 文件页面下载原始文件；若已经下载了整个仓库，也可以直接在解压目录的 `releases` 中找到它。

在服务 **express-r6wu** 的版本发布／代码部署页面，使用本地代码上传方式上传该部署包。不同版本控制台的按钮名称可能稍有区别，配置应为：

| 项目 | 值 |
| --- | --- |
| 构建目录 | 部署包根目录 `.` |
| Dockerfile | 根目录 `Dockerfile` |
| 容器监听端口 | `80` |
| 健康检查路径（如页面要求） | `/healthz` |
| 启动命令 | 使用 Dockerfile 默认命令 |

后端包打开后直接就是 `Dockerfile`、`package.json`、`package-lock.json` 和 `server/`，不需要再进入一层目录。若使用 Git 仓库构建，选择本仓库的 **codex/wechat-points-miniprogram** 分支，以仓库根目录构建。

后端首次启动会在现有数据库里自动创建 `points_documents` 表及索引，重复启动不会清空记录，也不会修改模板的计数器表。无需创建上一版云开发文档里的五个集合，也无需上传云函数。

**只替换前端配置无法把 `/api/count` 计数器模板变成积分服务，必须完成这次后端发布。**

### 4. 编译并测试

服务部署成功后，在开发者工具点击“编译” → “微信登录并设置昵称” → 保存昵称 → 返回首页创建牌局。

小程序调用 `wx.login` 获取一次性凭证，后端向微信官方接口校验，签发有效期为 12 小时的应用会话。后续请求附带会话令牌，过期后自动重新登录。后端不信任客户端传入的玩家 ID 或 `X-WX-OPENID` 请求头。

当前仓库的自动化验证没有连接你的生产云托管服务，也未使用你的真实 AppSecret；需要你部署后完成真实微信联调。

## 已实现的功能

- 微信身份建档和自填昵称，修改昵称不会换账号。
- 创建牌局、四位随机邀请码、房主批准加入。邀请码保留前导零，有效期 24 小时，房主可更新。
- 玩家提交积分，房主确认或拒绝；只有已确认记录计入次数与累计投入。
- 可选结束积分，由玩家提交并由房主确认。积分变化 = 结束积分 − 累计确认投入；结束积分可为 0。
- 房主可撤销已确认记录，保留原记录、处理时间和撤销原因。结束积分已确认时，须先撤销结束记录再更正投入。
- 结束并归档牌局，参与者仍可读取历史，所有新修改停止。
- “我的牌局”按本人参与关系查询，分页加载；非参与者即使知道牌局编号也无法读取。
- 并发重复记账、确认和创建请求不会重复计入。首次创建的额度与牌局在同一事务内提交。

## 第一次多账号验收

1. A 创建第一场，B 用四位码申请加入。房主批准前，B 看不到名单或积分。
2. A 批准 B 加入；B 提交 1,000 积分。确认前累计投入为 0，A 确认后变为 1 次、1,000 分。
3. B 再提交 500，确认后为 2 次、1,500 分。重复点击不能重复入账。
4. B 提交结束积分 1,200，A 确认后显示 −300。结束积分为 0 时也应正确显示。
5. 第一场加入 A、B、C、D，第二场加入 A、B、C、E。D 的历史只有第一场，E 的历史只有第二场。
6. A 处理所有待确认积分后结束第一场，邀请码失效；参与者仍可从历史打开归档。

多账号测试需要按微信后台要求添加开发者或体验成员。房主自己的积分记录也要确认。

## 项目结构

```text
project.config.json             微信开发者工具入口，填写真实 AppID
miniprogram/config.js            已填写环境 ID、服务名和接口路径
miniprogram/pages/               首页、加入、详情、历史、昵称
miniprogram/utils/api.js          callContainer、微信凭证和会话续期
server/index.js                  云托管进程入口
server/app.js                    Express HTTP 接口与健康检查
server/auth.js                   微信官方凭证校验及应用会话
server/domain.js                 积分规则、房主权限、牌局历史
server/mysql-store.js            持久化、事务、死锁重试
server/schema.sql                自动初始化的表和索引
Dockerfile                      云托管构建入口，Node.js 22
releases/points-cloudrun-server.zip  可直接上传的后端包
tests/                          业务、HTTP、身份、页面与数据库测试
```

## 本地验证

使用 Node.js 22+：

```bash
npm ci
npm test
npm run check

# 需要 Docker；脚本自动创建并清理隔离 MySQL，不连接生产库
npm run test:mysql

# 构建云托管镜像
docker build -t points-table-cloudrun .

# 导出小程序项目包，并更新 releases 中的后端部署包
python3 scripts/package-project.py
```

普通测试包含内存事务、真实本地 HTTP 请求、会话校验和微信公开 WXML 编译器渲染。数据库测试使用 MySQL 8.4 验证回滚、并发重试、跨局权限与真实服务进程重启后的会话和记录保留。微信凭证交换在测试中使用替身，真实微信登录仍需部署后验证。

## 常见问题

| 表现 | 检查 |
| --- | --- |
| 提示积分后端尚未部署／404 | 当前服务仍是计数器模板，发布 `releases` 中的后端包 |
| 服务无法启动，日志提示缺少变量 | 在服务设置补齐对应变量，保留已有数据库绑定，再发布 |
| 数据库不存在 | 模板默认 `nodejs_demo`；确认该库存在，或配置已有的目标库 |
| `ER_ACCESS_DENIED_ERROR`／`ER_TABLEACCESS_DENIED_ERROR` | 核对数据库账号、密码和建表／读写权限 |
| 微信登录配置异常 | 核对 `WX_APPID` 与 `WX_APP_SECRET`，以及微信接口 IP 白名单要求 |
| callContainer 提示没有权限 | 核对 AppID、环境、服务名及服务对该小程序的调用权限 |
| 刚更新 AppSecret 仍失败 | 服务环境变量变更要发布生效；使用该小程序对应的最新密钥 |
| 还在等待房主 | 申请页约 5 秒、牌局约 8 秒刷新，也可手动刷新 |
| 积分变化显示未登记 | 结束积分是可选项，未登记时不会误当成零 |

## 当前边界

每局最多 20 位玩家、500 条积分事件和 100 条加入申请。归档不可撤销，保险计算器未实现。没有支付、兑换或资金结算逻辑。

本次从云函数改为云托管，原云开发数据库中的数据不会自动迁移到 MySQL；若此前已有真实记录，应另行迁移后再切换。

上线前仍需真实微信联调，并按实际用途完善隐私说明、保存与删除流程、用户填写内容的安全处理、主体类目与平台审核。

实现参考了[微信官方云托管 Express 模板](https://github.com/WeixinCloud/wxcloudrun-express)，其数据库变量和默认库名称用于兼容已有服务。
