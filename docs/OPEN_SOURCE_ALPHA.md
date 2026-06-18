# 最小 alpha 开源说明

本项目当前按最小 alpha 开源：核心目标是让保险销售顾问能在本机启动、导入 Excel、查看工作日历，并在授权后把脱敏数据同步到飞书。

## 这个 alpha 包含什么

- 本地工作日历：生日、续期、手动待办。
- Excel 导入：客户信息表、保单续期/业绩明细表。
- 待确认：缺生日、缺生效日、缴费期间无法解析、关键字段变化。
- 本地 SQLite 存储、备份和恢复。
- 飞书多维表格同步计划和执行。
- 关键提醒同步到飞书日历。
- 本地安装和同步说明。

## 这个 alpha 不包含什么

- 真实客户数据、真实保单数据、真实数据库。
- SQLite 文件加密。
- 多人账号和权限体系。
- 面向普通用户的飞书 OAuth 后台。
- 通用 Excel 字段映射。
- 面向普通用户的一键飞书 OAuth 授权。
- Playwright E2E 和 ESLint 配置。

## 发布前不要包含

以下文件和目录只属于本机运行环境，不应进入开源仓库或分享压缩包：

```text
data/
.omx/
src/web/dist/
示范文件/
.env
.env.*
docs/brand/
src/web/public/icons/
```

其中 `data/customer-reminders.sqlite` 和 `data/backups/` 可能包含客户姓名、手机号、证件号、保单信息和提醒状态。

公开发布前请确认所有图片资源都是可公开资产，不包含私人二维码、内部品牌素材或客户截图。

## 最小发布检查

```bash
npm install
npm run typecheck
npm test
npm run build
```

涉及 UI 的改动还要启动并打开：

```bash
npm run start
```

浏览器地址：

```text
http://127.0.0.1:4173/
```

## 给分享对象的环境要求

- Node.js 20 或更新版本。
- npm。
- 可以本地访问 `127.0.0.1`。
- 如需飞书同步：本机安装并授权 `lark-cli`。
- 如使用本地自动化工具辅助同步：先读 `docs/AI_AGENT_SETUP.md` 和 `docs/agent-feishu-sync.md`。

## 数据安全边界

- 本地数据库默认明文保存，访问密码只保护网页入口，不加密 SQLite 文件。
- 网页详情默认脱敏展示手机号和证件号。
- 飞书同步默认使用脱敏手机号和证件号。
- 客户外部 ID 使用 `customer:<16位sha256摘要>`，不包含姓名或证件号。
- 分享问题、日志或截图时不要展示完整手机号、证件号、Base 标识、session cookie。
