/**
 * Preview Strategy Pattern Framework for Workspace File Tree
 *
 * Each previewer implements:
 * - id: string
 * - name: string
 * - icon: string
 * - supports(fileData): boolean
 * - render(container, fileData, context): void | Promise<void>
 * - destroy(): void
 * - getActions?(fileData, context): HTMLElement[]
 */

// ---------------------------------------------------------------------------
// HTML Entity Escaper
// ---------------------------------------------------------------------------
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Reusable VS Code Style Code Renderer with Gutter & Line Numbers
// ---------------------------------------------------------------------------
function renderCodeWithGutter(rawCode, language, truncated = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'code-viewer-container';

  let highlightedHtml = '';
  if (window.hljs) {
    try {
      if (language && window.hljs.getLanguage(language)) {
        highlightedHtml = window.hljs.highlight(rawCode, { language }).value;
      } else {
        highlightedHtml = window.hljs.highlightAuto(rawCode).value;
      }
    } catch (err) {
      highlightedHtml = escapeHtml(rawCode);
    }
  } else {
    highlightedHtml = escapeHtml(rawCode);
  }

  const lines = highlightedHtml.split('\n');
  const lineNumbers = lines.map((_, idx) => `<span>${idx + 1}</span>`).join('\n');

  wrapper.innerHTML = `
    <div class="code-gutter"><pre>${lineNumbers}</pre></div>
    <div class="code-content"><pre><code class="hljs">${lines.join('\n')}</code></pre></div>
  `;

  if (truncated) {
    const notice = document.createElement('div');
    notice.className = 'code-truncated-notice';
    notice.textContent = '[... Truncated due to size limit ...]';
    wrapper.appendChild(notice);
  }

  return wrapper;
}

// ---------------------------------------------------------------------------
// Markdown Parser (Self-contained, Zero Dependency)
// ---------------------------------------------------------------------------
function parseMarkdownToHtml(markdown) {
  if (!markdown) return '';

  // Preserve and extract code blocks first
  const codeBlocks = [];
  let html = markdown.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({
      lang: lang || 'text',
      rawCode: code.trimEnd(),
      code: escapeHtml(code.trimEnd())
    });
    return `<!--CODEBLOCK${idx}-->`;
  });

  // Extract inline code
  const inlineCodes = [];
  html = html.replace(/`([^`\n]+)`/g, (match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(escapeHtml(code));
    return `<!--INLINECODE${idx}-->`;
  });

  const lines = html.split('\n');
  const output = [];
  let inList = false;
  let inOrderedList = false;
  let inTable = false;
  let tableHeader = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Table rows
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        // Table separator row, ignore
        continue;
      }
      if (!inTable) {
        inTable = true;
        tableHeader = true;
        output.push('<table class="md-table">');
      }
      const tag = tableHeader ? 'th' : 'td';
      output.push('<tr>' + cells.map(c => `<${tag}>${inlineFormatting(c)}</${tag}>`).join('') + '</tr>');
      tableHeader = false;
      continue;
    } else if (inTable) {
      output.push('</table>');
      inTable = false;
    }

    // Unordered lists (- or *)
    const ulMatch = line.match(/^(\s*)([*+-])\s+(.*)$/);
    if (ulMatch) {
      if (!inList) {
        output.push('<ul class="md-list">');
        inList = true;
      }
      let content = ulMatch[3];
      // Task lists
      if (content.startsWith('[ ] ')) {
        content = '<input type="checkbox" disabled /> ' + content.slice(4);
      } else if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
        content = '<input type="checkbox" checked disabled /> ' + content.slice(4);
      }
      output.push(`<li>${inlineFormatting(content)}</li>`);
      continue;
    } else if (inList) {
      output.push('</ul>');
      inList = false;
    }

    // Ordered lists (1. 2.)
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (!inOrderedList) {
        output.push('<ol class="md-ol">');
        inOrderedList = true;
      }
      output.push(`<li>${inlineFormatting(olMatch[3])}</li>`);
      continue;
    } else if (inOrderedList) {
      output.push('</ol>');
      inOrderedList = false;
    }

    // Blank lines
    if (!line.trim()) {
      continue;
    }

    // Horizontal Rule
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      output.push('<hr class="md-hr" />');
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      output.push(`<h1 class="md-h1">${inlineFormatting(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith('## ')) {
      output.push(`<h2 class="md-h2">${inlineFormatting(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('### ')) {
      output.push(`<h3 class="md-h3">${inlineFormatting(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith('#### ')) {
      output.push(`<h4 class="md-h4">${inlineFormatting(line.slice(5))}</h4>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      output.push(`<blockquote class="md-quote">${inlineFormatting(line.slice(2))}</blockquote>`);
      continue;
    }

    // Paragraph
    output.push(`<p class="md-p">${inlineFormatting(line)}</p>`);
  }

  if (inTable) output.push('</table>');
  if (inList) output.push('</ul>');
  if (inOrderedList) output.push('</ol>');

  let result = output.join('\n');

  // Restore Code Blocks with Syntax Highlighting
  result = result.replace(/<!--CODEBLOCK(\d+)-->/g, (m, idx) => {
    const item = codeBlocks[idx];
    let codeHtml = item.code;
    if (window.hljs && item.lang) {
      try {
        if (window.hljs.getLanguage(item.lang)) {
          codeHtml = window.hljs.highlight(item.rawCode, { language: item.lang }).value;
        } else {
          codeHtml = window.hljs.highlightAuto(item.rawCode).value;
        }
      } catch (err) {
        codeHtml = item.code;
      }
    }
    return `<div class="md-code-block"><div class="md-code-lang">${item.lang}</div><pre><code class="hljs">${codeHtml}</code></pre></div>`;
  });

  // Restore Inline Code
  result = result.replace(/<!--INLINECODE(\d+)-->/g, (m, idx) => {
    return `<code class="md-inline-code">${inlineCodes[idx]}</code>`;
  });

  return result;

  function inlineFormatting(text) {
    return text
      // Bold + Italic
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      // Strikethrough
      .replace(/~~(.*?)~~/g, '<del>$1</del>')
      // Links
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');
  }
}

// ---------------------------------------------------------------------------
// 1. Image Preview Strategy
// ---------------------------------------------------------------------------
function drawArrow(ctx, fromX, fromY, toX, toY, color, width) {
  const headLen = Math.max(14, width * 3);
  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

window.openAskAgentPopover = function({
  title = '💬 附帶訊息提問 Agent',
  placeholder = '請輸入想對 AI Agent 說的話（按 Enter 直接發送，Shift+Enter 換行）...',
  hint = 'Enter 發送 · Esc 取消',
  initialValue = '',
  onSubmit,
  onCancel
} = {}) {
  const popover = document.getElementById('annot-send-popover');
  const input = document.getElementById('annot-prompt-input');
  if (!popover || !input) {
    if (typeof onSubmit === 'function') onSubmit('');
    return;
  }

  // Toggle if already visible
  if (!popover.hidden) {
    popover.hidden = true;
    if (window._askAgentPopoverCleanup) {
      window._askAgentPopoverCleanup();
      window._askAgentPopoverCleanup = null;
    }
    return;
  }

  if (window._askAgentPopoverCleanup) {
    window._askAgentPopoverCleanup();
    window._askAgentPopoverCleanup = null;
  }

  const titleEl = popover.querySelector('.popover-title');
  if (titleEl) titleEl.textContent = title;
  const hintEl = popover.querySelector('.popover-hint');
  if (hintEl) hintEl.textContent = hint;

  input.placeholder = placeholder;
  input.value = initialValue;
  popover.hidden = false;
  setTimeout(() => input.focus(), 25);

  const btnSubmit = document.getElementById('btn-popover-submit');
  const btnCancel = document.getElementById('btn-popover-cancel');
  const btnClose = document.getElementById('btn-popover-close');

  const cleanup = () => {
    btnSubmit?.removeEventListener('click', handleSubmit);
    btnCancel?.removeEventListener('click', handleClose);
    btnClose?.removeEventListener('click', handleClose);
    input.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('click', handleOutsideClick);
    window._askAgentPopoverCleanup = null;
  };

  window._askAgentPopoverCleanup = cleanup;

  const handleClose = (e) => {
    if (e) e.preventDefault();
    popover.hidden = true;
    cleanup();
    if (typeof onCancel === 'function') onCancel();
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const customMessage = input.value.trim();
    popover.hidden = true;
    cleanup();
    if (typeof onSubmit === 'function') {
      await onSubmit(customMessage);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleOutsideClick = (e) => {
    if (!popover.contains(e.target)) {
      handleClose();
    }
  };

  btnSubmit?.addEventListener('click', handleSubmit);
  btnCancel?.addEventListener('click', handleClose);
  btnClose?.addEventListener('click', handleClose);
  input.addEventListener('keydown', handleKeyDown);

  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 60);
};

class ImagePreviewStrategy {
  constructor() {
    this.id = 'image';
    this.name = 'Image Viewer';
    this.icon = '🖼️';
    this.imgEl = null;
    this.container = null;
    this.innerWrapper = null;
    this.canvasEl = null;
    this.ctx = null;
    this.toolbarEl = null;
    this.currentTool = 'pen'; // 'pen' | 'rect' | 'arrow'
    this.currentColor = '#ef4444';
    this.currentLineWidth = 4;
    this.history = [];
    this.fileData = null;
    this.context = null;
    this.viewMode = 'fit'; // 'fit' | 'custom'
    this.zoomRatio = 1.0;
    this.resizeObserver = null;
    this.keyHandler = null;
    this.pasteHandler = null;
  }

  supports(fileData) {
    if (fileData.isImage) return true;
    const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.avif'];
    return imgExts.includes(fileData.ext);
  }

  render(container, fileData, context) {
    // Note: Do NOT destroy this.toolbarEl here! getActions() was already called and mounted the toolbar.
    if (this.resizeObserver) {
      try { this.resizeObserver.disconnect(); } catch (_) {}
      this.resizeObserver = null;
    }
    if (this.canvasEl) {
      this.canvasEl.remove();
      this.canvasEl = null;
      this.ctx = null;
    }
    if (this.imgEl) {
      this.imgEl.src = '';
      this.imgEl = null;
    }
    this.history = [];

    this.container = container;
    this.fileData = fileData;
    this.context = context;
    this.viewMode = 'fit';
    this.zoomRatio = 1.0;

    container.classList.add('drawer-body-image-mode');
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'preview-image-container';

    this.innerWrapper = document.createElement('div');
    this.innerWrapper.className = 'preview-image-inner-wrapper';

    this.imgEl = document.createElement('img');
    this.imgEl.alt = fileData.name || 'Image Preview';

    const onLoaded = () => {
      if (!this.imgEl || !this.innerWrapper) return;
      context.setSizeText(`${context.formatSize(fileData.size)} · ${this.imgEl.naturalWidth}×${this.imgEl.naturalHeight}px`);
      this.initCanvas();
      this.updateLayout();

      if (this.resizeObserver) this.resizeObserver.disconnect();
      this.resizeObserver = new ResizeObserver(() => {
        if (this.viewMode === 'fit') {
          this.updateLayout();
        }
      });
      this.resizeObserver.observe(wrapper);
    };

    this.imgEl.onload = onLoaded;
    this.imgEl.onerror = () => {
      context.setSizeText(`${context.formatSize(fileData.size)} · (Decode error)`);
    };

    // 雙擊快速切換 Fit 與 1:1
    wrapper.addEventListener('dblclick', (e) => {
      if (e.target === this.canvasEl || e.target === this.imgEl || e.target === wrapper) {
        if (this.viewMode === 'fit') {
          this.viewMode = 'custom';
          this.zoomRatio = 1.0;
        } else {
          this.viewMode = 'fit';
        }
        this.updateLayout();
      }
    });

    // 滾輪縮放支援 (可按住 Ctrl 或直接滾輪)
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.15 : 0.87;
      this.zoomRatio = Math.max(0.05, Math.min(10.0, this.zoomRatio * delta));
      this.viewMode = 'custom';
      this.updateLayout();
    }, { passive: false });

    this.imgEl.src = fileData.dataUrl || '';
    if (this.imgEl.complete && this.imgEl.naturalWidth > 0) {
      onLoaded();
    }

    this.innerWrapper.appendChild(this.imgEl);
    wrapper.appendChild(this.innerWrapper);
    container.appendChild(wrapper);

    this.setupKeyboardShortcuts();
    this.setupPasteListener();
  }

  updateLayout() {
    if (!this.imgEl || !this.innerWrapper || !this.container) return;
    const nw = this.imgEl.naturalWidth;
    const nh = this.imgEl.naturalHeight;
    if (!nw || !nh) return;

    const wrapper = this.innerWrapper.parentElement;
    const availW = (wrapper?.clientWidth || this.container.clientWidth) - 16;
    const availH = (wrapper?.clientHeight || this.container.clientHeight) - 16;
    if (availW <= 0 || availH <= 0) return;

    const btnFit = this.toolbarEl?.querySelector('#btn-zoom-fit');
    const btn100 = this.toolbarEl?.querySelector('#btn-zoom-100');
    const zoomText = this.toolbarEl?.querySelector('#zoom-text');

    if (this.viewMode === 'fit') {
      const fitScale = Math.min(availW / nw, availH / nh);
      this.zoomRatio = fitScale;
      wrapper?.classList.remove('mode-scrollable');

      const dw = Math.max(10, Math.round(nw * fitScale));
      const dh = Math.max(10, Math.round(nh * fitScale));
      this.innerWrapper.style.width = `${dw}px`;
      this.innerWrapper.style.height = `${dh}px`;

      btnFit?.classList.add('active');
      btn100?.classList.remove('active');
      if (zoomText) zoomText.textContent = `Fit (${Math.round(fitScale * 100)}%)`;
    } else {
      wrapper?.classList.add('mode-scrollable');

      const dw = Math.max(10, Math.round(nw * this.zoomRatio));
      const dh = Math.max(10, Math.round(nh * this.zoomRatio));
      this.innerWrapper.style.width = `${dw}px`;
      this.innerWrapper.style.height = `${dh}px`;

      btnFit?.classList.remove('active');
      const is100 = Math.abs(this.zoomRatio - 1.0) < 0.02;
      btn100?.classList.toggle('active', is100);
      if (zoomText) zoomText.textContent = `${Math.round(this.zoomRatio * 100)}%`;
    }
  }

  getActions(fileData, context) {
    // Hide drawer's generic "Ask Agent" button to prevent duplication
    const sendAgentBtn = document.getElementById('btn-send-agent');
    if (sendAgentBtn) sendAgentBtn.hidden = true;

    const backBtnHtml = fileData?.videoSource ? `
      <div class="annot-action-group">
        <button class="annot-action-btn" id="btn-back-to-video" title="返回原始影片播放畫面" style="color:var(--accent-blue);font-weight:600;">🔙 返回影片 (${fileData.videoSource.timeStr})</button>
      </div>
      <div class="annot-divider"></div>
    ` : '';

    // Create Annotation & Zoom Toolbar merged directly into the drawer header bar
    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'annotation-toolbar';
    this.toolbarEl.innerHTML = `
      ${backBtnHtml}
      <div class="annot-zoom-group">
        <button class="annot-btn active" id="btn-zoom-fit" title="適應視窗大小 (Fit to window)">🔍 適應</button>
        <button class="annot-btn" id="btn-zoom-100" title="原始解析度 100% (1:1 原圖)">1:1</button>
        <button class="annot-btn" id="btn-zoom-out" title="縮小 (滾輪向下)">➖</button>
        <span class="zoom-text" id="zoom-text">Fit</span>
        <button class="annot-btn" id="btn-zoom-in" title="放大 (滾輪向上)">➕</button>
      </div>
      <div class="annot-divider"></div>
      <div class="annot-tool-group">
        <button class="annot-btn active" data-tool="pen" title="畫筆 (Freehand)">✏️</button>
        <button class="annot-btn" data-tool="rect" title="框選 (Box)">🔲</button>
        <button class="annot-btn" data-tool="arrow" title="箭頭 (Arrow)">➡️</button>
      </div>
      <div class="annot-divider"></div>
      <div class="annot-color-group">
        <span class="color-dot active" data-color="#ef4444" style="background:#ef4444;" title="紅色"></span>
        <span class="color-dot" data-color="#eab308" style="background:#eab308;" title="黃色"></span>
        <span class="color-dot" data-color="#22c55e" style="background:#22c55e;" title="綠色"></span>
        <span class="color-dot" data-color="#3b82f6" style="background:#3b82f6;" title="藍色"></span>
        <span class="color-dot" data-color="#ffffff" style="background:#ffffff;" title="白色"></span>
      </div>
      <div class="annot-divider"></div>
      <div class="annot-size-group">
        <button class="size-btn" data-size="2">細</button>
        <button class="size-btn active" data-size="4">中</button>
        <button class="size-btn" data-size="8">粗</button>
      </div>
      <div class="annot-divider"></div>
      <div class="annot-action-group">
        <button class="annot-action-btn" id="btn-annot-undo" title="復原上一筆">↩️ 復原</button>
        <button class="annot-action-btn" id="btn-annot-clear" title="清空所有標註">🗑️ 清空</button>
        <button class="annot-action-btn" id="btn-annot-copy" title="複製標註圖片到剪貼簿，可直接在輸入框按 Ctrl+V 貼上">📋 Ctrl + C, V</button>
        <button class="btn btn-primary" id="btn-annot-send" title="向 Agent 提問 (包含標註圖片)">💬 Ask</button>
      </div>
    `;

    this.setupToolbarListeners();
    return [this.toolbarEl];
  }

  initCanvas() {
    if (!this.imgEl || !this.innerWrapper) return;
    if (this.canvasEl) {
      this.canvasEl.remove();
      this.canvasEl = null;
      this.ctx = null;
    }

    const naturalW = this.imgEl.naturalWidth || this.imgEl.clientWidth || 800;
    const naturalH = this.imgEl.naturalHeight || this.imgEl.clientHeight || 600;

    // Create Annotation Canvas overlay directly over image
    this.canvasEl = document.createElement('canvas');
    this.canvasEl.className = 'annotation-canvas';
    this.canvasEl.width = naturalW;
    this.canvasEl.height = naturalH;
    this.ctx = this.canvasEl.getContext('2d');
    this.history = [];

    this.innerWrapper.appendChild(this.canvasEl);
    this.setupDrawingListeners();
  }

  setupToolbarListeners() {
    if (!this.toolbarEl) return;

    // Zoom controls
    this.toolbarEl.querySelector('#btn-zoom-fit')?.addEventListener('click', () => {
      this.viewMode = 'fit';
      this.updateLayout();
    });

    this.toolbarEl.querySelector('#btn-zoom-100')?.addEventListener('click', () => {
      this.viewMode = 'custom';
      this.zoomRatio = 1.0;
      this.updateLayout();
    });

    this.toolbarEl.querySelector('#btn-zoom-in')?.addEventListener('click', () => {
      this.viewMode = 'custom';
      this.zoomRatio = Math.min(10.0, this.zoomRatio * 1.25);
      this.updateLayout();
    });

    this.toolbarEl.querySelector('#btn-zoom-out')?.addEventListener('click', () => {
      this.viewMode = 'custom';
      this.zoomRatio = Math.max(0.05, this.zoomRatio / 1.25);
      this.updateLayout();
    });

    // Tool selection (scoped to drawing tools only)
    this.toolbarEl.querySelectorAll('.annot-tool-group .annot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.toolbarEl.querySelectorAll('.annot-tool-group .annot-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTool = btn.dataset.tool;
      });
    });

    // Color selection
    this.toolbarEl.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        this.toolbarEl.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        this.currentColor = dot.dataset.color;
      });
    });

    // Size selection
    this.toolbarEl.querySelectorAll('.size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.toolbarEl.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentLineWidth = parseInt(btn.dataset.size, 10);
      });
    });

    // Undo
    this.toolbarEl.querySelector('#btn-annot-undo')?.addEventListener('click', () => {
      this.undo();
    });

    // Clear
    this.toolbarEl.querySelector('#btn-annot-clear')?.addEventListener('click', () => {
      this.saveHistory();
      if (this.canvasEl && this.ctx) {
        this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
      }
    });

    // Copy to Clipboard (Primary action: ready for Ctrl+V in chat prompt)
    this.toolbarEl.querySelector('#btn-annot-copy')?.addEventListener('click', async () => {
      await this.copyAnnotatedImageToClipboard();
    });

    // Send to Chat (Opens popover to enter custom message)
    this.toolbarEl.querySelector('#btn-annot-send')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openSendPopover();
    });

    // Back to Video player
    this.toolbarEl.querySelector('#btn-back-to-video')?.addEventListener('click', async () => {
      if (this.fileData?.videoSource && window.previewManager && this.container && this.context) {
        const original = this.fileData.videoSource.originalFileData;
        original.initialSeekTime = this.fileData.videoSource.currentTime;
        await window.previewManager.render(this.container, original, this.context);
      }
    });
  }

  undo() {
    if (this.history.length > 0) {
      const lastState = this.history.pop();
      if (this.ctx && lastState) {
        this.ctx.putImageData(lastState, 0, 0);
      }
    } else if (this.canvasEl && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    }
  }

  setupKeyboardShortcuts() {
    this.removeKeyboardShortcuts();
    this.keyHandler = async (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
        return;
      }
      const drawer = document.getElementById('preview-drawer');
      if (!drawer || drawer.hidden || !this.imgEl) return;

      // Ctrl+C / Cmd+C: Copy annotated image to clipboard!
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        await this.copyAnnotatedImageToClipboard();
      }
      // Ctrl+Z / Cmd+Z: Undo last drawing stroke
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        this.undo();
      }
      // Ctrl+0: Fit to window
      else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        this.viewMode = 'fit';
        this.updateLayout();
      }
      // Ctrl+1: 1:1 original size
      else if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        this.viewMode = 'custom';
        this.zoomRatio = 1.0;
        this.updateLayout();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  removeKeyboardShortcuts() {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  setupPasteListener() {
    this.removePasteListener();
    this.pasteHandler = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = (loadEvt) => {
              const dataUrl = loadEvt.target.result;
              const fakeData = {
                name: `Pasted_Image_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`,
                path: 'pasted_image.png',
                ext: '.png',
                isImage: true,
                size: file.size,
                dataUrl
              };
              if (window.previewManager) {
                const body = document.getElementById('preview-body');
                const title = document.getElementById('preview-title');
                const drawer = document.getElementById('preview-drawer');
                if (drawer) drawer.hidden = false;
                if (title) title.textContent = fakeData.name;
                const customActions = document.getElementById('preview-custom-actions');
                const context = {
                  actionsHost: customActions,
                  setSizeText: (txt) => { const el = document.getElementById('preview-size'); if (el) el.textContent = txt; },
                  setIcon: (ico) => { const el = document.getElementById('preview-icon'); if (el) el.textContent = ico; },
                  formatSize: (bytes) => (bytes / 1024).toFixed(1) + ' KB'
                };
                window.previewManager.render(body, fakeData, context);
                if (typeof showToast === 'function') {
                  showToast('📋 已貼上剪貼簿圖片，可直接進行標註或按 Ctrl+C / Ask 發送！');
                }
              }
            };
            reader.readAsDataURL(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', this.pasteHandler);
  }

  removePasteListener() {
    if (this.pasteHandler) {
      window.removeEventListener('paste', this.pasteHandler);
      this.pasteHandler = null;
    }
  }

  openSendPopover() {
    if (typeof window.openAskAgentPopover === 'function') {
      window.openAskAgentPopover({
        title: '💬 提問 Agent (標註圖片)',
        placeholder: '請輸入想對 AI Agent 說的話（按 Enter 直接發送，Shift+Enter 換行）...',
        onSubmit: async (customMessage) => {
          await this.sendAnnotatedImageToChat(customMessage);
        }
      });
    } else {
      this.sendAnnotatedImageToChat('');
    }
  }

  saveHistory() {
    if (!this.ctx || !this.canvasEl) return;
    try {
      const snap = this.ctx.getImageData(0, 0, this.canvasEl.width, this.canvasEl.height);
      this.history.push(snap);
      if (this.history.length > 20) this.history.shift();
    } catch (_) {}
  }

  setupDrawingListeners() {
    if (!this.canvasEl) return;
    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    let strokeSnapshot = null;

    const getCanvasCoords = (e) => {
      const rect = this.canvasEl.getBoundingClientRect();
      const scaleX = rect.width > 0 ? (this.canvasEl.width / rect.width) : 1;
      const scaleY = rect.height > 0 ? (this.canvasEl.height / rect.height) : 1;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    this.canvasEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.canvasEl.setPointerCapture(e.pointerId);
      isDrawing = true;
      this.saveHistory();

      const { x, y } = getCanvasCoords(e);
      startX = x;
      startY = y;

      strokeSnapshot = this.ctx.getImageData(0, 0, this.canvasEl.width, this.canvasEl.height);

      if (this.currentTool === 'pen') {
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
      }
    });

    this.canvasEl.addEventListener('pointermove', (e) => {
      if (!isDrawing) return;
      e.preventDefault();
      const { x, y } = getCanvasCoords(e);

      const naturalScale = Math.max(1, this.canvasEl.width / 800);
      const actualWidth = this.currentLineWidth * naturalScale;

      if (this.currentTool === 'pen') {
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = actualWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
      } else if (this.currentTool === 'rect') {
        if (strokeSnapshot) this.ctx.putImageData(strokeSnapshot, 0, 0);
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = actualWidth;
        this.ctx.strokeRect(startX, startY, x - startX, y - startY);
      } else if (this.currentTool === 'arrow') {
        if (strokeSnapshot) this.ctx.putImageData(strokeSnapshot, 0, 0);
        drawArrow(this.ctx, startX, startY, x, y, this.currentColor, actualWidth);
      }
    });

    const finishDrawing = (e) => {
      if (!isDrawing) return;
      isDrawing = false;
      try { this.canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
    };

    this.canvasEl.addEventListener('pointerup', finishDrawing);
    this.canvasEl.addEventListener('pointercancel', finishDrawing);
  }

  async copyAnnotatedImageToClipboard() {
    const copyBtn = this.toolbarEl?.querySelector('#btn-annot-copy');
    if (copyBtn) {
      copyBtn.disabled = true;
      copyBtn.textContent = '⏳ 複製中...';
    }

    try {
      const naturalW = this.imgEl?.naturalWidth || this.canvasEl?.width || 800;
      const naturalH = this.imgEl?.naturalHeight || this.canvasEl?.height || 600;

      const mergedCanvas = document.createElement('canvas');
      mergedCanvas.width = naturalW;
      mergedCanvas.height = naturalH;
      const mergedCtx = mergedCanvas.getContext('2d');

      if (this.imgEl) {
        mergedCtx.drawImage(this.imgEl, 0, 0, naturalW, naturalH);
      }
      if (this.canvasEl) {
        mergedCtx.drawImage(this.canvasEl, 0, 0, naturalW, naturalH);
      }

      const base64 = mergedCanvas.toDataURL('image/png');
      let copied = false;

      // 1. Primary: Browser Clipboard API (Instant, < 10ms, no process startup lag)
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          const blobPromise = new Promise((resolve, reject) => {
            mergedCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/png');
          });
          const item = new ClipboardItem({ 'image/png': blobPromise });
          await navigator.clipboard.write([item]);
          copied = true;

          // Asynchronously save to local disk in background without blocking UI
          const saveApi = typeof fetchApi === 'function' ? fetchApi : (window.fetchApi || null);
          if (saveApi) {
            saveApi('/api/save-annotated-image', {
              method: 'POST',
              body: { base64, originalPath: this.fileData?.path }
            }).catch(() => {});
          }
        } catch (browserErr) {
          console.warn('Browser clipboard.write failed (falling back to native Sidecar):', browserErr);
        }
      }

      // 2. Fallback: Sidecar native Windows OS Clipboard API (via PowerShell)
      if (!copied) {
        let data = null;
        try {
          if (typeof fetchApi === 'function') {
            data = await fetchApi('/api/copy-image-to-clipboard', {
              method: 'POST',
              body: { base64, originalPath: this.fileData?.path }
            });
          } else if (window.fetchApi) {
            data = await window.fetchApi('/api/copy-image-to-clipboard', {
              method: 'POST',
              body: { base64, originalPath: this.fileData?.path }
            });
          } else if (window.sidecar && window.sidecar.fetch) {
            const res = await window.sidecar.fetch('/api/copy-image-to-clipboard', {
              method: 'POST',
              body: JSON.stringify({ base64, originalPath: this.fileData?.path })
            });
            data = await res.json();
          } else {
            const res = await fetch('/api/copy-image-to-clipboard', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base64, originalPath: this.fileData?.path })
            });
            data = await res.json();
          }
          if (data && (data.ok || data.success)) {
            copied = true;
          }
        } catch (err) {
          console.warn('Native clipboard API call failed:', err);
        }
      }

      if (copied) {
        if (typeof showToast === 'function') {
          const toastMsg = this.fileData?.videoSource
            ? `📋 已複製影片 (${this.fileData.videoSource.timeStr}) 標註截圖！請在對話輸入框按 Ctrl+V 貼上`
            : '📋 標註圖片已複製到系統剪貼簿！請在對話輸入框按 Ctrl+V 貼上';
          showToast(toastMsg);
        }
      } else {
        throw new Error('無法寫入系統剪貼簿，請確認系統權限');
      }
    } catch (err) {
      console.error('Failed to copy annotated image:', err);
      if (typeof showToast === 'function') {
        showToast(`複製失敗: ${err.message}`);
      }
    } finally {
      if (copyBtn) {
        copyBtn.disabled = false;
        copyBtn.textContent = '📋 Ctrl + C, V';
      }
    }
  }

  async sendAnnotatedImageToChat(customMessage = '') {
    const sendBtn = this.toolbarEl?.querySelector('#btn-annot-send');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = '⏳ 送出中...';
    }

    try {
      const naturalW = this.imgEl?.naturalWidth || this.canvasEl?.width || 800;
      const naturalH = this.imgEl?.naturalHeight || this.canvasEl?.height || 600;

      const mergedCanvas = document.createElement('canvas');
      mergedCanvas.width = naturalW;
      mergedCanvas.height = naturalH;
      const mergedCtx = mergedCanvas.getContext('2d');

      if (this.imgEl) {
        mergedCtx.drawImage(this.imgEl, 0, 0, naturalW, naturalH);
      }
      if (this.canvasEl) {
        mergedCtx.drawImage(this.canvasEl, 0, 0, naturalW, naturalH);
      }

      const base64 = mergedCanvas.toDataURL('image/png');

      // Save to disk through Sidecar API & copy to Windows OS clipboard
      let data = null;
      try {
        if (typeof fetchApi === 'function') {
          data = await fetchApi('/api/copy-image-to-clipboard', {
            method: 'POST',
            body: { base64, originalPath: this.fileData?.path }
          });
        } else if (window.fetchApi) {
          data = await window.fetchApi('/api/copy-image-to-clipboard', {
            method: 'POST',
            body: { base64, originalPath: this.fileData?.path }
          });
        } else if (window.sidecar && window.sidecar.fetch) {
          const res = await window.sidecar.fetch('/api/copy-image-to-clipboard', {
            method: 'POST',
            body: JSON.stringify({ base64, originalPath: this.fileData?.path })
          });
          data = await res.json();
        } else {
          const res = await fetch('/api/copy-image-to-clipboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, originalPath: this.fileData?.path })
          });
          data = await res.json();
        }
      } catch (err) {
        console.warn('Save annotated image API call error:', err);
      }

      if (data && (data.fullPath || data.name)) {
        const cleanPath = (data.fullPath || '').replace(/\\/g, '/');
        let prompt = '';
        if (this.fileData?.videoSource) {
          const v = this.fileData.videoSource;
          prompt = `Here is the annotated video frame captured from \`${v.originalFileData?.name || this.fileData.name}\` at **${v.timeStr}**:\n\n![Annotated Frame](file:///${cleanPath})\n[📁 開啟標註圖片原檔](file:///${cleanPath})\n`;
        } else {
          prompt = `Here is the annotated image with my markings on \`${this.fileData.name}\`:\n\n![Annotated Image](file:///${cleanPath})\n[📁 開啟標註圖片原檔](file:///${cleanPath})\n`;
        }
        if (customMessage) {
          prompt += `\n**使用者說明 / 提問**：\n${customMessage}\n`;
        }

        const agent = window.sidecar?.agent || (typeof sidecar !== 'undefined' ? sidecar?.agent : null);
        if (agent) {
          await agent.sendMessage(prompt);
        }

        if (typeof showToast === 'function') {
          showToast(customMessage ? '💬 標註圖片與訊息已送至 Agent！' : '💬 標註圖片已送至 Agent！');
        }
        return;
      }

      if (typeof showToast === 'function') {
        showToast('📋 標註圖片已複製到剪貼簿（可直接在輸入框 Ctrl+V 貼上）！');
      }
    } catch (err) {
      console.error('Failed to send annotated image:', err);
      if (typeof showToast === 'function') {
        showToast(`發送失敗: ${err.message}`);
      }
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '💬 Ask';
      }
    }
  }

  destroy() {
    this.removeKeyboardShortcuts();
    this.removePasteListener();

    const popover = document.getElementById('annot-send-popover');
    if (popover) popover.hidden = true;

    const sendAgentBtn = document.getElementById('btn-send-agent');
    if (sendAgentBtn) sendAgentBtn.hidden = false;

    if (this.resizeObserver) {
      try { this.resizeObserver.disconnect(); } catch (_) {}
      this.resizeObserver = null;
    }
    if (this.container) {
      this.container.classList.remove('drawer-body-image-mode');
      this.container = null;
    }

    if (this.toolbarEl) {
      this.toolbarEl.remove();
      this.toolbarEl = null;
    }
    if (this.canvasEl) {
      this.canvasEl.remove();
      this.canvasEl = null;
      this.ctx = null;
    }
    this.history = [];
    if (this.imgEl) {
      this.imgEl.src = '';
      this.imgEl = null;
    }
    this.innerWrapper = null;
  }
}

// ---------------------------------------------------------------------------
// 2. Markdown Preview Strategy (Rendered HTML + Raw Source Switch)
// ---------------------------------------------------------------------------
class MarkdownPreviewStrategy {
  constructor() {
    this.id = 'markdown';
    this.name = 'Markdown Preview';
    this.icon = '📝';
    this.mode = 'rendered'; // 'rendered' | 'raw'
  }

  supports(fileData) {
    return ['.md', '.markdown'].includes(fileData.ext);
  }

  render(container, fileData, context) {
    container.innerHTML = '';
    if (this.mode === 'rendered') {
      const mdDiv = document.createElement('div');
      mdDiv.className = 'preview-markdown-rendered';
      mdDiv.innerHTML = parseMarkdownToHtml(fileData.content || '');
      container.appendChild(mdDiv);
    } else {
      const codeView = renderCodeWithGutter(fileData.content || '', 'markdown', fileData.truncated);
      container.appendChild(codeView);
    }
  }

  getActions(fileData, context) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = this.mode === 'rendered' ? '📝 Raw' : '👁️ Rendered';
    btn.title = 'Toggle between formatted markdown and raw text';
    btn.addEventListener('click', () => {
      this.mode = this.mode === 'rendered' ? 'raw' : 'rendered';
      btn.textContent = this.mode === 'rendered' ? '📝 Raw' : '👁️ Rendered';
      context.reRender();
    });
    return [btn];
  }

  destroy() {}
}

// ---------------------------------------------------------------------------
// 3. HTML Preview Strategy (Sandboxed Web Iframe + Source Switch)
// ---------------------------------------------------------------------------
class HtmlPreviewStrategy {
  constructor() {
    this.id = 'html';
    this.name = 'HTML Viewer';
    this.icon = '🌐';
    this.mode = 'preview'; // 'preview' | 'source'
    this.frame = null;
  }

  supports(fileData) {
    return ['.html', '.htm'].includes(fileData.ext);
  }

  render(container, fileData, context) {
    container.innerHTML = '';
    if (this.mode === 'preview') {
      const frameWrapper = document.createElement('div');
      frameWrapper.className = 'preview-html-container';

      this.frame = document.createElement('iframe');
      this.frame.className = 'preview-html-frame';
      this.frame.sandbox = 'allow-scripts allow-same-origin';
      this.frame.srcdoc = fileData.content || '';
      frameWrapper.appendChild(this.frame);
      container.appendChild(frameWrapper);
    } else {
      const codeView = renderCodeWithGutter(fileData.content || '', 'xml', fileData.truncated);
      container.appendChild(codeView);
    }
  }

  getActions(fileData, context) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = this.mode === 'preview' ? '💻 Code' : '🌐 Preview';
    btn.title = 'Toggle between rendered HTML page and source code';
    btn.addEventListener('click', () => {
      this.mode = this.mode === 'preview' ? 'source' : 'preview';
      btn.textContent = this.mode === 'preview' ? '💻 Code' : '🌐 Preview';
      context.reRender();
    });
    return [btn];
  }

  destroy() {
    if (this.frame) {
      this.frame.srcdoc = '';
      this.frame = null;
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Code & Text Preview Strategy (Colorized with Line Numbers)
// ---------------------------------------------------------------------------
class CodePreviewStrategy {
  constructor() {
    this.id = 'code';
    this.name = 'Code Viewer';
    this.icon = '📄';
  }

  supports(fileData) {
    return !fileData.isBinary && !fileData.isImage;
  }

  render(container, fileData, context) {
    container.innerHTML = '';
    const ext = (fileData.ext || '').replace(/^\./, '').toLowerCase();

    // Mapping common file extensions to Highlight.js languages
    const langMap = {
      'py': 'python',
      'c': 'c',
      'h': 'c',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'hpp': 'cpp',
      'go': 'go',
      'js': 'javascript',
      'mjs': 'javascript',
      'cjs': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'jsx': 'javascript',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'sh': 'bash',
      'bash': 'bash',
      'ps1': 'powershell',
      'rs': 'rust',
      'java': 'java',
      'css': 'css',
      'scss': 'css',
      'less': 'css',
      'html': 'xml',
      'xml': 'xml',
      'svg': 'xml',
      'sql': 'sql',
      'diff': 'diff',
      'ini': 'ini',
      'toml': 'ini'
    };

    const targetLang = langMap[ext];
    const rawCode = fileData.content || '';
    const codeView = renderCodeWithGutter(rawCode, targetLang, fileData.truncated);
    container.appendChild(codeView);
  }

  destroy() {}
}

// ---------------------------------------------------------------------------
// 5. PDF Preview Strategy (Mozilla PDF.js Canvas Rendering with Page & Zoom Controls)
// ---------------------------------------------------------------------------
class PdfPreviewStrategy {
  constructor() {
    this.id = 'pdf';
    this.name = 'PDF Viewer';
    this.icon = '📕';
    this.pdfDoc = null;
    this.currentPage = 1;
    this.scale = 1.0;
    this.renderTask = null;
    this.canvas = null;
    this.context = null;
    this.fileData = null;
    this.pageIndicator = null;
    this.zoomIndicator = null;
    this.btnPrev = null;
    this.btnNext = null;

    if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
    }
  }

  supports(fileData) {
    return fileData.ext === '.pdf' || Boolean(fileData.isPdf);
  }

  async render(container, fileData, context) {
    this.container = container;
    this.fileData = fileData;
    this.context = context;
    container.innerHTML = '';

    if (!fileData.base64) {
      const errCard = document.createElement('div');
      errCard.className = 'preview-fallback-card';
      errCard.innerHTML = `
        <div class="fallback-icon">⚠️</div>
        <div class="fallback-name">${escapeHtml(fileData.name)}</div>
        <div class="fallback-desc">${escapeHtml(fileData.message || 'No PDF data received or file exceeds 25MB limit.')}</div>
      `;
      container.appendChild(errCard);
      return;
    }

    if (!window.pdfjsLib) {
      const errCard = document.createElement('div');
      errCard.className = 'preview-fallback-card';
      errCard.innerHTML = `
        <div class="fallback-icon">⚠️</div>
        <div class="fallback-name">PDF Engine Missing</div>
        <div class="fallback-desc">pdf.min.js library failed to load in the current environment.</div>
      `;
      container.appendChild(errCard);
      return;
    }

    if (!window.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
    }

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-state';
    loadingDiv.textContent = 'Rendering PDF document...';
    container.appendChild(loadingDiv);

    try {
      const binaryString = atob(fileData.base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const loadingTask = window.pdfjsLib.getDocument({ data: bytes });
      this.pdfDoc = await loadingTask.promise;
      this.currentPage = 1;
      this.scale = 1.0;

      container.innerHTML = '';

      const viewerContainer = document.createElement('div');
      viewerContainer.className = 'pdf-viewer-container';

      const canvasWrapper = document.createElement('div');
      canvasWrapper.className = 'pdf-canvas-wrapper';

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'pdf-canvas';
      canvasWrapper.appendChild(this.canvas);
      viewerContainer.appendChild(canvasWrapper);
      container.appendChild(viewerContainer);

      await this.renderCurrentPage();
      this.updateControls();
    } catch (err) {
      console.error('PDF render error:', err);
      container.innerHTML = '';
      const errCard = document.createElement('div');
      errCard.className = 'preview-fallback-card';
      errCard.innerHTML = `
        <div class="fallback-icon">❌</div>
        <div class="fallback-name">PDF Render Failed</div>
        <div class="fallback-desc">${escapeHtml(err.message || String(err))}</div>
      `;
      container.appendChild(errCard);
    }
  }

  async renderCurrentPage() {
    if (!this.pdfDoc || !this.canvas) return;

    if (this.renderTask) {
      try {
        this.renderTask.cancel();
      } catch (_) {}
      this.renderTask = null;
    }

    try {
      const page = await this.pdfDoc.getPage(this.currentPage);
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: this.scale * dpr });

      this.canvas.width = Math.floor(viewport.width);
      this.canvas.height = Math.floor(viewport.height);
      this.canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
      this.canvas.style.height = Math.floor(viewport.height / dpr) + 'px';

      const ctx = this.canvas.getContext('2d');
      this.renderTask = page.render({
        canvasContext: ctx,
        viewport: viewport
      });

      await this.renderTask.promise;
      this.renderTask = null;

      if (this.context && typeof this.context.setSizeText === 'function') {
        this.context.setSizeText(
          `${this.context.formatSize(this.fileData.size)} · Page ${this.currentPage} of ${this.pdfDoc.numPages}`
        );
      }
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') {
        console.warn('Page rendering error:', err);
      }
    }
  }

  updateControls() {
    if (!this.pdfDoc) return;
    const total = this.pdfDoc.numPages;

    if (this.pageIndicator) {
      this.pageIndicator.textContent = `${this.currentPage} / ${total}`;
    }
    if (this.btnPrev) {
      this.btnPrev.disabled = this.currentPage <= 1;
    }
    if (this.btnNext) {
      this.btnNext.disabled = this.currentPage >= total;
    }
    if (this.zoomIndicator) {
      this.zoomIndicator.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }

  getActions(fileData, context) {
    const actions = [];

    // Prev Button
    this.btnPrev = document.createElement('button');
    this.btnPrev.className = 'btn btn-secondary';
    this.btnPrev.textContent = '◀';
    this.btnPrev.title = 'Previous Page';
    this.btnPrev.addEventListener('click', async () => {
      if (this.pdfDoc && this.currentPage > 1) {
        this.currentPage--;
        this.updateControls();
        await this.renderCurrentPage();
      }
    });
    actions.push(this.btnPrev);

    // Page Indicator
    this.pageIndicator = document.createElement('span');
    this.pageIndicator.className = 'pdf-page-indicator';
    this.pageIndicator.textContent = '1 / -';
    actions.push(this.pageIndicator);

    // Next Button
    this.btnNext = document.createElement('button');
    this.btnNext.className = 'btn btn-secondary';
    this.btnNext.textContent = '▶';
    this.btnNext.title = 'Next Page';
    this.btnNext.addEventListener('click', async () => {
      if (this.pdfDoc && this.currentPage < this.pdfDoc.numPages) {
        this.currentPage++;
        this.updateControls();
        await this.renderCurrentPage();
      }
    });
    actions.push(this.btnNext);

    // Zoom Out Button
    const btnZoomOut = document.createElement('button');
    btnZoomOut.className = 'btn btn-secondary';
    btnZoomOut.textContent = '−';
    btnZoomOut.title = 'Zoom Out';
    btnZoomOut.addEventListener('click', async () => {
      if (this.scale > 0.5) {
        this.scale = Math.max(0.5, Math.round((this.scale - 0.25) * 100) / 100);
        this.updateControls();
        await this.renderCurrentPage();
      }
    });
    actions.push(btnZoomOut);

    // Zoom Level Button / Reset to 100%
    this.zoomIndicator = document.createElement('button');
    this.zoomIndicator.className = 'btn btn-secondary';
    this.zoomIndicator.textContent = '100%';
    this.zoomIndicator.title = 'Reset Zoom to 100%';
    this.zoomIndicator.addEventListener('click', async () => {
      this.scale = 1.0;
      this.updateControls();
      await this.renderCurrentPage();
    });
    actions.push(this.zoomIndicator);

    // Zoom In Button
    const btnZoomIn = document.createElement('button');
    btnZoomIn.className = 'btn btn-secondary';
    btnZoomIn.textContent = '+';
    btnZoomIn.title = 'Zoom In';
    btnZoomIn.addEventListener('click', async () => {
      if (this.scale < 3.0) {
        this.scale = Math.min(3.0, Math.round((this.scale + 0.25) * 100) / 100);
        this.updateControls();
        await this.renderCurrentPage();
      }
    });
    actions.push(btnZoomIn);

    this.updateControls();
    return actions;
  }

  destroy() {
    if (this.renderTask) {
      try {
        this.renderTask.cancel();
      } catch (_) {}
      this.renderTask = null;
    }
    if (this.pdfDoc) {
      try {
        this.pdfDoc.destroy();
      } catch (_) {}
      this.pdfDoc = null;
    }
    this.canvas = null;
    this.pageIndicator = null;
    this.zoomIndicator = null;
    this.btnPrev = null;
    this.btnNext = null;
  }
}

// ---------------------------------------------------------------------------
// 6. CSV/TSV Interactive Table Strategy (Filtering, Column Sorting, Raw Toggle)
// ---------------------------------------------------------------------------
function parseCsv(text, delimiter = ',') {
  if (!text) return [];
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentField);
      currentField = '';
      if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === '')) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  return rows;
}

class CsvPreviewStrategy {
  constructor() {
    this.id = 'csv';
    this.name = 'Data Table';
    this.icon = '📊';
    this.mode = 'table';
    this.sortCol = -1;
    this.sortAsc = true;
    this.filterQuery = '';
    this.allRows = [];
    this.tbody = null;
    this.metaBadge = null;
  }

  supports(fileData) {
    return ['.csv', '.tsv'].includes(fileData.ext);
  }

  render(container, fileData, context) {
    container.innerHTML = '';

    if (this.mode === 'raw') {
      const codeView = renderCodeWithGutter(fileData.content || '', 'plaintext', fileData.truncated);
      container.appendChild(codeView);
      return;
    }

    const rawContent = fileData.content || '';
    const delimiter = fileData.ext === '.tsv' ? '\t' : ',';
    this.allRows = parseCsv(rawContent, delimiter);

    if (this.allRows.length === 0) {
      container.innerHTML = '<div class="empty-state">Empty CSV/TSV document</div>';
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'preview-csv-container';

    const headerBar = document.createElement('div');
    headerBar.className = 'csv-header-bar';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'csv-search-input';
    searchInput.placeholder = 'Filter rows...';
    searchInput.value = this.filterQuery;
    searchInput.addEventListener('input', (e) => {
      this.filterQuery = e.target.value.toLowerCase().trim();
      this.renderTableBody();
    });

    const metaBadge = document.createElement('span');
    metaBadge.className = 'csv-meta-badge';
    this.metaBadge = metaBadge;

    headerBar.appendChild(searchInput);
    headerBar.appendChild(metaBadge);
    wrapper.appendChild(headerBar);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'csv-table-wrapper';

    const table = document.createElement('table');
    table.className = 'csv-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const headers = this.allRows[0] || [];
    headers.forEach((h, colIdx) => {
      const th = document.createElement('th');
      th.className = 'csv-th';
      th.title = 'Click to sort column';

      const labelSpan = document.createElement('span');
      labelSpan.textContent = h || `Col ${colIdx + 1}`;
      th.appendChild(labelSpan);

      const sortIndicator = document.createElement('span');
      sortIndicator.className = 'csv-sort-icon';
      sortIndicator.textContent = this.sortCol === colIdx ? (this.sortAsc ? ' ▲' : ' ▼') : '';
      th.appendChild(sortIndicator);

      th.addEventListener('click', () => {
        if (this.sortCol === colIdx) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortCol = colIdx;
          this.sortAsc = true;
        }
        this.renderTableBody();
        Array.from(headerRow.children).forEach((node, idx) => {
          const icon = node.querySelector('.csv-sort-icon');
          if (icon) {
            icon.textContent = idx === this.sortCol ? (this.sortAsc ? ' ▲' : ' ▼') : '';
          }
        });
      });

      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    this.tbody = document.createElement('tbody');
    table.appendChild(this.tbody);
    tableWrapper.appendChild(table);
    wrapper.appendChild(tableWrapper);

    container.appendChild(wrapper);
    this.renderTableBody();
  }

  renderTableBody() {
    if (!this.tbody) return;
    this.tbody.innerHTML = '';

    const headers = this.allRows[0] || [];
    let rows = this.allRows.slice(1);

    if (this.filterQuery) {
      rows = rows.filter(r => r.some(cell => String(cell).toLowerCase().includes(this.filterQuery)));
    }

    if (this.sortCol >= 0) {
      const col = this.sortCol;
      rows.sort((a, b) => {
        const valA = a[col] || '';
        const valB = b[col] || '';
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '') {
          return this.sortAsc ? numA - numB : numB - numA;
        }
        return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      });
    }

    if (this.metaBadge) {
      this.metaBadge.textContent = `${rows.length} rows · ${headers.length} cols`;
    }

    const fragment = document.createDocumentFragment();
    rows.slice(0, 1000).forEach((row, rowIdx) => {
      const tr = document.createElement('tr');
      tr.className = rowIdx % 2 === 0 ? 'csv-tr-even' : 'csv-tr-odd';

      headers.forEach((_, colIdx) => {
        const td = document.createElement('td');
        td.className = 'csv-td';
        td.textContent = row[colIdx] !== undefined ? row[colIdx] : '';
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });

    this.tbody.appendChild(fragment);
  }

  getActions(fileData, context) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = this.mode === 'table' ? '📝 Raw' : '📊 Table';
    btn.title = 'Toggle between Data Table and Raw text';
    btn.addEventListener('click', () => {
      this.mode = this.mode === 'table' ? 'raw' : 'table';
      btn.textContent = this.mode === 'table' ? '📝 Raw' : '📊 Table';
      context.reRender();
    });
    return [btn];
  }

  destroy() {
    this.allRows = [];
    this.tbody = null;
    this.metaBadge = null;
  }
}

// ---------------------------------------------------------------------------
// 7. Audio & Video Media Preview Strategy (Native HTML5 Media Players)
// ---------------------------------------------------------------------------
class MediaPreviewStrategy {
  constructor() {
    this.id = 'media';
    this.name = 'Media Player';
    this.icon = '🎵';
    this.mediaEl = null;
    this.container = null;
    this.fileData = null;
    this.context = null;
    this.keyHandler = null;
  }

  supports(fileData) {
    if (fileData.isMedia) return true;
    const mediaExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.mp4', '.webm', '.ogv', '.mov'];
    return mediaExts.includes(fileData.ext);
  }

  getActions(fileData, context) {
    const isVideo = fileData.mediaType === 'video' || ['.mp4', '.webm', '.ogv', '.mov'].includes(fileData.ext);
    if (!isVideo) return [];

    const group = document.createElement('div');
    group.className = 'annot-action-group';

    const btnCapture = document.createElement('button');
    btnCapture.className = 'btn btn-primary';
    btnCapture.id = 'btn-video-capture';
    btnCapture.innerHTML = '📸 擷取畫面 (Capture)';
    btnCapture.title = '擷取當前影格並進入標註與提問模式 (快速鍵: C 或 S)';
    btnCapture.addEventListener('click', () => {
      this.captureFrame();
    });

    group.appendChild(btnCapture);
    return [group];
  }

  async captureFrame() {
    if (!this.mediaEl) return;
    try {
      this.mediaEl.pause();
      const naturalW = this.mediaEl.videoWidth || 1280;
      const naturalH = this.mediaEl.videoHeight || 720;

      const canvas = document.createElement('canvas');
      canvas.width = naturalW;
      canvas.height = naturalH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(this.mediaEl, 0, 0, naturalW, naturalH);
      const frameDataUrl = canvas.toDataURL('image/png');

      const curTime = this.mediaEl.currentTime || 0;
      const mins = Math.floor(curTime / 60);
      const secs = Math.floor(curTime % 60).toString().padStart(2, '0');
      const timeStr = `${mins}:${secs}`;

      const snapshotData = {
        name: `Snapshot_${(this.fileData.name || 'video').replace(/\.[^/.]+$/, '')}_${mins}m${secs}s.png`,
        path: this.fileData.path,
        ext: '.png',
        isImage: true,
        dataUrl: frameDataUrl,
        size: Math.round(frameDataUrl.length * 0.75),
        videoSource: {
          originalFileData: this.fileData,
          currentTime: curTime,
          timeStr: timeStr,
        }
      };

      if (window.previewManager && this.container && this.context) {
        await window.previewManager.render(this.container, snapshotData, this.context);
        if (typeof showToast === 'function') {
          showToast(`📸 已擷取 ${timeStr} 影格畫面！可直接進行畫筆標註或發問`);
        }
      }
    } catch (err) {
      console.error('Frame capture failed:', err);
      if (typeof showToast === 'function') {
        showToast(`擷取影格失敗: ${err.message}`);
      }
    }
  }

  setupKeyboardShortcuts() {
    this.removeKeyboardShortcuts();
    this.keyHandler = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
        return;
      }
      const drawer = document.getElementById('preview-drawer');
      if (!drawer || drawer.hidden || !this.mediaEl) return;

      if (e.key === 'c' || e.key === 'C' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.captureFrame();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  removeKeyboardShortcuts() {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  render(container, fileData, context) {
    this.container = container;
    this.fileData = fileData;
    this.context = context;

    container.innerHTML = '';
    const isVideo = fileData.mediaType === 'video' || ['.mp4', '.webm', '.ogv', '.mov'].includes(fileData.ext);

    if (context && context.setIcon) {
      context.setIcon(isVideo ? '🎬' : '🎵');
    }

    const wrapper = document.createElement('div');
    wrapper.className = isVideo ? 'preview-video-container' : 'preview-audio-container';

    if (isVideo) {
      this.mediaEl = document.createElement('video');
      this.mediaEl.className = 'media-video-player';
      this.mediaEl.controls = true;
      this.mediaEl.autoplay = false;
      this.mediaEl.preload = 'metadata';
      this.mediaEl.src = fileData.mediaUrl || '';

      this.mediaEl.onloadedmetadata = () => {
        const mins = Math.floor(this.mediaEl.duration / 60);
        const secs = Math.floor(this.mediaEl.duration % 60).toString().padStart(2, '0');
        if (context && context.setSizeText) {
          context.setSizeText(`${context.formatSize(fileData.size)} · ${this.mediaEl.videoWidth}×${this.mediaEl.videoHeight} · ${mins}:${secs}`);
        }
        if (typeof fileData.initialSeekTime === 'number' && fileData.initialSeekTime > 0) {
          this.mediaEl.currentTime = fileData.initialSeekTime;
        }
      };

      this.mediaEl.onerror = () => {
        const err = this.mediaEl.error;
        let errMsg = '載入錯誤';
        if (err) {
          switch (err.code) {
            case 1: errMsg = '載入已中止 (MEDIA_ERR_ABORTED)'; break;
            case 2: errMsg = '網路傳輸異常 (MEDIA_ERR_NETWORK)'; break;
            case 3: errMsg = '視訊解碼失敗 (MEDIA_ERR_DECODE)'; break;
            case 4: errMsg = '不支援的媒體格式 (MEDIA_ERR_SRC_NOT_SUPPORTED)'; break;
          }
        }
        const errDiv = document.createElement('div');
        errDiv.className = 'empty-state';
        errDiv.style.cssText = 'color:#f38ba8; padding:12px; font-size:12px; text-align:center;';
        errDiv.innerHTML = `⚠️ ${errMsg}<br><span style="color:#a6adc8; font-size:11px;">若為特殊編碼，可使用上方按鈕透過外部播放器開啟</span>`;
        wrapper.appendChild(errDiv);
      };

      wrapper.appendChild(this.mediaEl);
      this.setupKeyboardShortcuts();
    } else {
      const card = document.createElement('div');
      card.className = 'media-audio-card';

      const iconDiv = document.createElement('div');
      iconDiv.className = 'audio-icon-badge';
      iconDiv.textContent = '🎵';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'audio-title';
      titleDiv.textContent = fileData.name || 'Audio Track';

      const metaDiv = document.createElement('div');
      metaDiv.className = 'audio-meta';
      metaDiv.textContent = `${context.formatSize(fileData.size)} · ${(fileData.ext || '').toUpperCase().replace('.', '')}`;

      this.mediaEl = document.createElement('audio');
      this.mediaEl.className = 'media-audio-player';
      this.mediaEl.controls = true;
      this.mediaEl.autoplay = false;
      this.mediaEl.preload = 'metadata';
      this.mediaEl.src = fileData.mediaUrl || '';

      this.mediaEl.onloadedmetadata = () => {
        const mins = Math.floor(this.mediaEl.duration / 60);
        const secs = Math.floor(this.mediaEl.duration % 60).toString().padStart(2, '0');
        metaDiv.textContent = `${context.formatSize(fileData.size)} · ${mins}:${secs} · ${(fileData.ext || '').toUpperCase().replace('.', '')}`;
      };

      card.appendChild(iconDiv);
      card.appendChild(titleDiv);
      card.appendChild(metaDiv);
      card.appendChild(this.mediaEl);
      wrapper.appendChild(card);
    }

    container.appendChild(wrapper);
  }

  destroy() {
    this.removeKeyboardShortcuts();
    if (this.mediaEl) {
      try {
        this.mediaEl.pause();
        this.mediaEl.src = '';
      } catch (_) {}
      this.mediaEl = null;
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Office Document Preview Strategy (Interactive HTML via officecli)
// ---------------------------------------------------------------------------
class OfficePreviewStrategy {
  constructor() {
    this.id = 'office';
    this.name = 'Office Document';
    this.icon = '📊';
    this.frame = null;
  }

  supports(fileData) {
    if (fileData.isOffice) return true;
    const officeExts = ['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt'];
    return officeExts.includes(fileData.ext);
  }

  render(container, fileData, context) {
    container.innerHTML = '';

    const iconMap = {
      '.docx': '📘',
      '.doc': '📘',
      '.xlsx': '📗',
      '.xls': '📗',
      '.pptx': '📙',
      '.ppt': '📙',
    };
    if (context && context.setIcon) {
      context.setIcon(iconMap[fileData.ext] || '📊');
    }

    if (!fileData.html) {
      const errCard = document.createElement('div');
      errCard.className = 'preview-fallback-card';
      errCard.innerHTML = `
        <div class="fallback-icon">⚠️</div>
        <div class="fallback-name">${escapeHtml(fileData.name)}</div>
        <div class="fallback-desc">${escapeHtml(fileData.message || 'Office preview could not be generated. Ensure officecli is installed.')}</div>
      `;
      container.appendChild(errCard);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'preview-office-container';

    this.frame = document.createElement('iframe');
    this.frame.className = 'preview-office-frame';
    this.frame.sandbox = 'allow-scripts allow-same-origin';
    this.frame.srcdoc = fileData.html;

    wrapper.appendChild(this.frame);
    container.appendChild(wrapper);
  }

  getActions(fileData, context) {
    if (!fileData.html) return [];

    const btnPopout = document.createElement('button');
    btnPopout.className = 'btn btn-secondary';
    btnPopout.textContent = '↗ Open in Tab';
    btnPopout.title = 'Open full interactive document in a new browser tab';
    btnPopout.addEventListener('click', () => {
      const blob = new Blob([fileData.html], { type: 'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    });

    return [btnPopout];
  }

  destroy() {
    if (this.frame) {
      this.frame.srcdoc = '';
      this.frame = null;
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Default Fallback Strategy (For unsupported binary files: Archives, Executables, etc.)
// ---------------------------------------------------------------------------
class DefaultBinaryPreviewStrategy {
  constructor() {
    this.id = 'default-binary';
    this.name = 'Binary File';
    this.icon = '📦';
  }

  supports(fileData) {
    return true; // Catch-all fallback
  }

  render(container, fileData, context) {
    container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'preview-fallback-card';

    const iconSpan = document.createElement('div');
    iconSpan.className = 'fallback-icon';
    iconSpan.textContent = context.getFileIcon(fileData.ext, false);

    const title = document.createElement('div');
    title.className = 'fallback-name';
    title.textContent = fileData.name || 'Unknown File';

    const sizeBadge = document.createElement('div');
    sizeBadge.className = 'fallback-meta';
    sizeBadge.textContent = `${context.formatSize(fileData.size)} · ${fileData.ext || 'Binary'}`;

    const desc = document.createElement('div');
    desc.className = 'fallback-desc';
    if (fileData.ext === '.pdf') {
      desc.innerHTML = 'PDF Document.<br><span style="color:var(--text-muted);font-size:11px;">PDF file exceeds 25MB preview limit.</span>';
    } else if (['.docx', '.xlsx', '.pptx'].includes(fileData.ext)) {
      desc.innerHTML = 'Office Document.<br><span style="color:var(--text-muted);font-size:11px;">Office document converter failed or file exceeds limit.</span>';
    } else {
      desc.innerHTML = 'Binary file.<br><span style="color:var(--text-muted);font-size:11px;">No dedicated preview module registered for this format yet.</span>';
    }

    card.appendChild(iconSpan);
    card.appendChild(title);
    card.appendChild(sizeBadge);
    card.appendChild(desc);
    container.appendChild(card);
  }

  destroy() {}
}

// ---------------------------------------------------------------------------
// Preview Manager (The Strategy Factory & Dispatcher)
// ---------------------------------------------------------------------------
class PreviewManager {
  constructor() {
    this.strategies = [];
    this.activeStrategy = null;
  }

  register(strategy, priority = 0) {
    this.strategies.push({ strategy, priority });
    this.strategies.sort((a, b) => b.priority - a.priority);
  }

  findStrategy(fileData) {
    for (const { strategy } of this.strategies) {
      if (typeof strategy.supports === 'function' && strategy.supports(fileData)) {
        return strategy;
      }
    }
    return null;
  }

  async render(container, fileData, context) {
    this.destroy();

    const strategy = this.findStrategy(fileData);
    this.activeStrategy = strategy;

    if (strategy) {
      if (strategy.icon && context.setIcon) {
        context.setIcon(strategy.icon);
      }
      if (context.actionsHost) {
        context.actionsHost.innerHTML = '';
        if (typeof strategy.getActions === 'function') {
          const actionButtons = strategy.getActions(fileData, context);
          if (Array.isArray(actionButtons)) {
            actionButtons.forEach(btn => context.actionsHost.appendChild(btn));
          }
        }
      }
      await strategy.render(container, fileData, context);
    }
    return strategy;
  }

  destroy() {
    if (this.activeStrategy && typeof this.activeStrategy.destroy === 'function') {
      try {
        this.activeStrategy.destroy();
      } catch (err) {
        console.warn('Error destroying preview strategy:', err);
      }
    }
    this.activeStrategy = null;
  }
}

// Initialize Global PreviewManager and register standard strategies
const previewManager = new PreviewManager();
previewManager.register(new ImagePreviewStrategy(), 100);
previewManager.register(new MarkdownPreviewStrategy(), 90);
previewManager.register(new CsvPreviewStrategy(), 88);
previewManager.register(new HtmlPreviewStrategy(), 85);
previewManager.register(new MediaPreviewStrategy(), 84);
previewManager.register(new OfficePreviewStrategy(), 82);
previewManager.register(new PdfPreviewStrategy(), 80);
previewManager.register(new CodePreviewStrategy(), 50);
previewManager.register(new DefaultBinaryPreviewStrategy(), 0);

window.previewManager = previewManager;
