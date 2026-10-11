# Workspace File Tree for ANTIGRAVITY (2.22.0 以上)

An interactive, feature-rich Project File Tree Sidebar extension for **ANTIGRAVITY 2.22.0 以上**.

![Antigravity UI Extension](assets/logo.svg)

---

## ✨ Features

- 📑 **Native Tab Integration (Antigravity 2.22+)**:
  - **Right-Click**: Right-click any file in the tree to immediately open it in Antigravity's built-in native preview tab!
  - **Double-Click**: Standard IDE muscle-memory double-click to open in native tab.
  - **Hover Action (`↗️`) & Header Button**: Dedicated one-click trigger buttons in tree rows and preview drawer.
  - Automatically loads the native tool tailored for each file type: **Markdown Viewer** (Preview/Raw), **Image Viewer** (region commenting), or **Monaco Editor**.
- 💬 **Ask Agent & Selection Quote**:
  - Inline prompt popover for asking the AI agent about files, image annotations, or quoted text snippets.
  - Native OS clipboard integration (`📋 Ctrl + C, V`) for instant paste into chat.
- 📁 **Active Workspace Awareness**: Automatically detects and displays the files in your current project workspace. Supports dynamic root switching (`📂`).
- 🔍 **Real-time Filter Search**: Instant type-to-filter by file name or relative path.
- 👁️ **Hidden File Filtering**: Quickly toggle visibility of dotfiles (`.git`, `.vscode`, etc.) and common ignore patterns.
- 🖼️ **Dual Preview Drawer (Split Pane)**:
  - **Code & Text Preview**: View file contents with syntax fonts and size badges.
  - **Image Preview**: Supports PNG, JPG, JPEG, GIF, SVG, WebP, ICO, and BMP with transparent checkerboard background and live dimension resolution (`W×H px`).
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

---

## 📄 License
MIT License
