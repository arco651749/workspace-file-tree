# Workspace File Tree for Antigravity (Windows & macOS)

面向 **Google Antigravity (2.22.0+)** 的跨平台侧边栏文件树与体验增强插件（支持 **Windows / macOS / Linux**，零 `npm install` 依赖，开箱即用）。

An interactive, cross-platform Project File Tree Sidebar extension for **Antigravity 2.22.0+** (Windows / macOS / Linux) with zero external npm dependencies.

![Antigravity UI Extension](assets/logo.svg)

---

## ✨ 核心功能 (Features)

- 📑 **原生标签页与右键外部 App 打开 (Native Tab & Open With External App)**
  - **双击 / 行内 `↗️`**：直接在 Antigravity 内置原生标签页打开（代码进 Monaco 编辑器、Markdown 进预览、图片进查看器）。
  - **右键菜单（跨平台）**：右键任意文件/文件夹（或点面板顶栏/预览抽屉的 **`🚀`** 按钮）即可：
    - 用外部编辑器打开（自动检测本机已装的 **VS Code、Cursor、Windsurf、Zed、CLion、Xcode、JetBrains** 等；macOS 自动通过 AppKit 提取真实应用图标并记住最近常用 App）。
    - **选择其他 App 打开**：macOS 调用原生应用选择器，Windows 调用系统「打开方式」弹窗。
    - **在访达 (Finder) / 文件资源管理器中显示**、**在终端打开所在目录**、**复制完整路径 / `@相对路径` 引用**、**安全移至废纸篓 / 回收站**。
- 🖼️ **多图预览左右切换 (Multi-Image Gallery Switching)**
  - **聊天上传多图切换**：在输入框或聊天消息中上传/展示 2 张及以上图片时，点开任意一张大图预览（全屏弹窗或原生图片页），自动浮现左右 **`‹` / `›`** 切换按钮与底部 **`当前 / 总数`** 计数条，支持点击或键盘 **`←` / `→`** 循环切换，无需退出重开。
  - **文件树抽屉图片切换**：在侧边栏预览图片时，若同目录有多张图片，标题栏自动出现 **`‹ 1/N ›`** 按钮，同样支持 **`←` / `→`** 快捷键切换。
- 📁 **工作区自动感知 & 实时过滤**：自动跟随当前项目工作区、支持动态切换目录 (`📂`)、实时文件名/路径搜索过滤、一键切换隐藏文件（`.git`、`.vscode` 等）。
- 👁️ **多格式分屏预览抽屉**：支持代码高亮、Markdown（含 Mermaid 图表）、HTML、PDF、音视频、图片（带区域批注与缩放），以及可选 `officecli` 预览 Office 文档。
- 🚀 **多选拖拽进聊天框 (`@` 引用)**：支持 `Ctrl/Cmd + Click`、`Shift + Click` 多选文件，直接拖入对话输入框或点 `💬` 生成 `@rel/path/to/file` 上下文引用。

---

## 📦 环境要求 (Requirements)

- **Antigravity**：`2.22.0` 及以上版本（Windows / macOS / Linux）
- **零额外依赖**：无需安装第三方 npm 包，直接使用 Antigravity 内置 Node.js 运行时与 `sidecar_sdk`。
- **可选工具**：`officecli`（仅用于侧边栏直接预览 `.docx` / `.xlsx` / `.pptx`，不装不影响其他所有功能）。

---

## 🛠️ 安装与使用 (Installation)

### 方式一：Windows 用户（推荐）

#### A. 不会用 Git 的朋友（直接下载 ZIP 一键安装）
1. 点击本页右上角绿色 **`Code`** 按钮 → **`Download ZIP`**，把压缩包**完整解压**到一个普通文件夹。
2. 打开解压后的 `scripts` 文件夹，双击 **`install-win.bat`**。
   - 会自动将插件安装到 `%USERPROFILE%\.gemini\config\plugins\workspace-file-tree`；
   - 并自动查找 `Antigravity.exe` 在桌面创建一个 **`Antigravity (增强版)`** 快捷方式（自动附带 `--remote-debugging-port=9222`）。
3. **完全退出**当前 Antigravity，双击桌面生成的 **`Antigravity (增强版)`**（或 `scripts\launch-win.bat`）重新打开。
4. 打开左侧 **Customizations / Plugins**，确认 **Workspace File Tree** 已开启，在右侧辅助栏切到 **Workspace Files** 即可使用！

#### B. 命令行一键安装（PowerShell / Git）
```powershell
git clone https://github.com/arco651749/workspace-file-tree.git "$env:USERPROFILE\.gemini\config\plugins\workspace-file-tree"
```
然后右键你的 Antigravity 桌面快捷方式 → **属性** → 在「目标」末尾加上空格和 `--remote-debugging-port=9222`（用于启用拖拽进聊天框、原生标签页跳转和多图左右切换）：
```text
"...\Antigravity.exe" --remote-debugging-port=9222
```
重启 Antigravity 并在 **Customizations / Plugins** 中开启 **Workspace File Tree** 即可。

*(想卸载时，运行 `scripts\uninstall-win.bat` 或直接删除 `%USERPROFILE%\.gemini\config\plugins\workspace-file-tree` 目录即可。)*

---

### 方式二：macOS / Linux 用户

#### 1. 克隆到插件目录
```bash
git clone https://github.com/arco651749/workspace-file-tree.git ~/.gemini/config/plugins/workspace-file-tree
```

#### 2. 开启插件
打开 Antigravity → 进入 **Customizations / Plugins** → 确认 **Workspace File Tree** 已启用，然后在右侧辅助栏打开 **Workspace Files** 面板即可。

#### 3. 启用完整增强能力（拖拽进聊天框、原生标签页跳转、聊天多图左右切换）
从 Antigravity 2.25 起，需带远程调试端口启动客户端（插件会自动读取 `DevToolsActivePort` 或 `AG_CDP_PORT`）：

- **macOS**：先按 `Cmd + Q` 完全退出 Antigravity，再在终端执行：
  ```bash
  open -a "/Applications/Antigravity.app" --args --remote-debugging-port=9222
  ```
- **Linux**：
  ```bash
  antigravity --remote-debugging-port=9222
  ```

---

## 🔄 如何更新 (Update)

如果是通过 `git clone` 安装的，直接在插件目录拉取最新代码，然后在插件管理页把 **Workspace File Tree** 关闭再重新打开一次即可：

- **macOS / Linux**：
  ```bash
  git -C ~/.gemini/config/plugins/workspace-file-tree pull
  ```
- **Windows (PowerShell)**：
  ```powershell
  git -C "$env:USERPROFILE\.gemini\config\plugins\workspace-file-tree" pull
  ```

---

## 📂 目录结构 (Project Structure)

```text
workspace-file-tree/
├── plugin.json              # Antigravity 插件清单
├── README.md                # Windows & macOS 安装使用说明
├── assets/
│   └── logo.svg             # 插件图标
├── scripts/
│   ├── install-win.bat      # Windows 一键安装与创建快捷方式脚本
│   ├── launch-win.bat       # Windows 带调试端口启动脚本
│   └── uninstall-win.bat    # Windows 一键卸载脚本
└── sidecars/
    └── panel/               # Sidecar 后端与前端 UI
        ├── sidecar.json     # Aux-Pane 面板注册配置
        ├── package.json     # Node ESM 配置
        ├── main.mjs         # 跨平台后端（文件树、剪贴板、回收站、外部 App、CDP 桥接）
        ├── index.html       # 面板页面结构
        ├── app.js           # 前端交互、右键菜单与预览抽屉多图切换
        ├── previewers.js    # 多格式文件预览策略
        └── styles.css       # 深浅色自适应样式
```

---

## 📄 License & Credits

- MIT License
- Upstream repository: [arco651749/workspace-file-tree](https://github.com/arco651749/workspace-file-tree)
