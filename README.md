# 🦜 CrazyParrot

> A local-first desktop coding agent that works within your project's rules.

CrazyParrot helps you collaborate with an AI agent inside a local project. It reads your project's `README.md` and `AGENTS.md`, then—when appropriate—inspects files, edits code, runs commands, and reports test evidence. Filesystem access, terminal commands, model configuration, task history, and snapshots remain managed by the local app.

Risky commands require your explicit approval. Every task can be stopped, and Edit tasks can be restored to their pre-task state.

Download the latest installer from [GitHub Releases](https://github.com/ruaibeite/CrazyParrot/releases).

## Who it is for

- Developers who want AI assistance that follows repository-specific conventions.
- Teams or individuals who do not want to connect their project to a hosted workspace, coding bot, or account system.
- Anyone who needs a clear local record of files changed, commands run, and test outcomes.
- Projects without Git that still need safe, task-level rollback.
- Users with their own OpenAI Chat Completions, Anthropic Messages, or compatible model provider credentials.

## Highlights

### Project rules come first

- When you create or import a project, CrazyParrot reads the root `README.md` and `AGENTS.md`.
- It asks you to complete or reconfirm the project rules when they are incomplete or have changed.
- Protected paths in `AGENTS.md` prevent agent writes to files such as `.env`, certificates, keys, and other project-defined sensitive paths.

### Three task modes

| Mode | Permissions | Best for |
| --- | --- | --- |
| Ask | Read, search, and explain only | Understanding code, finding an entry point, analyzing an error |
| Plan | Read, search, and produce an implementation plan | Reviewing scope, risks, APIs, and test coverage before editing |
| Edit | Read, edit, and run approved commands | Implementing features, fixing bugs, and running tests |

### Auditable task execution

- Tasks, tool calls, model output, terminal output, and final evidence are stored locally.
- A small set of predictable local inspection and test commands may run unattended, such as `git status`, `npm test`, and `npm run build`.
- Unknown commands, inline scripts, dependency installation, network access, pipes, redirection, and other higher-risk operations require per-command approval.
- A non-zero command result is returned to the agent for diagnosis rather than silently ending the task.
- If Git reports that the project is not a repository, CrazyParrot continues through the filesystem. Git is useful for diff presentation, but it is never a project requirement.
- If the interactive terminal cannot start, CrazyParrot retries the command through the standard shell and records the result instead of terminating the task.
- Dynamic approvals resume from the pending tool call instead of repeating completed file writes.
- You can stop a task at any time; active model requests and terminal commands receive a cancellation signal.

### Local snapshots and rollback

- Each Edit task creates a local snapshot before any changes are made; Git is not required.
- Restore a task from its result view or from the Snapshots page.
- Snapshots exclude `.git`, `node_modules`, build output, and files larger than 25 MB.
- Storage usage is calculated from deduplicated blobs. Retention time and storage limits are configurable under **Settings → Snapshot policy**.
- Restore operations validate project boundaries and symbolic links before writing, preventing writes outside the selected project.

### File and editor experience

- Browse project files, preview text, and inspect Monaco diffs before and after a task.
- Large-file previews and file search are bounded: they do not load an entire file or recurse indefinitely.
- Monaco loads only when a file preview or diff needs it, reducing initial startup cost.
- Terminal output is displayed live and consolidated into local history when the command finishes.

### Appearance and workspace settings

Use the gear icon in the top-right corner to manage global settings:

- **Appearance:** dark/light theme, a local background image, image opacity, and custom CSS.
- **Models:** providers, model name, API endpoint, context limit, task budget, timeout, and request headers.
- **Snapshot policy:** retention period, storage limit, and actual storage usage.

The left navigation contains projects, snapshots, and project decisions. It can be collapsed to an icon rail and remembers your choice after restarting the app.

## Installation and first run

1. Download `CrazyParrot-<version>-arm64.dmg` for macOS Apple Silicon or `CrazyParrot-<version>-Windows-x64.exe` for Windows x64 from [Releases](https://github.com/ruaibeite/CrazyParrot/releases).
2. On macOS, drag `CrazyParrot.app` to the Applications folder and launch it.
3. Open **Settings → Models**, add a model provider, and test the connection.
4. Create a new project or import an existing local project from the left sidebar.
5. Ensure the project root contains a complete `README.md` and `AGENTS.md`, then confirm its Parrot rules in the app.
6. Open the project, choose Ask, Plan, or Edit, and describe the work you want done.
7. Review every requested plan or command approval. When the task finishes, inspect changed files, terminal output, and test evidence.

Only packages explicitly described in a release as **Developer ID signed and Apple notarized** should be expected to open directly through macOS Gatekeeper. The current official macOS package is Developer ID signed and notarized. The Windows package is currently unsigned; if Windows SmartScreen appears, choose **More info → Run anyway** only after verifying that you downloaded it from this repository's release page.

## Model providers

CrazyParrot does not provide accounts or shared API keys. Configure your own provider in Settings:

- OpenAI Chat Completions-compatible APIs, including OpenAI, DeepSeek, and compatible self-hosted services.
- Anthropic Messages-compatible APIs.

Remote APIs must use HTTPS. HTTP is allowed only for `localhost`, `127.0.0.1`, and `::1`. API keys are stored in the system credential store; they are not written to project files, plaintext SQLite data, or application logs.

### Privacy boundary

- CrazyParrot has no account system, cloud sync, hosted workspace, or relay service for project contents.
- You choose the project folder, model, and API endpoint. Filesystem and shell operations run locally in the Electron main process.
- **When an agent requests a model response, your project rules, task prompt, file contents read by the agent, and command results are sent to the provider you configured.** Use only providers you trust and review their data policy.
- The renderer has no direct Node.js or shell access. All paths, file actions, commands, and provider input originating from the UI or a model are revalidated in the main process.

## Security model

- `contextIsolation` is enabled and renderer Node.js integration is disabled.
- External navigation is blocked, `window.open` is denied by default, and the renderer is protected by a Content Security Policy.
- Every project path is checked against project boundaries and symbolic links.
- Search skips symbolic links, dependency/build directories, and enforces depth, file-count, per-file-size, and time limits.
- Provider removal checks queued, running, and approval-waiting tasks so they cannot remain permanently marked as running.
- A provider's configured context limit is applied to requests. When a history is too long, CrazyParrot preserves system rules and recent conversation and records that trimming occurred.

## Project rules: Parrot

CrazyParrot uses `README.md + AGENTS.md` as the project's Parrot. Put the following in `AGENTS.md` whenever applicable:

- Development, build, test, and end-to-end test commands.
- Files and directories the agent must not touch.
- Database, deployment, secrets, and production-environment constraints.
- UI behavior, business semantics, and acceptance criteria.
- Changes that require unit tests or Electron E2E coverage.

Protected-path patterns support only three forms:

- An exact path, such as `.env`
- A directory prefix, such as `configs/`
- A suffix pattern, such as `*.pem`

## Architecture

```text
Renderer (React)
  └─ Typed preload IPC only
       └─ Main process (Electron)
            ├─ Project-boundary checks, command approvals, and Parrot validation
            ├─ Provider API, task queue, cancellation, and checkpoint recovery
            ├─ Local SQLite tasks, events, decisions, and settings
            └─ Local snapshots, background images, and system credentials
```

## Local development

### Requirements

- Node.js 22 or later
- npm
- macOS packaging requires Apple Developer signing and notarization credentials.
- Windows packaging should be run in a Windows-capable build environment.

### Common commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
env -u ELECTRON_RUN_AS_NODE npm run test:e2e
```

### Packaging

```bash
# macOS Apple Silicon: build, sign, notarize, and create a DMG
npm run package:mac

# Windows x64: create an NSIS installer
npm run package:win
```

`package:mac` requires a local Keychain notarization profile named `crazyparrot-notary` and a signing identity named `ruaibeite kenny (3XBX425673)`. Without those credentials, the command fails instead of producing a package presented as notarized.

## Testing

- Unit tests cover command risk classification, project path/symlink boundaries, snapshot restore, provider cancellation, context budgeting, Parrot validation, and event consolidation.
- Playwright Electron E2E tests cover startup, Chinese/English UI selection, appearance persistence, sidebar collapse persistence, explicit task-mode selection, lazy Monaco loading, and Parrot health checks.
- Changes to task execution, risk, snapshots, audits, or provider logic should include focused unit tests. End-to-end interaction changes should update Electron E2E coverage.

## Current limitations

- Releases currently provide macOS Apple Silicon and Windows x64 builds. Check each release's asset notes for its exact signing and notarization state.
- There is no account system, team collaboration, cloud sync, remote execution, or automatic update service.
- CrazyParrot does not replace human code review. Review production deployments, database migrations, destructive actions, and secret handling carefully.
- Agent quality depends on the clarity of the project rules, the selected model, and provider reliability.

## Feedback

Please use this repository's Issues for bugs, suggestions, and installation feedback. Do not paste API keys, certificates, private source code, or sensitive project paths into issues, logs, screenshots, or examples.
