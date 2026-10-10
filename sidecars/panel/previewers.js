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
// Markdown Parser (Self-contained, Zero Dependency)
// ---------------------------------------------------------------------------
function parseMarkdownToHtml(markdown) {
  if (!markdown) return '';

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Preserve and extract code blocks first
  const codeBlocks = [];
  let html = markdown.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || 'text', code: escapeHtml(code.trimEnd()) });
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

  // Restore Code Blocks
  result = result.replace(/<!--CODE_BLOCK_(\d+)-->/g, (m, idx) => {
    const item = codeBlocks[idx];
    return `<div class="md-code-block"><div class="md-code-lang">${item.lang}</div><pre><code>${item.code}</code></pre></div>`;
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
      const pre = document.createElement('pre');
      pre.className = 'preview-code-block';
      const code = document.createElement('code');
      code.textContent = fileData.content || '';
      pre.appendChild(code);
      container.appendChild(pre);
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
      const pre = document.createElement('pre');
      pre.className = 'preview-code-block';
      const code = document.createElement('code');
      code.textContent = fileData.content || '';
      pre.appendChild(code);
      container.appendChild(pre);
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
// 4. Code & Text Preview Strategy (Standard code view)
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
    const pre = document.createElement('pre');
    pre.className = 'preview-code-block';
    const code = document.createElement('code');
    code.textContent = (fileData.content || '') + (fileData.truncated ? '\n\n[... Truncated due to size limit ...]' : '');
    pre.appendChild(code);
    container.appendChild(pre);
  }

  destroy() {}
}

// ---------------------------------------------------------------------------
// 5. Default Fallback Strategy (For unsupported binary files: PDF, Office, Archives)
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
      desc.innerHTML = 'PDF Document.<br><span style="color:var(--text-muted);font-size:11px;">PDF previewer module will be supported via dedicated converter/renderer.</span>';
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
      // Update drawer icon
      if (strategy.icon && context.setIcon) {
        context.setIcon(strategy.icon);
      }
      // Populate custom toolbar actions
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
previewManager.register(new CodePreviewStrategy(), 50);
previewManager.register(new DefaultBinaryPreviewStrategy(), 0);

window.previewManager = previewManager;
