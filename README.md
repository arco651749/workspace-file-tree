# Workspace File Tree for ANTIGRAVITY (2.22.0 以上)

An interactive, feature-rich Project File Tree Sidebar extension for **ANTIGRAVITY 2.22.0 以上**.

![Antigravity UI Extension](assets/logo.svg)

---

## ✨ Features

- 📑 **Native Tab Integration & Right-Click Context Menu (Antigravity 2.22+)**:
  - **Double-Click / Hover Action (`↗️`)**: Open any file directly in Antigravity's built-in native preview tab (**Markdown Viewer**, **Image Viewer**, or **Monaco Editor**).
  - **Right-Click Context Menu (Cross-Platform)**: Open files or folders in external editors/IDEs (auto-detects installed apps such as VS Code, Cursor, Windsurf, Zed, CLion, Xcode, JetBrains IDEs, etc., with native macOS app icons via AppKit), choose any custom macOS `.app`, reveal in **Finder / File Explorer**, open in **Terminal**, copy full/`@rel` path, or safely move to **Trash / Recycle Bin**.
  - **macOS Full Compatibility**: Native support for macOS `DevToolsActivePort` discovery (`~/Library/Application Support/Antigravity/DevToolsActivePort`), macOS Trash (`Finder`), and native OS text/image clipboard (`pbcopy` / `osascript`).
- 💬 **Ask Agent & Selection Quote**:
  - Inline prompt popover for asking the AI agent about files, image annotations, or quoted text snippets.
  - Native OS clipboard integration (`📋 Ctrl + C, V`) for instant paste into chat.
- 📁 **Active Workspace Awareness**: Automatically detects and displays the files in your current project workspace. Supports dynamic root switching (`📂`).
- 🔍 **Real-time Filter Search**: Instant type-to-filter by file name or relative path.
- 👁️ **Hidden File Filtering**: Quickly toggle visibility of dotfiles (`.git`, `.vscode`, etc.) and common ignore patterns.
- 🖼️ **Dual Preview Drawer (Split Pane)**:
  - **Code & Text Preview**: View file contents with syntax fonts and size badges.
  - **Image Preview & Multi-Image Gallery Switching**: Supports PNG, JPG, JPEG, GIF, SVG, WebP, ICO, and BMP with transparent checkerboard background and live dimension resolution (`W×H px`). When previewing images in a folder with 2+ images (or opening uploaded multi-image attachments in Antigravity chat via the CDP bridge), switch seamlessly left/right using `‹` / `›` buttons or `←` / `→` arrow keys without closing and reopening.
  - **Draggable Resizer**: Seamlessly resize the preview pane up and down without obscuring the file tree's scrollbar.
- 🎯 **Multi-Selection**:
  - `Click`: Single select and preview.
  - `Ctrl + Click` / `Cmd + Click`: Free multi-select individual files.
  - `Shift + Click`: Range select consecutive items.
- 🚀 **Drag & Drop to Chat (`@` Mentions)**:
  - Drag one or multiple selected files directly into Antigravity's chat prompt.
  - Automatically formats dropped items as `@rel/path/to/file` context chips (with automatic space escaping).
  - Compatible with native Monaco editor drop targets.

---

## 📂 Project Structure

```text
workspace-file-tree/
├── plugin.json              # Plugin manifest
├── assets/
│   └── logo.svg             # Extension icon
├── sidecars/
│   └── panel/               # Sidecar Web UI backend & frontend
│       ├── sidecar.json     # Process & Aux Pane view registration
│       ├── package.json     # Node ES module definition
│       ├── main.mjs         # Node.js backend (File traversal, Image Base64 API)
│       ├── index.html       # HTML UI markup
│       ├── app.js           # Frontend client logic & drag-and-drop handler
│       └── styles.css       # Theme-aware styles & split pane layout
├── .gitignore
└── README.md
```

---

## 📦 Requirements & Dependencies

- **Host Environment**: **ANTIGRAVITY 2.22.0 或以上版本** (Windows / macOS / Linux)。
- **Zero NPM Dependencies (零額外依賴)**:
  - ⚡ **無需執行 `npm install`！**
  - 後端直接採用 Antigravity 內建的 Node.js 執行階段與原生 `sidecar_sdk`。
  - 前端程式庫（如語法高亮 `highlight.min.js`、PDF 檢視器 `pdf.min.js` 等）皆已完整打包在倉庫中，開箱即用。
- **Optional Tools (選用擴充工具)**:
  - `officecli`: *(可選)* 若需要側欄直接預覽 Microsoft Office 文件（`.docx`, `.xlsx`, `.pptx`），可安裝 `officecli` 工具；未安裝時不影響其他任何檔案類型的預覽與原生分頁開啟功能。

---

## 🛠️ Installation & Usage

### 1. Installation
Clone or copy this repository into your Antigravity plugins directory:

- **Windows**: `%USERPROFILE%\.gemini\config\plugins\workspace-file-tree`
- **macOS / Linux**: `~/.gemini/config/plugins/workspace-file-tree`

```bash
git clone <repo-url> "%USERPROFILE%\.gemini\config\plugins\workspace-file-tree"
```

### 2. Enable in Antigravity
1. Open Antigravity IDE.
2. Open the **Customizations** / **Plugins** manager.
3. Verify `Workspace File Tree` is enabled.
4. Toggle the auxiliary side pane to open the file tree!

### 3. Enable Drag & Drop to Chat (Antigravity 2.25+)
Starting from **Antigravity 2.25**, Chromium blocks native cross-scheme (`plugin://` → `https://127.0.0.1`) HTML5 drag-and-drop. This plugin uses a **Parent-Frame Drag Bridge** via CDP (Chrome DevTools Protocol) to restore drag-and-drop into the chat box.

To enable it, launch Antigravity with `--remote-debugging-port=9222`:
- **Windows Shortcut**: Right-click your Antigravity shortcut → **Properties** → append `--remote-debugging-port=9222` to the **Target** field:
  ```text
  "...\Antigravity.exe" --remote-debugging-port=9222
  ```
- **macOS**:
  ```bash
  open -a "/Applications/Antigravity.app" --args --remote-debugging-port=9222
  ```
- **Linux / CLI**:
  ```bash
  antigravity --remote-debugging-port=9222
  ```
*(Restart Antigravity after adding the flag. The backend automatically reads `DevToolsActivePort` to connect.)*

---

## 🗺️ Roadmap & Planned Features (TODO)

- [ ] 📑 **Enhanced Full-Tab Viewers for Binary Documents (PDF & Office)**:
  - *Context*: Antigravity 官方內建的檔案分頁目前對二進位檔案缺乏專屬檢視器，直接進入 Monaco Editor 會呈現原始字元串流與亂碼（Mojibake）。
  - **規劃解決方案 (Planned Solution)**：
    - [ ] **全螢幕 PDF 分頁檢視器 (Full-Tab PDF Viewer)**：利用已內建的 `pdf.min.js`，在主分頁中提供高畫質多頁捲動、縮放與文字選取功能。
    - [ ] **全螢幕 Office 分頁檢視器 (Full-Tab Office Viewer)**：利用 `officecli` 將 `.docx`、`.xlsx`、`.pptx` 轉換為格式化 HTML 在主分頁呈現完整版面。
    - [ ] **CDP 動態分頁標籤名稱置換 (Dynamic Tab Titles)**：透過底層 Chrome DevTools 協定自動將分頁頂部標籤更新為真實檔案名稱（例如 `📕 document.pdf`、`📄 report.docx`）。

---

## 📄 License
MIT License
