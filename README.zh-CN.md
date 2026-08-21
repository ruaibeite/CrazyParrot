# 🦜 CrazyParrot

> [简体中文](README.zh-CN.md) · [English](README.md)

> 可证明、可回退的本地 AI 代码变更。

CrazyParrot 是本地 AI 变更控制台，而不是另一款 AI IDE。它帮助你在本地项目中与 AI Agent 协作，同时始终能回答四个问题：改了什么、为什么允许改、如何验证、如何撤销。

应用会读取项目中的 `README.md` 和 `AGENTS.md`，并在合适时检查文件、修改代码、运行命令、报告测试证据。文件系统访问、终端命令、模型配置、任务历史、变更凭证和快照均由本地应用管理。

高风险命令必须由你明确批准。每个任务都可以停止；Edit 任务可恢复到任务前状态。CrazyParrot 专注于需要审查、解释并回退 AI 变更的可信本地执行场景。

从 [GitHub Releases](https://github.com/ruaibeite/CrazyParrot/releases) 下载最新安装包。

## 适用对象

- 希望 AI 助手遵守仓库特定约定的开发者。
- 不希望将项目接入托管工作区、编码机器人或账户系统的团队和个人。
- 需要清晰记录变更文件、执行命令和测试结果的用户。
- 在私有、遗留、受监管或生产敏感代码库中工作，并需要审查与回退能力的开发者。
- 没有 Git，但仍需要按任务安全回退的项目。
- 使用自己的 OpenAI Chat Completions、Anthropic Messages 或兼容模型服务商凭据的用户。

## 核心能力

### 项目规则优先

- 新建或导入项目时，CrazyParrot 会读取根目录的 `README.md` 与 `AGENTS.md`。
- 规则不完整或发生变化时，应用会要求你补齐或重新确认。
- `AGENTS.md` 中的受保护路径会阻止 Agent 写入 `.env`、证书、密钥及其他项目定义的敏感文件。

### 三种任务模式

| 模式 | 权限 | 适用场景 |
| --- | --- | --- |
| Ask | 仅可读取、搜索和解释 | 理解代码、定位入口、分析错误 |
| Plan | 仅可读取、搜索并给出实施方案 | 编辑前审查范围、风险、API 与测试覆盖 |
| Edit | 可读取、编辑和运行已批准的命令 | 实现功能、修复问题、运行测试 |

### 可审计的执行过程

- 任务、工具调用、模型输出、终端输出和最终证据都会保存在本地。
- `git status`、`npm test`、`npm run build` 等少量可预测的本地验证命令可无需审批执行。
- 未知命令、内联脚本、安装依赖、联网、管道、重定向及其他较高风险操作都需要逐条审批。
- 命令非零退出时，结果会返回给 Agent 用于诊断，而不是静默终止任务。
- Git 仅增强 Diff 展示，并非前提：即使项目不是 Git 仓库，CrazyParrot 也会通过文件系统继续完成原任务。
- 交互式终端无法启动时，应用会使用标准 shell 重试并记录结果。
- 动态审批会从待执行工具调用继续，不会重复已经完成的文件写入。
- 可随时停止任务；进行中的模型请求和终端命令都会收到取消信号。
- 每次请求模型前都会保存安全任务检查点；应用重启中断的任务可由你明确恢复。
- Edit 任务在写入配置或锁文件、写入大文件、或扩大文件变更范围前会暂停确认，并显示准确影响路径。
- 每个任务均可设置 Token 和可选美元成本上限；触及上限时任务暂停。模型价格仅在本地用于估算。

### 可验证的变更凭证

每个新任务在完成、失败、取消或回退后都会生成永久的本地**变更凭证（Change Receipt）**。完成卡片和 **Receipts** 页面是主要审查入口。

- 凭证记录用户目标、所选服务商/模型、Parrot 哈希、审批时间线、命令、变更文件哈希、测试结果、风险、Token/成本、快照引用、时间戳、终端状态与完整性哈希。
- 文件记录仅包含项目相对路径与前后哈希，不包含源代码；不会导出 API Key、完整项目路径、原始终端输出或模型推理。
- 可将凭证导出为 Markdown 或 JSON，用于代码审查、事故记录或交接。
- 可随时将凭证与当前工作区对照，确认受跟踪文件是否仍与任务结束状态一致，或在回退后是否与任务前快照一致。

### 本地快照、编辑器与设置

- 每个 Edit 任务在任何修改前都会创建本地快照；无需 Git。
- 可从任务结果页或 Snapshots 页面恢复任务。快照会排除 `.git`、`node_modules`、构建产物和大于 25MB 的文件。
- 恢复时会校验项目边界与符号链接，防止向所选项目外写入。
- 可浏览项目文件、预览文本，并查看任务前后的 Monaco Diff。
- 大文件预览和文件搜索均有限制，不会一次读入整个文件或无限递归。
- Monaco 仅在预览文件或查看 Diff 时加载，减少初始启动成本。
- **Appearance：** 深色/浅色主题、本地背景图片、图片透明度和自定义 CSS。
- **General：** 系统/中文/英文界面语言、每任务 Token 与成本上限、本地历史保留、立即清理、脱敏诊断导出和 GitHub Release 检查。
- **Models：** 服务商、模型名、API 地址、上下文上限、任务预算、超时、请求头与可选输入/输出价格。

## 0.1.7 版本

- **大项目任务更快：** 任务结束时，界面 Diff 与变更凭证哈希共用一次项目扫描，避免重复遍历整棵文件树。
- **流式工作区更流畅：** 模型和终端输出会短暂批量后再渲染，避免长回答反复重渲染整个任务历史。
- **编辑器资源更小：** Monaco 使用精简编辑器入口和常用语法定义，不再打包未使用的语言服务；渲染层构建产物约从 28MB 降至 12MB。
- **安装包：** `CrazyParrot-0.1.7-arm64.dmg` 面向 Apple Silicon，已使用 Developer ID 签名、完成 Apple 公证、贴票并通过 Gatekeeper 验证；`CrazyParrot-0.1.7-Windows-x64.exe` 为 Windows x64 NSIS 安装包。

## 安装与首次使用

1. 从 [Releases](https://github.com/ruaibeite/CrazyParrot/releases) 下载 Apple Silicon macOS 的 `CrazyParrot-<version>-arm64.dmg`，或 Windows x64 的 `CrazyParrot-<version>-Windows-x64.exe`。
2. 在 macOS 上，将 `CrazyParrot.app` 拖入“应用程序”文件夹后启动。
3. 打开 **Settings → Models**，新增模型服务商并测试连接。
4. 从左侧边栏新建项目，或导入现有本地项目。
5. 确保项目根目录有完整的 `README.md` 和 `AGENTS.md`，再在应用中确认 Parrot 规则。
6. 打开项目，选择 Ask、Plan 或 Edit，描述要完成的工作。
7. 对 Edit 任务，查看提示性的**变更意图（Change Intent）**：预测范围、计划命令、风险、验收检查和初始审批需求；当范围扩大时，Agent 可能再次请求审批。
8. 审查每个审批请求。任务结束后，先查看变更凭证，再按需检查 Diff 或终端历史；可使用凭证的工作区检查和快照引用进行验证或回退。

## 模型服务商与隐私

CrazyParrot 不提供账户或共享 API Key。你可以配置：

- OpenAI Chat Completions 兼容 API，包括 OpenAI、DeepSeek 与兼容的自托管服务。
- Anthropic Messages 兼容 API。

远程 API 必须使用 HTTPS；仅 `localhost`、`127.0.0.1` 和 `::1` 可使用 HTTP。API Key 存储在系统凭据库中，不会写入项目文件、明文 SQLite 数据或应用日志。

- CrazyParrot 没有账户系统、云同步、托管工作区或项目内容中继服务。
- 你选择项目目录、模型和 API 地址；文件系统与 shell 操作均在 Electron 主进程本地执行。
- **当 Agent 请求模型响应时，项目规则、任务提示词、Agent 读取的文件内容以及命令结果会发送到你配置的服务商。** 请仅使用你信任的服务商，并审查其数据政策。
- 渲染进程没有直接的 Node.js 或 shell 访问权限。来自 UI 或模型的所有路径、文件操作、命令和服务商输入都会在主进程再次校验。

## 安全模型

- 已启用 `contextIsolation` 与 Chromium 渲染进程沙箱，并禁用渲染进程 Node.js 集成。
- 默认阻止外部导航，拒绝 `window.open`，并使用内容安全策略保护渲染进程。
- 每个项目路径都会检查项目边界和符号链接。
- 搜索会跳过符号链接、依赖/构建目录，并限制深度、文件数量、单文件大小和时间。
- 删除模型服务商前会检查排队、运行、等待审批和可恢复任务，避免遗留悬空任务状态。

## 项目规则：Parrot

CrazyParrot 将 `README.md + AGENTS.md` 作为项目的 Parrot。必要时请在 `AGENTS.md` 中填写：

- 开发、构建、测试和端到端测试命令。
- Agent 不得修改的文件与目录。
- 数据库、部署、密钥和生产环境约束。
- UI 行为、业务语义与验收标准。
- 需要单元测试或 Electron E2E 覆盖的变更。

受保护路径支持精确路径（如 `.env`）、目录前缀（如 `configs/`）和后缀模式（如 `*.pem`）。

## 本地开发

需要 Node.js 22+ 与 npm。常用命令：`npm install`、`npm run dev`、`npm run typecheck`、`npm test`、`npm run build` 和 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`。

- macOS Apple Silicon 打包、签名、公证并生成 DMG：`npm run package:mac`。
- Windows x64 生成 NSIS 安装包：`npm run package:win`。

`package:mac` 需要本机钥匙串中名为 `crazyparrot-notary` 的公证配置，以及名为 `ruaibeite kenny (3XBX425673)` 的签名身份。缺少这些凭据时，命令会失败，而不会生成被表述为“已公证”的安装包。

## 当前限制与反馈

- Release 目前提供 macOS Apple Silicon 和 Windows x64 包；请查看每个 Release 资产说明中的确切签名和公证状态。
- 没有账户系统、团队协作、云同步或远程执行；安装仍完全由用户控制。
- 变更凭证是本地信任工件，不是法律合规认证，也不能证明机器遭攻陷后的内容完整性。
- CrazyParrot 不能替代人工代码审查。请仔细审查生产部署、数据库迁移、破坏性操作和密钥处理。

请使用本仓库的 Issues 提交 Bug、建议和安装反馈。不要在 Issue、日志、截图或示例中粘贴 API Key、证书、私有源代码或敏感项目路径。
