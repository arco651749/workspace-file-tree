const getSidecar = () => window.sidecar;
const $ = (id) => document.getElementById(id);

let currentWorkspaceUri = null;
let currentRootPath = '';
let showHiddenFiles = false;
let activePreviewFile = null;

// Multi-selection state
const selectedItems = new Map(); // relPath -> { item, row }
let lastClickedRow = null;

// File icons map
const EXT_ICONS = {
  '.js': '🟨', '.mjs': '🟨', '.cjs': '🟨',
  '.ts': '🟦', '.tsx': '⚛️', '.jsx': '⚛️',
  '.py': '🐍',
  '.json': '⚙️',
  '.md': '📝', '.txt': '📄',
  '.html': '🌐', '.htm': '🌐',
  '.css': '🎨', '.scss': '🎨', '.less': '🎨',
  '.ps1': '⚡', '.sh': '⚡', '.bat': '⚡',
  '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.svg': '🖼️', '.webp': '🖼️',
  '.pdf': '📕',
  '.zip': '📦', '.tar': '📦', '.gz': '📦',
  '.yaml': '🔧', '.yml': '🔧', '.toml': '🔧',
  '.rs': '🦀', '.go': '🐹', '.java': '☕', '.cpp': '⚙️', '.c': '⚙️',
  '.sql': '🗄️',
};

function getFileIcon(ext, isDirectory, isExpanded = false) {
  if (isDirectory) {
    return isExpanded ? '📂' : '📁';
  }
  return EXT_ICONS[ext] || '📄';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let toastTimer;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// ---------------------------------------------------------------------------
// API Calls
// ---------------------------------------------------------------------------
async function fetchApi(path, options = {}) {
  const bodyData = options.body || {};
  if (currentWorkspaceUri && !bodyData.workspaceUri) {
    bodyData.workspaceUri = currentWorkspaceUri;
  }
  if (currentRootPath && !bodyData.root) {
    bodyData.root = currentRootPath;
  }

  const s = getSidecar();
  if (!s || typeof s.fetch !== 'function') {
    const res = await fetch(path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.method === 'POST' ? JSON.stringify(bodyData) : undefined,
    });
    return res.json();
  }

  const res = await s.fetch(path, {
    method: options.method || 'GET',
    body: options.method === 'POST' ? JSON.stringify(bodyData) : undefined,
  });
  return res.json();
}
window.fetchApi = fetchApi;

// ---------------------------------------------------------------------------
// Selection Management
// ---------------------------------------------------------------------------
function clearSelection() {
  selectedItems.forEach(({ row }) => {
    if (row) row.classList.remove('selected');
  });
  selectedItems.clear();
}

function selectItem(item, row, addToExisting = false) {
  if (!addToExisting) {
    clearSelection();
  }
  selectedItems.set(item.relPath, { item, row });
  if (row) row.classList.add('selected');
  lastClickedRow = row;
}

function toggleItemSelection(item, row) {
  if (selectedItems.has(item.relPath)) {
    selectedItems.delete(item.relPath);
    if (row) row.classList.remove('selected');
  } else {
    selectedItems.set(item.relPath, { item, row });
    if (row) row.classList.add('selected');
  }
  lastClickedRow = row;
}

function selectRange(targetRow) {
  const allRows = Array.from(document.querySelectorAll('.tree-node-row'));
  const startIdx = allRows.indexOf(lastClickedRow);
  const endIdx = allRows.indexOf(targetRow);
  if (startIdx === -1 || endIdx === -1) {
    if (targetRow?.__item) selectItem(targetRow.__item, targetRow, true);
    return;
  }
  const [min, max] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  for (let i = min; i <= max; i++) {
    const r = allRows[i];
    if (r?.__item) {
      selectedItems.set(r.__item.relPath, { item: r.__item, row: r });
      r.classList.add('selected');
    }
  }
  lastClickedRow = targetRow;
}

// ---------------------------------------------------------------------------
// Native Antigravity Host Tab Integration
// ---------------------------------------------------------------------------
async function openFileInNativeTab(itemOrPath) {
  let targetPath = '';
  let fileName = '';

  if (typeof itemOrPath === 'string') {
    targetPath = itemOrPath;
    fileName = itemOrPath.split(/[/\\]/).pop();
  } else if (itemOrPath && typeof itemOrPath === 'object') {
    targetPath = itemOrPath.fullPath || itemOrPath.relPath;
    fileName = itemOrPath.name || targetPath.split(/[/\\]/).pop();
  }

  if (!targetPath) return;

  try {
    showToast(`正在開啟 ${fileName}...`);
    const res = await fetchApi('/api/open-native-tab', {
      method: 'POST',
      body: { path: targetPath, fullPath: itemOrPath?.fullPath }
    });

    if (res && res.success) {
      showToast(`📑 已在 Antigravity 主分頁開啟: ${fileName}`);
    } else {
      showToast(`開啟失敗: ${res?.error || '未知錯誤'}`);
    }
  } catch (err) {
    showToast(`開啟失敗: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Preview Close & Recycle Bin Operations (Module Top-Level Scope)
// ---------------------------------------------------------------------------
function closePreview() {
  const drawer = $('preview-drawer');
  if (drawer) drawer.hidden = true;
  if ($('preview-resizer')) $('preview-resizer').hidden = true;
  if ($('annot-send-popover')) $('annot-send-popover').hidden = true;
  if ($('selection-quote-bubble')) $('selection-quote-bubble').hidden = true;
  if ($('delete-confirm-modal')) $('delete-confirm-modal').hidden = true;
  if (window.previewManager) window.previewManager.destroy();
  const body = $('preview-body');
  if (body) body.innerHTML = '';
  const customActions = $('preview-custom-actions');
  if (customActions) customActions.innerHTML = '';
  if ($('btn-send-agent')) $('btn-send-agent').hidden = false;
  activePreviewFile = null;
}

function confirmRecycleDelete(fileName, isDir) {
  return new Promise((resolve) => {
    const modal = $('delete-confirm-modal');
    const targetEl = $('delete-confirm-target');
    const btnConfirm = $('btn-delete-confirm');
    const btnCancel = $('btn-delete-cancel');

    if (!modal) {
      resolve(true);
      return;
    }

    const typeStr = isDir ? '資料夾' : '檔案';
    if (targetEl) targetEl.textContent = `${typeStr}「${fileName}」`;

    modal.hidden = false;

    const cleanup = () => {
      modal.hidden = true;
      btnConfirm?.removeEventListener('click', onConfirm);
      btnCancel?.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlayClick);
      window.removeEventListener('keydown', onKeyDown);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onOverlayClick = (e) => {
      if (e.target === modal) {
        onCancel();
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };

    btnConfirm?.addEventListener('click', onConfirm);
    btnCancel?.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlayClick);
    window.addEventListener('keydown', onKeyDown);
    btnConfirm?.focus();
  });
}

async function deleteItemToRecycleBin(item, wrapper) {
  const isDir = Boolean(item.isDirectory);
  const confirmed = await confirmRecycleDelete(item.name, isDir);
  if (!confirmed) return;

  try {
    showToast(`正在將 ${item.name} 移至資源回收桶...`);
    const res = await fetchApi('/api/delete-to-recycle-bin', {
      method: 'POST',
      body: { path: item.relPath, fullPath: item.fullPath }
    });

    if (res && (res.success || res.ok)) {
      showToast(`🗑️ 已將 ${item.name} 移至資源回收桶`);
      if (activePreviewFile === item.relPath) {
        closePreview();
      }
      selectedItems.delete(item.relPath);
      if (wrapper) {
        wrapper.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        wrapper.style.opacity = '0';
        wrapper.style.transform = 'translateX(-10px)';
        setTimeout(() => {
          wrapper.remove();
        }, 200);
      }
    } else {
      showToast(`刪除失敗: ${res?.error || '未知錯誤'}`);
    }
  } catch (err) {
    showToast(`刪除失敗: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tree Rendering
// ---------------------------------------------------------------------------
function createTreeNode(item, level = 0) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node-wrapper';
  wrapper.dataset.path = item.relPath;
  wrapper.dataset.name = item.name.toLowerCase();

  const row = document.createElement('div');
  row.className = 'tree-node-row';
  row.style.paddingLeft = `${level * 16 + 8}px`;
  row.__item = item;
  row.setAttribute('draggable', 'true');

  if (selectedItems.has(item.relPath)) {
    row.classList.add('selected');
    selectedItems.set(item.relPath, { item, row });
  }

  const expander = document.createElement('span');
  expander.className = 'tree-expander';
  expander.textContent = item.isDirectory ? '▶' : '';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = getFileIcon(item.ext, item.isDirectory, false);

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = item.name;

  row.appendChild(expander);
  row.appendChild(icon);
  row.appendChild(label);

  // Actions on hover
  if (!item.isDirectory) {
    const actions = document.createElement('div');
    actions.className = 'tree-actions';

    const btnOpenTab = document.createElement('button');
    btnOpenTab.innerHTML = '↗️';
    btnOpenTab.title = '在 Antigravity 主分頁開啟 (Open in Native Tab)';
    btnOpenTab.addEventListener('click', (e) => {
      e.stopPropagation();
      openFileInNativeTab(item);
    });

    const btnChat = document.createElement('button');
    btnChat.innerHTML = '💬';
    btnChat.title = 'Ask Agent about this file';
    btnChat.addEventListener('click', (e) => {
      e.stopPropagation();
      sendFilePathToAgent(item.relPath);
    });

    const btnView = document.createElement('button');
    btnView.innerHTML = '👁️';
    btnView.title = 'Preview Content';
    btnView.addEventListener('click', (e) => {
      e.stopPropagation();
      openPreview(item.relPath);
    });

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-delete';
    btnDelete.innerHTML = '🗑️';
    btnDelete.title = '移至資源回收桶 (Move to Recycle Bin)';
    btnDelete.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteItemToRecycleBin(item, wrapper);
    });

    actions.appendChild(btnOpenTab);
    actions.appendChild(btnView);
    actions.appendChild(btnChat);
    actions.appendChild(btnDelete);
    row.appendChild(actions);
  }

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'tree-children hidden';

  let isLoaded = false;
  let isExpanded = false;

  async function toggleFolder() {
    if (!item.isDirectory) {
      openPreview(item.relPath);
      return;
    }

    isExpanded = !isExpanded;
    expander.classList.toggle('expanded', isExpanded);
    icon.textContent = getFileIcon(item.ext, true, isExpanded);

    if (isExpanded) {
      if (!isLoaded) {
        childrenContainer.innerHTML = '<div class="loading-state" style="padding:4px 16px;">Loading...</div>';
        childrenContainer.classList.remove('hidden');
        const data = await fetchApi('/api/tree', {
          method: 'POST',
          body: { dir: item.relPath, showHidden: showHiddenFiles },
        });

        childrenContainer.innerHTML = '';
        if (data.items && data.items.length > 0) {
          for (const child of data.items) {
            childrenContainer.appendChild(createTreeNode(child, level + 1));
          }
        } else {
          const empty = document.createElement('div');
          empty.className = 'empty-state';
          empty.style.padding = '4px 24px';
          empty.textContent = '(Empty folder)';
          childrenContainer.appendChild(empty);
        }
        isLoaded = true;
      }
      childrenContainer.classList.remove('hidden');
    } else {
      childrenContainer.classList.add('hidden');
    }
  }

  // Click & Selection logic
  row.addEventListener('click', (e) => {
    if (e.target === expander && item.isDirectory) {
      toggleFolder();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      toggleItemSelection(item, row);
      if (!item.isDirectory && selectedItems.has(item.relPath)) {
        openPreview(item.relPath);
      }
    } else if (e.shiftKey && lastClickedRow) {
      selectRange(row);
      if (!item.isDirectory) {
        openPreview(item.relPath);
      }
    } else {
      // Plain single click
      if (item.isDirectory) {
        clearSelection();
        selectItem(item, row, false);
        toggleFolder();
      } else {
        clearSelection();
        selectItem(item, row, false);
        openPreview(item.relPath);
      }
    }
  });

  // Right-click: Open directly in Antigravity's native preview tab
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!item.isDirectory) {
      clearSelection();
      selectItem(item, row, false);
      openFileInNativeTab(item);
    } else {
      toggleFolder();
    }
  });

  // Double-click: Open in Antigravity's native preview tab
  row.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!item.isDirectory) {
      openFileInNativeTab(item);
    } else {
      toggleFolder();
    }
  });

  // Drag and Drop to Chat / Editor
  row.addEventListener('dragstart', (e) => {
    if (!selectedItems.has(item.relPath)) {
      clearSelection();
      selectItem(item, row, false);
    }

    const itemsToDrag = Array.from(selectedItems.values()).map(v => v.item);

    // Option A: @relPath
    const textMentions = itemsToDrag.map(it => {
      const p = it.relPath.replace(/\\/g, '/');
      return p.includes(' ') ? `@"${p}"` : `@${p}`;
    }).join(' ');

    // URI list: file:///...
    // Note: URL characters like '#' (hash/fragment) and '?' must be encoded (e.g. encodeURI / encodeURIComponent),
    // otherwise IDE drop targets interpret '#' as a URL fragment identifier and truncate the file name!
    const uriList = itemsToDrag.map(it => {
      const full = it.fullPath || (currentRootPath ? `${currentRootPath}/${it.relPath}` : it.relPath);
      const normalized = full.replace(/\\/g, '/');
      const clean = normalized.startsWith('/') ? normalized : `/${normalized}`;
      // Encode URI components while keeping path slashes intact
      const encodedPath = clean.split('/').map(segment => encodeURIComponent(segment)).join('/');
      return `file://${encodedPath}`;
    }).join('\r\n');

    e.dataTransfer.setData('text/plain', textMentions);
    e.dataTransfer.setData('text/uri-list', uriList);
    e.dataTransfer.effectAllowed = 'copy';

    // Ghost drag image badge
    const count = itemsToDrag.length;
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost-badge';
    ghost.innerHTML = count > 1 
      ? `📦 <b>${count}</b> files` 
      : `${getFileIcon(item.ext, item.isDirectory)} <b>${item.name}</b>`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 12, 12);
    setTimeout(() => ghost.remove(), 0);

    row.classList.add('dragging');
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
  });

  wrapper.appendChild(row);
  if (item.isDirectory) {
    wrapper.appendChild(childrenContainer);
  }

  return wrapper;
}

async function loadRootTree() {
  clearSelection();
  const container = $('tree-container');
  container.innerHTML = '<div class="loading-state">Scanning workspace directory...</div>';

  try {
    const data = await fetchApi('/api/tree', {
      method: 'POST',
      body: {
        dir: '',
        showHidden: showHiddenFiles,
        workspaceUri: currentWorkspaceUri,
        root: currentRootPath || undefined
      },
    });

    if (data.root) {
      currentRootPath = data.root;
      $('workspace-name').textContent = data.name || 'Workspace';
      $('workspace-path').textContent = data.root;
      $('workspace-info-box').title = `Root: ${data.root}`;
    }

    if (data.error) {
      container.innerHTML = `<div class="empty-state" style="color:#f38ba8;">${data.error}</div>`;
      return;
    }

    container.innerHTML = '';
    if (!data.items || data.items.length === 0) {
      container.innerHTML = '<div class="empty-state">No files found in workspace.</div>';
      return;
    }

    for (const item of data.items) {
      container.appendChild(createTreeNode(item, 0));
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#f38ba8;">Error loading tree: ${err.message}</div>`;
  }
}

// ---------------------------------------------------------------------------
// File Preview (Strategy Pattern Dispatcher) & Agent Action
// ---------------------------------------------------------------------------
async function openPreview(relPath) {
  activePreviewFile = relPath;
  const drawer = $('preview-drawer');
  const resizer = $('preview-resizer');
  const body = $('preview-body');
  const customActions = $('preview-custom-actions');

  $('preview-title').textContent = relPath;
  $('preview-size').textContent = 'Loading...';
  $('preview-icon').textContent = '📄';
  if (customActions) customActions.innerHTML = '';

  body.innerHTML = '<div class="loading-state" style="padding:16px;">Reading content...</div>';
  drawer.hidden = false;
  if (resizer) resizer.hidden = false;

  try {
    const data = await fetchApi('/api/file-content', {
      method: 'POST',
      body: { path: relPath },
    });

    if (activePreviewFile !== relPath) return;

    if (data.error) {
      $('preview-size').textContent = '';
      body.innerHTML = `<div class="empty-state" style="color:#f38ba8;">Error: ${data.error}</div>`;
      return;
    }

    $('preview-size').textContent = formatSize(data.size);

    const context = {
      formatSize,
      getFileIcon,
      setSizeText: (txt) => { $('preview-size').textContent = txt; },
      setIcon: (ico) => { $('preview-icon').textContent = ico; },
      actionsHost: customActions,
      reRender: () => {
        if (window.previewManager && activePreviewFile === relPath) {
          window.previewManager.render(body, data, context);
        }
      }
    };

    if (window.previewManager) {
      await window.previewManager.render(body, data, context);
    } else {
      body.innerHTML = `<pre class="preview-code-block"><code>${data.content || ''}</code></pre>`;
    }
  } catch (err) {
    if (activePreviewFile !== relPath) return;
    body.innerHTML = `<div class="empty-state" style="color:#f38ba8;">Failed to preview: ${err.message}</div>`;
  }
}

let currentSelectedText = '';

function formatQuotedSnippet(relPath, selectedText) {
  const ext = (relPath.split('.').pop() || 'text').toLowerCase();
  return `Regarding \`${relPath}\`:\n\`\`\`${ext}\n${selectedText}\n\`\`\`\n`;
}

async function copySelectionToClipboard(relPath, selectedText) {
  const prompt = formatQuotedSnippet(relPath, selectedText);
  let copied = false;

  // 1. Try modern navigator.clipboard
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(prompt);
      copied = true;
    }
  } catch (err) {
    console.warn('navigator.clipboard.writeText failed:', err);
  }

  // 2. Try classic document.execCommand('copy')
  if (!copied) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = prompt;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      copied = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (_) {}
  }

  // 3. Fallback to Sidecar native OS clipboard
  if (!copied && window.sidecar && window.sidecar.fetch) {
    try {
      const res = await window.sidecar.fetch('/api/copy-text-to-clipboard', {
        method: 'POST',
        body: JSON.stringify({ text: prompt })
      });
      const data = await res.json();
      if (data && (data.ok || data.success)) copied = true;
    } catch (_) {}
  }

  if (copied) {
    showToast('📋 已複製引用文字！請在下方對話輸入框按 Ctrl+V 貼上');
  } else {
    showToast('複製失敗: 無法存取剪貼簿');
  }
}

async function sendSelectionToAgent(relPath, selectedText, customMessage = '') {
  let prompt = formatQuotedSnippet(relPath, selectedText);
  if (customMessage) {
    prompt += `\n**使用者說明 / 提問**：\n${customMessage}\n`;
  }

  try {
    await navigator.clipboard.writeText(prompt);
  } catch (_) {}

  const agentObj = getSidecar()?.agent;
  if (!agentObj) {
    showToast('📋 引用內容已複製到剪貼簿（可直接在輸入框 Ctrl+V 貼上）！');
    return;
  }

  try {
    await agentObj.sendMessage(prompt);
    showToast(customMessage ? '💬 已將引用文字與提問送出至 Agent！' : '💬 已將引用文字送出至 Agent！');
  } catch (err) {
    showToast(`發送失敗: ${err.message}`);
  }
}

async function sendFilePathToAgent(relPath, customMessage = '') {
  let prompt = `Please examine the file: \`${relPath}\``;
  if (customMessage) {
    prompt += `\n\n**使用者說明 / 提問**：\n${customMessage}\n`;
  }

  try {
    await navigator.clipboard.writeText(prompt);
  } catch (_) {}

  const agentObj = getSidecar()?.agent;
  if (!agentObj) {
    showToast(`File path copied: ${relPath}`);
    return;
  }

  try {
    await agentObj.sendMessage(prompt);
    showToast(customMessage ? `💬 已將檔案與提問送出至 Agent！` : `Sent "${relPath}" to Agent chat!`);
  } catch (err) {
    showToast(`Could not send message: ${err.message}`);
  }
}

function setupTextSelectionQuote() {
  const previewBody = $('preview-body');
  const bubble = $('selection-quote-bubble');
  const btnQuoteCopy = $('btn-quote-copy');
  const btnQuoteSend = $('btn-quote-send');
  if (!previewBody || !bubble) return;

  function updateSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !activePreviewFile) {
      currentSelectedText = '';
      bubble.hidden = true;
      if ($('btn-send-agent')) {
        $('btn-send-agent').textContent = '💬 Ask';
        $('btn-send-agent').title = 'Send file path to Agent';
      }
      return;
    }

    const text = sel.toString().trim();
    const anchorNode = sel.anchorNode;
    if (!previewBody.contains(anchorNode) || text.length === 0) {
      currentSelectedText = '';
      bubble.hidden = true;
      if ($('btn-send-agent')) {
        $('btn-send-agent').textContent = '💬 Ask';
        $('btn-send-agent').title = 'Send file path to Agent';
      }
      return;
    }

    currentSelectedText = text;
    if ($('btn-send-agent')) {
      $('btn-send-agent').textContent = '📋 Quote Text';
      $('btn-send-agent').title = `Quote selected ${text.length} characters (Ctrl+V ready)`;
    }

    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const drawer = $('preview-drawer');
      const drawerRect = drawer.getBoundingClientRect();

      const bubbleWidth = bubble.offsetWidth || 240;
      let left = rect.left - drawerRect.left + (rect.width / 2) - (bubbleWidth / 2);
      left = Math.max(10, Math.min(drawerRect.width - bubbleWidth - 10, left));
      let top = rect.top - drawerRect.top - 42;
      if (top < 40) top = rect.bottom - drawerRect.top + 8;

      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      bubble.hidden = false;
    } catch (_) {
      bubble.hidden = true;
    }
  }

  document.addEventListener('selectionchange', () => {
    updateSelection();
  });

  previewBody.addEventListener('mouseup', () => {
    setTimeout(updateSelection, 15);
  });

  // Action 1: Copy quote snippet (Ctrl+V) without auto-sending
  btnQuoteCopy?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (currentSelectedText && activePreviewFile) {
      const textToQuote = currentSelectedText;
      const fileToQuote = activePreviewFile;
      bubble.hidden = true;
      currentSelectedText = '';
      window.getSelection()?.removeAllRanges();
      if ($('btn-send-agent')) {
        $('btn-send-agent').textContent = '💬 Ask';
      }
      await copySelectionToClipboard(fileToQuote, textToQuote);
    }
  });

  // Action 2: Direct send to Agent (with prompt input popover)
  btnQuoteSend?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentSelectedText && activePreviewFile) {
      const textToQuote = currentSelectedText;
      const fileToQuote = activePreviewFile;
      bubble.hidden = true;

      if (typeof window.openAskAgentPopover === 'function') {
        window.openAskAgentPopover({
          title: '💬 提問 Agent (選取文字引用)',
          placeholder: '請輸入想對此段文字/程式碼提出的問題（按 Enter 直接發送）...',
          onSubmit: async (customMessage) => {
            currentSelectedText = '';
            window.getSelection()?.removeAllRanges();
            if ($('btn-send-agent')) {
              $('btn-send-agent').textContent = '💬 Ask';
            }
            await sendSelectionToAgent(fileToQuote, textToQuote, customMessage);
          }
        });
      } else {
        currentSelectedText = '';
        window.getSelection()?.removeAllRanges();
        if ($('btn-send-agent')) {
          $('btn-send-agent').textContent = '💬 Ask';
        }
        sendSelectionToAgent(fileToQuote, textToQuote);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Search Filter
// ---------------------------------------------------------------------------
function handleSearch(filterText) {
  const query = filterText.trim().toLowerCase();
  $('btn-clear-search').hidden = !query;

  const nodes = document.querySelectorAll('.tree-node-wrapper');
  if (!query) {
    nodes.forEach(n => n.style.display = '');
    return;
  }

  nodes.forEach(node => {
    const name = node.dataset.name || '';
    const path = (node.dataset.path || '').toLowerCase();
    const isMatch = name.includes(query) || path.includes(query);

    if (isMatch) {
      node.style.display = '';
      let parent = node.parentElement;
      while (parent && parent.id !== 'tree-container') {
        if (parent.classList.contains('tree-children')) {
          parent.classList.remove('hidden');
          const row = parent.previousElementSibling;
          if (row) {
            row.querySelector('.tree-expander')?.classList.add('expanded');
          }
        }
        parent = parent.parentElement;
      }
    } else {
      const hasMatchingChild = node.querySelector(`.tree-node-wrapper[data-name*="${query}"]`);
      node.style.display = hasMatchingChild ? '' : 'none';
    }
  });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
async function init() {
  const refreshWorkspaceUris = async () => {
    const s = getSidecar();
    if (s && typeof s.getWorkspaceUris === 'function') {
      try {
        const uris = await s.getWorkspaceUris();
        if (uris && uris.length > 0 && uris[0] !== currentWorkspaceUri) {
          currentWorkspaceUri = uris[0];
          await fetchApi('/api/workspace', {
            method: 'POST',
            body: { workspaceUri: currentWorkspaceUri }
          });
          loadRootTree();
        }
      } catch (e) {
        console.warn('Could not refresh workspace uris:', e);
      }
    }
  };

  const s = getSidecar();
  if (s && typeof s.getWorkspaceUris === 'function') {
    try {
      const uris = await s.getWorkspaceUris();
      if (uris && uris.length > 0) {
        currentWorkspaceUri = uris[0];
        await fetchApi('/api/workspace', {
          method: 'POST',
          body: { workspaceUri: currentWorkspaceUri }
        });
      }
    } catch (e) {
      console.warn('Could not retrieve workspace uris:', e);
    }

    if (typeof s.onWorkspaceChange === 'function') {
      s.onWorkspaceChange(async (newUris) => {
        if (newUris && newUris.length > 0) {
          currentWorkspaceUri = newUris[0];
          await fetchApi('/api/workspace', {
            method: 'POST',
            body: { workspaceUri: currentWorkspaceUri }
          });
          showToast('Workspace switched');
          loadRootTree();
        }
      });
    }
  }

  window.addEventListener('focus', refreshWorkspaceUris);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshWorkspaceUris();
    }
  });
  setTimeout(refreshWorkspaceUris, 150);
  setTimeout(refreshWorkspaceUris, 600);

  $('btn-refresh').addEventListener('click', () => {
    showToast('Refreshing file tree...');
    loadRootTree();
  });

  $('btn-toggle-hidden').addEventListener('click', () => {
    showHiddenFiles = !showHiddenFiles;
    $('btn-toggle-hidden').classList.toggle('active', showHiddenFiles);
    showToast(showHiddenFiles ? 'Showing hidden files' : 'Hiding hidden/ignored files');
    loadRootTree();
  });

  const pathBar = $('path-input-bar');
  $('btn-change-path').addEventListener('click', () => {
    pathBar.hidden = !pathBar.hidden;
    if (!pathBar.hidden) {
      $('manual-path-input').value = currentRootPath || '';
      $('manual-path-input').focus();
    }
  });

  $('btn-cancel-path').addEventListener('click', () => {
    pathBar.hidden = true;
  });

  $('btn-apply-path').addEventListener('click', () => {
    const val = $('manual-path-input').value.trim();
    if (val) {
      currentRootPath = val;
      currentWorkspaceUri = null;
      pathBar.hidden = true;
      showToast(`Set root to: ${val}`);
      loadRootTree();
    }
  });

  $('manual-path-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-apply-path').click();
    if (e.key === 'Escape') $('btn-cancel-path').click();
  });

  $('search-input').addEventListener('input', (e) => handleSearch(e.target.value));
  $('btn-clear-search').addEventListener('click', () => {
    $('search-input').value = '';
    handleSearch('');
  });

  function initResizer() {
    const resizer = $('preview-resizer');
    const drawer = $('preview-drawer');
    if (!resizer || !drawer) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = drawer.offsetHeight;
      resizer.classList.add('resizing');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const dy = startY - e.clientY;
      const minH = 100;
      const maxH = window.innerHeight * 0.85;
      const newHeight = Math.max(minH, Math.min(maxH, startHeight + dy));
      drawer.style.height = `${newHeight}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('resizing');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    });
  }

  $('btn-open-tab')?.addEventListener('click', () => {
    if (activePreviewFile) {
      openFileInNativeTab(activePreviewFile);
    }
  });

  $('btn-close-preview').addEventListener('click', closePreview);

  $('btn-send-agent').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!activePreviewFile) return;

    const textToQuote = currentSelectedText;
    const fileToQuote = activePreviewFile;
    const isQuoting = Boolean(textToQuote);

    if (typeof window.openAskAgentPopover === 'function') {
      window.openAskAgentPopover({
        title: isQuoting ? '💬 提問 Agent (選取文字引用)' : '💬 提問 Agent',
        placeholder: isQuoting
          ? '請輸入想對此段文字/程式碼提出的問題（按 Enter 直接發送，Shift+Enter 換行）...'
          : '請輸入想對此檔案提出的問題（按 Enter 直接發送，Shift+Enter 換行）...',
        onSubmit: async (customMessage) => {
          const bubble = $('selection-quote-bubble');
          if (bubble) bubble.hidden = true;
          currentSelectedText = '';
          window.getSelection()?.removeAllRanges();
          $('btn-send-agent').textContent = '💬 Ask';

          if (isQuoting) {
            await sendSelectionToAgent(fileToQuote, textToQuote, customMessage);
          } else {
            await sendFilePathToAgent(fileToQuote, customMessage);
          }
        }
      });
    } else {
      if (isQuoting) {
        const bubble = $('selection-quote-bubble');
        if (bubble) bubble.hidden = true;
        currentSelectedText = '';
        window.getSelection()?.removeAllRanges();
        $('btn-send-agent').textContent = '💬 Ask';
        sendSelectionToAgent(fileToQuote, textToQuote);
      } else {
        sendFilePathToAgent(fileToQuote);
      }
    }
  });

  $('tree-viewport').addEventListener('click', (e) => {
    if (e.target === $('tree-viewport') || e.target === $('tree-container')) {
      clearSelection();
    }
  });

  initResizer();
  setupTextSelectionQuote();
  loadRootTree();
}

init();
