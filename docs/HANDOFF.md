# 跨会话交接：积分小账本 v0.2.0

更新日期：2026-10-27（Asia/Shanghai）。本文件供新会话接续项目，不依赖原聊天历史。

## 版本与入口

| 项目 | 当前信息 |
| --- | --- |
| GitHub 仓库 | https://github.com/Sharkenstein1/ai-security-ops-research |
| 工作分支 | `codex/wechat-points-miniprogram` |
| 软件版本 | `0.2.0`，微信云托管版 |
| 已验证的业务代码提交 | `2ced17c977c98766d109badbb6b7ff0c8aaf0d5b` |
| 部署说明 | [README](../README.md) |
| 架构说明 | [architecture.md](architecture.md) |
| 后端上传包 | [points-cloudrun-server.zip](../releases/points-cloudrun-server.zip) |
| 上传包 SHA-256 | `3b00e36971c42c49efd6109a0a9531eebe6fa83b8cdb1f9a5a63ef3a894e5566` |

本次交接仅新增文档入口，软件版本和后端包不变。后续如修改业务代码，应更新此处的版本、基准提交、验证结果及部署包。

## 用户目标与已确认规则

用户正在开发微信小程序，用于朋友牌局的积分登记与历史查看。所有界面使用“积分”称呼。

1. 玩家通过微信身份建立账号，自行填写昵称；不需要另设密码。
2. 房主创建牌局并生成四位随机邀请码，玩家输入后申请加入，房主批准后才能看到该局。
3. 玩家提交积分，房主确认后计入登记次数与累计投入；拒绝的申请不计入。
4. 可选登记结束积分，由房主确认；积分变化 = 结束积分 − 累计确认投入。结束积分可以为 0。
5. 房主可撤销已确认记录并保留原因与时间，结束积分确认后须先撤销结束记录才能更正投入。
6. 牌局结束后归档，参与者保留查看权限，不能继续修改。
7. 历史只向对应参与者开放：第一场 ABCD、第二场 ABCE，则 D 看不到第二场，E 看不到第一场。后端必须拒绝直接访问，不能只在页面隐藏入口。
8. 保险计算器留待后续，尚未实现。

当前单局上限：20 位参与者、500 条积分事件、100 条加入申请。邀请码 24 小时过期，可由房主更新。

## 已选定的技术路线

**使用微信云托管，不再按旧版云开发云函数的部署步骤操作。**

用户此前找不到“云开发”入口，随后提供了 `wx.cloud.callContainer` 调用 Express 计数器模板的代码，并明确选择“沿用现有云托管，由我适配后端”。后端适配已完成并推送，切勿重新引导用户部署云函数或创建旧文档里的五个云数据库集合。

| 配置 | 值或状态 |
| --- | --- |
| 云托管环境 ID | `prod-d8g8fsidhcdbfc1b3` |
| 服务名 | `express-r6wu` |
| 前端配置 | `miniprogram/config.js`，上面两项已填写 |
| 业务接口 | `POST /api/game` |
| 容器端口 | `80` |
| 健康检查 | `GET /healthz`，检查数据库可用性，就绪时返回 `{"status":"ok"}` |
| 前端 | 原生微信小程序，五个页面：home、join、room、history、profile |
| 后端 | Node.js 22+、Express `5.3.0`、mysql2 `3.24.6` |
| 数据库 | MySQL，默认复用模板库 `nodejs_demo`，物理表 `points_documents` |

服务启动自动创建表和索引，不清空已有记录，也不修改模板计数器表。原云开发数据库中的历史数据不会自动迁移到 MySQL。

身份流程为 `wx.login` → 后端向微信 `jscode2session` 校验 → 签发 12 小时应用会话。数据库只保存令牌摘要。后端使用 `X-Points-Session` 认证，不信任请求里的 OpenID、玩家 ID 或 X-WX-* 身份头。

MySQL 使用参数绑定、事务和行锁，遇到死锁等冲突有限重试。创建、积分登记采用请求键去重，同一次创建的并发重试只消耗一次创建额度。

## 实际部署状态：尚待用户验证

用户表示已注册小程序、安装开发者工具并完成项目导入；用户提供了上述云托管环境和服务信息。

**不能据此声称积分服务已上线。** 原会话没有权限查看用户电脑上的开发者工具或生产云托管控制台，没有取得生产 AppSecret 或 MySQL 凭据，也没有替用户发布服务。用户是否已完成最新后台配置、真实登录和多账号联调，尚未得到确认。

仓库的 `project.config.json` 仍是 `touristappid` 占位值；用户电脑上可能已填写真实 AppID，更新项目时应保留其本地设置。AppID 尚未在聊天中提供。

后台需要的变量如下；先查看现有变量名称并复用已有绑定，不要要求重复添加或把值发到聊天：

| 变量 | 要求 |
| --- | --- |
| `MYSQL_ADDRESS` | 现有 MySQL 内网主机名及端口 |
| `MYSQL_USERNAME` | 现有数据库用户名 |
| `MYSQL_PASSWORD` | 现有数据库密码，仅保留在服务后台 |
| `MYSQL_DATABASE` | 可选，默认 `nodejs_demo`；目标库须已存在 |
| `WX_APPID` | 与前端一致的真实小程序 AppID |
| `WX_APP_SECRET` | 该小程序密钥，只在服务后台安全填写 |
| `MYSQL_SSL_CA` | 数据库要求 TLS 时的可选受信任 CA，保留证书验证 |

## 已完成的验证

以下结果来自业务代码提交 `2ced17c` 的开发验证，本次文档交接没有重新执行这些测试：

- `npm test`：36 项通过，包含积分状态、权限、邀请码、HTTP 身份认证、页面渲染及前端传输。
- `npm run test:mysql`：6 项通过，使用隔离的 MySQL 8.4 容器，覆盖回滚、真实并发、ABCD/ABCE 隔离和生产服务进程重启后的记录及会话保留。
- `npm run check`：五个页面的 WXML/WXSS 本地编译、JS/JSON、路由及事件绑定通过。
- Docker 镜像构建通过；启动实际镜像后，健康检查、MySQL 连接、会话认证、创建牌局和历史 HTTP 请求通过。
- 后端 ZIP 的 12 个文件已逐一核对与源码一致，SHA-256 见上表。

微信凭证交换在测试中使用替身，因此真实 AppID/AppSecret、平台调用权限、实际生产库连接和多账号真机行为仍需部署后验证。

## 下一会话应从哪里继续

优先协助用户完成云托管部署与真实联调，按其实际页面逐步指导：

1. 打开云托管服务 `express-r6wu` 的服务设置／环境变量页面，核对变量名称和是否存在；密钥在平台安全填写。
2. 发布 `releases/points-cloudrun-server.zip`。包根目录直接含 Dockerfile，构建目录为 `.`，Dockerfile 路径为 `Dockerfile`，端口 `80`。
3. 验证服务版本启动、数据库建表和 `/healthz`，有错误时先查具体日志代码。
4. 开发者工具导入完整项目中包含 `project.config.json` 的目录，使用真实 AppID；环境 ID 和服务名已预填。
5. 测试登录、昵称、创建与加入、积分审批，再按 README 用多个真实微信账号测试历史隔离。

如果服务仍是模板，`/api/count` 只是计数器接口，不能说明 `/api/game` 已部署。前端遇到 404 会提示发布积分后端。

用户需要简单、逐步的中文界面指导；遇到找不到入口，应先看实际完整窗口截图，不要反复猜按钮位置。截图需要隐藏密码和密钥值。新会话也不能直接操作用户本机或假定看得到其当前窗口。

## 开发接续与文件交付

在已有隔离 checkout 中继续，先检查本地改动和远程分支，不要重置用户代码或强行推送。通常无需另建 worktree。分支修改后应同步部署包和校验和。

```bash
npm ci
npm test
npm run check
npm run test:mysql
python3 scripts/package-project.py
```

`test:mysql` 自动创建并清理仅绑定本机的测试数据库，不使用生产 MYSQL_* 连接。Docker 构建使用仓库根目录。Codex 环境曾因 buildx 目录只读而出错，可使用可写的 `BUILDX_CONFIG=/tmp/points-buildx`，同时保留默认 Docker 配置及其平台代理设置；不要通过重设 DOCKER_CONFIG 丢失这些设置。构建机要求组织 CA 时，Dockerfile 支持 `NPM_CA_CERT` 构建参数，只加入受信任 CA，始终保留 TLS 和包完整性验证。

当前聊天界面的 `/workspace/...` 文件链接不能供用户下载。请使用 GitHub 分支、提交归档或仓库中的后端 ZIP 链接交付。用户如果打不开私有仓库，需要使用已有仓库权限登录或在新会话连接该仓库；链接本身不会赋予访问权限。

可复现的业务代码归档：https://github.com/Sharkenstein1/ai-security-ops-research/archive/2ced17c977c98766d109badbb6b7ff0c8aaf0d5b.zip

后端部署包：https://github.com/Sharkenstein1/ai-security-ops-research/raw/2ced17c977c98766d109badbb6b7ff0c8aaf0d5b/releases/points-cloudrun-server.zip

当前主要待办是线上部署和验证；保险计算器、隐私与数据删除流程、用户填写内容安全处理和正式上线审核尚未完成。
