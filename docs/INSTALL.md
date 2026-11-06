# 安装与启动说明

## 前置条件

- DeepSeek Harness Desktop（本插件基于 DSH 0.2.1-rc.5 的插件机制开发）。
- Node ≥ 24（DSH 运行时自带；本插件持久化依赖 `node:sqlite`）。

## 方式一：安装脚本（推荐）

```bash
cd 工作任务管理插件
bash scripts/install.sh
```

脚本会：

1. 备份 `~/.dsh/profiles/desktop/package.json` 到 `package.json.qj-backup`。
2. 将两个包以 `link:` 绝对路径加入 `dependencies`：
   - `@deepseek-ai/dsh-quest-journal`（服务 + Agent 工具）
   - `@deepseek-ai/dsh-client-ui-quest-journal`（Web 面板：Host 路由 + 浏览器半片）
3. 将两个包都加入 `dsh.profile.bundles`（面板有自己的 `cordis.patch.yml`）。

然后完成剩余两步（见脚本输出）：

```bash
# 2. 安装链接包（三选一）
bash scripts/install.sh --install          # 脚本内执行 pnpm install
# 或
cd ~/.dsh/profiles/desktop && pnpm install
# 或使用 DSH Web 的 Plugins 页面安装本地包
```

3. 重新加载 profile：Host 侧代码只在启动时加载，**必须重启 DSH**。

## 方式二：手动安装

1. 编辑 `~/.dsh/profiles/desktop/package.json`：

```jsonc
{
  "dependencies": {
    "@deepseek-ai/dsh-quest-journal": "link:/绝对路径/packages/dsh-quest-journal",
    "@deepseek-ai/dsh-client-ui-quest-journal": "link:/绝对路径/packages/dsh-client-ui-quest-journal"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-quest-journal",
        "@deepseek-ai/dsh-client-ui-quest-journal"
      ]
    }
  }
}
```

2. 在 profile 目录执行 `pnpm install`。
3. 重启 DSH。

## 方式三：仅体验界面（无需安装）

浏览器打开 `preview/index.html` 即可体验完整交互（数据存于 localStorage）。

若要看数据库里的真实任务，先执行 `node scripts/export-journal.mjs` 生成 `preview/quest-journal-export.json`，再点预览左下角「⇩ 载入导出数据」选择该文件；用 `http://` 方式打开预览（如 `python3 -m http.server`）时会自动载入同目录的导出文件。载入只替换浏览器本地快照，不写回 SQLite。

## v0.3 指令框

更新已链接的本地源码后完全退出并重开 DSH 即可。任务详情中的“用 DSH 整理任务”复用 DSH 默认模型，不需要额外 API Key。先生成变更预览，再确认应用。场景和验证边界见 [v0.3 使用与验收](V0.3.md)。

## 验证安装

1. **重启 DSH**。Host 侧插件代码（`quest_*` 工具、`/quest-journal/*` 路由、共享 journal 实例）只在进程启动时加载，升级 `lib/*` 后必须重启才会生效。
2. 新开一个会话，让 Agent 执行「列出我的任务」——应调用 `quest_list` 并返回任务列表（工具目录里应能看到 11 个 `quest_*`）。
3. 侧栏出现「任务日志」入口；点开应看到双栏面板：左侧任务列表（进行中/已归档），右侧目标、进展、备注与 Trace。勾选完成、标记阻塞、新建任务都直接写 SQLite，Trace 里来源为 `manual`。
4. 重启后数据仍在（`~/.dsh/storages/quest-journal.db`）。

> 面板通过 `/quest-journal/*` 路由读写，而不是 Typert `remote.*` RPC：后者在本 DSH 版本里只认构建期静态打包的命名空间，第三方插件注册不了。`preview/index.html` 仍保留为离线演示。

## 排查：面板不出现 / 接口 404

先跑诊断脚本，它会把当前 profile 复制到临时目录并用 DSH 自带 CLI dump 组合树：

```bash
bash scripts/diagnose.sh
```

- 出现 `skipping profile bundle ...`：多半是 `engines.dsh` 与当前 DSH 版本不兼容，DSH 会整包跳过（服务、工具、路由一起消失）。本仓库已写成 `>=0.2.1-rc.5 <0.3.0`。
- 没有 `quest-journal` / `quest-journal-web` / `quest-journal-ui` 三行：bundle 没进 `dsh.profile.bundles`，或包没装上（`bash scripts/install.sh --install`）。
- 行都在但面板 404：看 `<DSH_HOME>/storages/quest-journal-web.error.log`（只在路由条目激活失败时生成）。

## 数据位置

默认数据库文件：`~/.dsh/storages/quest-journal.db`。

可通过 bundle 行配置覆盖（在 `cordis.patch.yml` 中为 `quest-journal` 行添加 `config.dbPath`）：

```yaml
- id: quest-journal
  name: '@deepseek-ai/dsh-quest-journal'
  config:
    dbPath: '/自定义路径/quest-journal.db'
```

## 卸载

1. 从 `dsh.profile.bundles` 移除 `@deepseek-ai/dsh-quest-journal`。
2. 从 `dependencies` 移除两个 `link:` 依赖。
3. `pnpm install` 并重启 DSH。

插件可独立加载与卸载，不破坏原有 DSH 会话及内置工具（AC10）。数据库文件不会被卸载操作删除。
