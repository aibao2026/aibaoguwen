# 开源发布隔离流程

本项目的日常开发目录可能包含本地 SQLite、备份、真实 Excel/PDF、飞书验收信息和本地自动化日志。开源发布不要直接从日常开发目录推送，也不要压缩整个项目文件夹分享。

推荐使用两套目录：

```text
/Users/mac/Documents/小程序/客户提醒/      # 私有开发区
/Users/mac/Documents/开源/AI保顾问/      # 公开发布区
```

私有开发区可以保留本地运行数据和内部资料。公开发布区只放可以进入 GitHub 的源码、测试、公开文档和配置文件。

## 发布原则

- 使用白名单导出，不使用“复制全部再排除”的方式。
- 公开发布区可以是独立 Git 仓库。
- 导出脚本不会复制 `data/`、`data/backups/`、`.omx/`、`node_modules/`、`示范文件/`、`docs/brand/`、真实 Excel/PDF、SQLite 数据库或本地构建产物。
- 默认只导出已经确认可公开的图片资产。`src/web/public/support/community-qr.png` 是公开宣传和社群入口二维码，可以保留；私人二维码、内部品牌素材、客户截图或聊天截图仍然不得发布。
- 每次发布前都在公开发布区重新安装、测试和构建。

## 导出命令

在私有开发区运行：

```bash
npm run export:open-source
```

默认目标目录：

```text
/Users/mac/Documents/开源/AI保顾问
```

如果目标目录已有文件，脚本会停止，避免混入旧文件。确认要刷新公开发布区时运行：

```bash
npm run export:open-source -- --clean
```

`--clean` 会删除目标目录中除 `.git` 外的旧文件，因此可以保留公开仓库的 Git 历史。

也可以指定其他目录：

```bash
npm run export:open-source -- --target /path/to/public/repo --clean
```

先查看会复制哪些文件：

```bash
npm run export:open-source -- --dry-run
```

## 公开发布区检查

进入公开发布区后运行：

```bash
npm install
npm run typecheck
npm test
npm run build
npm audit --omit=dev
git status --short
git ls-files
```

验证命令可能生成本地运行产物。提交前再清理一次：

```bash
rm -rf node_modules dist .omx
```

如果要确认敏感目录没有被纳入：

```bash
test ! -e data
test ! -e .omx
test ! -e 示范文件
find . -name "*.sqlite" -o -name "*.sqlite-*"
```

建议再做一次文本扫描，确认没有把账号、密码、token 或本机运行数据带入公开发布区：

```bash
rg -n "密码|password|token|cookie|session|Base token|customer-reminders.sqlite|data/backups|\\.env|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}" .
```

扫描命中普通说明文档时，需要人工确认它只是泛化安全说明，不包含真实账号、真实应用密码、完整客户资料或真实飞书标识。

`npm audit --omit=dev` 当前会报告 `xlsx` 已知高危风险且暂无官方修复版本。alpha 阶段只建议导入自己可信来源的本地 Excel，不要把本项目改造成公开上传服务。

## 禁止发布

以下内容不得进入公开发布区：

- `data/`
- `data/backups/`
- `.omx/`
- `node_modules/`
- `示范文件/`
- `.env`
- `.env.*`
- 真实客户 Excel
- 真实客户 PDF
- 真实飞书链接或 Base token
- 坚果云账号或应用密码
- session cookie
- 带客户信息的截图
- 私人二维码
- 内部品牌素材

说明：公开宣传二维码不属于“私人二维码”。当前支持页使用的 `src/web/public/support/community-qr.png` 可以进入开源发布区。

## 推荐发布顺序

1. 在私有开发区完成代码修改和本地验证。
2. 运行 `npm run export:open-source -- --clean` 导出公开发布区。
3. 在公开发布区运行安装、测试、构建和安全检查。
4. 人工检查 README、SECURITY、OPEN_SOURCE_ALPHA、data-security-and-cloud-backup 和示例数据说明。
5. 确认公开发布区没有敏感数据后，再从公开发布区提交和推送 GitHub。
