# GitHub 维护与其他电脑安装

仓库：<https://github.com/KateLiao/dsh-quest-journal>

## 在另一台电脑安装

先安装并至少启动一次兼容版本的 DeepSeek Harness Desktop（当前已验证 0.2.1-rc.5），然后在终端执行：

```bash
git clone https://github.com/KateLiao/dsh-quest-journal.git
cd dsh-quest-journal
bash scripts/install.sh --install
```

完全退出并重开 DSH，侧栏应出现“任务日志”。无需构建、无需先安装项目开发依赖；安装脚本会寻找 DSH 自带的 Node/pnpm，并将两个包链接到当前克隆目录。目录应长期保留，不要在安装后删除或随意移动。

使用非默认 profile 时：

```bash
bash scripts/install.sh --profile /你的/profile/目录 --install
```

自然语言功能使用该电脑 DSH 的默认模型配置；账户与模型配置不会随 GitHub 仓库转移。

## 更新与回退

在克隆目录更新：

```bash
git pull --ff-only
bash scripts/run-tests.sh
```

退出并重开 DSH。通常无需重新执行安装脚本，因为 profile 直接链接当前目录；包名或安装路径变化时才重新安装链接。代码更新不会清空任务数据库。

如需固定当前 0.4.0 源码基线，可克隆后执行 `git checkout b88d4bf` 再安装。后续发布版本标签后，也可使用对应标签。已使用更高版本后回退前，请备份数据库并阅读版本迁移说明；切回 main 后才能继续拉取后续更新。

## 代码与任务数据

GitHub 管理源码和版本，不自动同步个人任务。真实数据库、导出快照、账号配置、机器依赖与原始加密需求文档不在仓库中；测试使用独立示例数据。

在另一台电脑安装后，默认会创建本机的新任务库。若要迁移原任务，请先完全退出两台电脑的 DSH，备份目标库，再通过私密方式复制实际使用的 `quest-journal.db`。默认位置是 `~/.dsh/storages/quest-journal.db`；自定义 dbPath 以配置为准。不要把个人任务库提交到公开仓库。

## 维护流程

1. 在独立分支修改源码与测试，提交 PR。
2. 本地运行 `bash scripts/run-tests.sh`；GitHub Actions 也会在 push/PR 时使用 Node 24 运行离线测试。
3. 本机有 DSH 和 Chrome 时，可选运行 `python3 scripts/test-browser-drag.py` 验证原生交互。此测试使用临时数据，不操作真实任务。
4. 发布时同步根目录和两个包的 version、UI 包引用的后端版本，并更新 CHANGELOG.md。
5. 合并通过的代码后创建版本标签并推送，例如 `git tag v0.4.1`、`git push origin v0.4.1`。可据此在 GitHub Releases 写更新说明。

当前包使用源码链接安装，没有发布到 npm；package.json 的包名仅用于 DSH 加载。
