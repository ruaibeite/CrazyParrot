# 🦜 CrazyParrot

> 本地优先、受项目规则约束的桌面编码 Agent。

CrazyParrot 让 AI 在你选择的本地项目中协作完成开发工作：先读取项目的 `README.md` 与 `AGENTS.md`，再按需阅读文件、修改代码、运行命令和测试。所有文件系统操作、终端命令、模型配置和快照都由本机应用管理；有风险的命令必须由你逐条确认，任务随时可以停止或回退。

当前发布包面向 **macOS Apple Silicon（M 系列）**。

## 它适合什么场景

- 想在已有代码库中使用 AI，但希望 AI 严格遵循项目约定。
- 不希望把项目接入云端工作区、代码托管机器人或账号系统。
- 需要清楚看到 Agent 做了什么、运行了什么命令、测试是否通过。
- 项目没有 Git，仍希望能在每个编辑任务前保存可回退的状态。
- 使用 OpenAI Chat Completions、Anthropic Messages 或兼容接口的自备模型密钥。

## 核心能力

### 项目规则优先

- 导入或新建项目后，CrazyParrot 会读取项目根目录的 `README.md` 和 `AGENTS.md`。
- 规则不完整时先提示补齐；规则发生变化后要求重新确认。
- `AGENTS.md` 中的受保护路径会阻止 Agent 写入，例如 `.env`、证书、密钥和项目定义的敏感文件。

### 三种任务模式

| 模式 | 能力 | 适合场景 |
| --- | --- | --- |
| Ask | 仅阅读、搜索与回答 | 解释代码、定位入口、分析报错 |
| Plan | 仅阅读、搜索与输出方案 | 先审查改动范围、风险与测试计划 |
| Edit | 阅读、修改、运行经批准的命令 | 实施功能、修复问题、执行测试 |

### 可审计的执行流程

- 任务、工具调用、模型输出、终端输出和最终证据都保存在本地任务记录中。
- 只允许少量确定的本地查看/测试命令免审批，如 `git status`、`npm test`、`npm run build`。
- `node -e`、`python -c`、安装依赖、联网、管道、重定向和其他未知命令都会进入逐条审批。
- 命令非零退出会作为结果回传给 Agent，它可以继续诊断，而不会直接让整个任务卡死。
- 动态审批后从当时的工具调用断点继续，不会重跑已完成的写入步骤。
- 可以随时停止任务；正在进行的模型请求与终端命令都会收到取消信号。

### 快照与回退

- 每个 Edit 任务开始前自动创建本地快照，不依赖 Git。
- 可以从任务结果或快照页面回退到任务开始前的文件状态。
- 快照会排除 `.git`、`node_modules`、构建产物等目录，并跳过超过 25 MB 的单文件。
- 存储空间按去重后的真实 blob 占用计算；保留天数与空间上限可在“设置 → 快照策略”中调整。
- 回退过程会检查项目边界和软链接，拒绝写到项目目录外。

### 本地文件浏览与编辑体验

- 可浏览项目文件、预览文本和查看任务前后的 Monaco Diff。
- 大文件预览、文件搜索都有限额，不会一次性读入整个文件或无限递归扫描。
- Monaco 编辑器按需加载，首次打开文件或 Diff 时才下载编辑器资源。
- 终端输出实时显示；命令结束后再合并存入本地数据库，避免大量输出拖慢历史记录。

### 外观与设置

右上角 ⚙ 设置集中管理全局配置：

- 外观：深色/浅色主题、本地背景图、背景透明度、自定义 CSS。
- 模型：Provider、模型名称、API 地址、模型上下文上限、任务预算、超时和请求头。
- 快照策略：保留时间、存储上限和当前实际占用。

项目、快照历史和项目决策则保留在左侧工作区导航中。

## 快速开始

1. macOS（Apple Silicon）下载 `CrazyParrot-<version>-arm64.dmg`；Windows（x64）下载 `CrazyParrot-<version>-Windows-x64.exe`。
2. 把 `CrazyParrot.app` 拖入“应用程序”文件夹，然后启动应用。
3. 点击右上角 ⚙ → “模型”，添加并测试一个模型 Provider。
4. 在左侧新建项目或导入本地项目目录。
5. 确保项目根目录有完整的 `README.md` 与 `AGENTS.md`，并在应用中确认 Parrot。
6. 进入项目后选择 Ask、Plan 或 Edit，描述你要完成的工作。
7. 审阅需要确认的计划和命令；任务完成后查看文件变更、命令输出与测试证据。

以各 Release 的附件说明为准：只有明确标注为“Developer ID 签名并完成 Apple 公证”的安装包可直接通过 Gatekeeper。当前正式 macOS 包使用 Developer ID 签名并完成 Apple 公证；Windows 包为未签名构建，首次安装时请在系统提示中选择“更多信息 → 仍要运行”。

## 模型 Provider

CrazyParrot 不提供模型账号或共享密钥。你需要在设置中配置自己的 Provider：

- OpenAI Chat Completions 兼容接口（例如 OpenAI、DeepSeek 或自建兼容服务）。
- Anthropic Messages 兼容接口。

应用会要求远程 API 使用 HTTPS；仅 `localhost`、`127.0.0.1` 和 `::1` 可使用 HTTP。API 密钥保存在本机凭据存储中，不写入项目文件、SQLite 明文或应用日志。

### 隐私边界

- CrazyParrot 不建立账号、云同步、远程工作区或项目内容中转服务。
- 你选择项目目录、模型和 API 地址；主进程在本机执行文件与命令操作。
- **当 Agent 请求模型时，项目规则、任务提示、所读取文件的内容和命令结果会发送到你配置的模型 Provider。** 请只接入你信任的 Provider，并遵守其数据政策。
- Renderer 没有 Node.js 或 Shell 权限；所有来自界面和模型的路径、文件操作、命令与 Provider 输入都会在主进程再次校验。

## 安全机制

- `contextIsolation` 启用、Renderer 的 Node.js 集成关闭。
- 禁止窗口导航到外部页面，`window.open` 默认拒绝；Renderer CSP 限制脚本、连接和资源来源。
- 所有项目路径都需要通过项目边界和软链接检查。
- 搜索会跳过软链接、依赖/构建目录，并限制深度、文件数、单文件大小和耗时。
- Provider 删除前会检查排队、运行或等待审批的任务，避免任务永久显示为“执行中”。
- Provider 的“最大上下文”真正作用于请求：历史过长时保留系统规则和最近对话，并告知任务记录。

## 项目规则（Parrot）

CrazyParrot 使用 `README.md + AGENTS.md` 作为项目 Parrot。推荐在 `AGENTS.md` 写明：

- 开发、构建、测试与 E2E 命令。
- 不可触碰的文件或目录。
- 数据库、部署、密钥、生产环境等限制。
- UI、业务语义和验收标准。
- 需要补充单元测试或 E2E 的改动范围。

受保护路径仅支持三种写法：精确文件名（如 `.env`）、目录前缀（如 `configs/`）和扩展名后缀（如 `*.pem`）。

## 架构概览

```text
Renderer（React）
  └─ 仅通过类型化 preload IPC 发起请求
        └─ Main（Electron）
             ├─ 项目边界、命令审批与 Parrot 校验
             ├─ Provider API / 任务队列 / 取消与断点恢复
             ├─ SQLite 任务、事件、决策和设置
             └─ 本地快照、背景图和系统凭据
```

## 本地开发

### 环境要求

- Node.js 22 或更高版本。
- npm。
- macOS 打包需要 Apple 开发者签名与公证凭据；Windows 打包在对应环境准备 Windows 构建工具。

### 常用命令

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
env -u ELECTRON_RUN_AS_NODE npm run test:e2e
```

### 打包

```bash
# macOS Apple Silicon：构建、签名、公证、生成 DMG
npm run package:mac

# Windows x64：生成 NSIS 安装包
npm run package:win
```

`package:mac` 依赖本机钥匙串内的 `crazyparrot-notary` 公证 profile 和名称为 `ruaibeite kenny (3XBX425673)` 的签名证书；没有这些凭据时，命令会失败而不会产出伪装为已公证的包。

## 测试策略

- 单元测试覆盖命令风险分级、项目路径/软链接边界、快照回退、Provider 取消、上下文预算、Parrot 校验和事件合并。
- Playwright Electron E2E 覆盖启动、中文/英文界面、设置中的外观持久化、Monaco 延迟加载与项目 Parrot 体检。
- 修改任务、风险、快照、审计或 Provider 逻辑时，应同步增加对应单元测试；完整交互改动应更新 Electron E2E。

## 当前限制

- 当前发布包提供 macOS Apple Silicon 和 Windows x64 构建；具体签名和公证状态以该 Release 的附件说明为准。
- 不提供账号系统、团队协作、云同步、远程执行或自动更新。
- 不能替代人工代码审查；特别是生产部署、数据库迁移、删除操作和密钥处理仍应仔细确认。
- Agent 的有效性取决于项目规则质量、所选模型和 Provider 的可靠性。

## 反馈

欢迎通过本仓库的 Issues 提交问题、建议或安装反馈。请不要在 Issue、日志、截图或示例中粘贴 API 密钥、证书、私有代码或敏感项目路径。
