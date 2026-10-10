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
    return `<!--CODE_BLOCK_${idx}-->`;
  });

  // Extract inline code
  const inlineCodes = [];
  html = html.replace(/`([^`\n]+)`/g, (match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(escapeHtml(code));
    return `<!--INLINE_CODE_${idx}-->`;
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
  result = result.replace(/<!--CODE_BLOCK_(\d+)-->/g, (m, idx) => {
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
  result = result.replace(/<!--INLINE_CODE_(\d+)-->/g, (m, idx) => {
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
class ImagePreviewStrategy {
  constructor() {
    this.id = 'image';
    this.name = 'Image Viewer';
    this.icon = '🖼️';
    this.imgEl = null;
  }

  supports(fileData) {
    if (fileData.isImage) return true;
    const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.avif'];
    return imgExts.includes(fileData.ext);
  }

  render(container, fileData, context) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-image-container';

    this.imgEl = document.createElement('img');
    this.imgEl.alt = fileData.name || 'Image Preview';

    this.imgEl.onload = () => {
      context.setSizeText(`${context.formatSize(fileData.size)} · ${this.imgEl.naturalWidth}×${this.imgEl.naturalHeight}px`);
    };
    this.imgEl.onerror = () => {
      context.setSizeText(`${context.formatSize(fileData.size)} · (Decode error)`);
    };

    this.imgEl.src = fileData.dataUrl || '';
    wrapper.appendChild(this.imgEl);
    container.appendChild(wrapper);
  }

  destroy() {
    if (this.imgEl) {
      this.imgEl.src = '';
      this.imgEl = null;
    }
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
// 6. Default Fallback Strategy (For unsupported binary files: Office, Archives, etc.)
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
      desc.innerHTML = 'Office Document.<br><span style="color:var(--text-muted);font-size:11px;">Office document previewer can be integrated via Office CLI converter.</span>';
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
previewManager.register(new HtmlPreviewStrategy(), 85);
previewManager.register(new PdfPreviewStrategy(), 80);
previewManager.register(new CodePreviewStrategy(), 50);
previewManager.register(new DefaultBinaryPreviewStrategy(), 0);

window.previewManager = previewManager;
