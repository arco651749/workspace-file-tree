import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { SidecarApp, Response } from 'sidecar_sdk';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const USER_HOME = homedir();

function pipeToCommand(cmd, args, input) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
    });
    child.stdin.end(input, 'utf8');
  });
}

// Convert file:// URI or raw Windows/POSIX path to local filesystem path
function toLocalPath(uriOrPath) {
  if (!uriOrPath) return null;
  const str = String(uriOrPath).trim();
  if (str.startsWith('file://')) {
    try {
      return fileURLToPath(str);
    } catch {
      return str.replace(/^file:\/\/\/?/, '');
    }
  }
  return resolve(str);
}

let activeWorkspaceRoot = null;

function resolveRoot(data) {
  if (data?.workspaceUri) {
    const p = toLocalPath(data.workspaceUri);
    if (p && existsSync(p)) return p;
  }
  if (data?.root) {
    const p = toLocalPath(data.root);
    if (p && existsSync(p)) return p;
  }
  if (activeWorkspaceRoot && existsSync(activeWorkspaceRoot)) {
    return activeWorkspaceRoot;
  }
  const envRoot = process.env.ANTIGRAVITY_WORKSPACE_ROOT || process.env.WORKSPACE_ROOT;
  if (envRoot && existsSync(envRoot)) {
    return resolve(envRoot);
  }
  return process.cwd();
}

const app = new SidecarApp();

const readLocal = (name) => readFileSync(join(HERE, name), 'utf8');
const noCacheResponse = (content, contentType) => new Response(content, {
  contentType,
  headers: {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  }
});

// ---------------------------------------------------------------------------
// Static Page & Resource Routes
// ---------------------------------------------------------------------------
app.page('/', () => noCacheResponse(readLocal('index.html'), 'text/html'));
app.page('/app.js', () => noCacheResponse(readLocal('app.js'), 'application/javascript'));
app.page('/previewers.js', () => noCacheResponse(readLocal('previewers.js'), 'application/javascript'));
app.page('/highlight.min.js', () => readLocal('highlight.min.js'));
app.page('/pele.global.js', () => noCacheResponse(readLocal('pele.global.js'), 'application/javascript'));
app.page('/pdf.min.js', () => readLocal('pdf.min.js'));
app.page('/pdf.worker.min.js', () => readLocal('pdf.worker.min.js'));
app.api('/styles.css', () => new Response(readLocal('styles.css'), { contentType: 'text/css' }), 'GET');

// ---------------------------------------------------------------------------
// APIs
// ---------------------------------------------------------------------------

// 1. Get or set current workspace root
app.api('/api/workspace', (data) => {
  const p = toLocalPath(data?.workspaceUri || data?.uri || data?.path || data?.root);
  if (p && existsSync(p)) {
    activeWorkspaceRoot = p;
  }
  ensureMainDragBridge().catch(() => {});
  const root = resolveRoot(data);
  return {
    root,
    name: basename(root) || root,
  };
});

// Common hidden / noise directories
const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  '.venv',
  '__pycache__',
  '.gemini',
  '.DS_Store',
  'Thumbs.db',
  '.turbo',
  '.next',
  '.nuxt',
  'target',
  'dist',
  'build'
]);

// 2. Read directory tree for workspace
app.api('/api/tree', (data) => {
  if (data?.workspaceUri || data?.root) {
    const p = toLocalPath(data.workspaceUri || data.root);
    if (p && existsSync(p)) {
      activeWorkspaceRoot = p;
    }
  }
  const root = resolveRoot(data);
  const targetDir = data?.dir ? resolve(root, data.dir) : root;
  const showHidden = Boolean(data?.showHidden);

  if (!existsSync(targetDir)) {
    return { error: `Directory not found: ${targetDir}`, items: [], root };
  }

  try {
    const entries = readdirSync(targetDir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      const name = entry.name;
      if (!showHidden && (name.startsWith('.') || IGNORED_NAMES.has(name))) {
        continue;
      }

      const fullPath = join(targetDir, name);
      let size = 0;
      let modified = 0;
      let isDirectory = entry.isDirectory();

      try {
        const st = statSync(fullPath);
        size = st.size;
        modified = st.mtimeMs;
      } catch {
        // Ignored
      }

      items.push({
        name,
        relPath: relative(root, fullPath),
        fullPath,
        isDirectory,
        size,
        modified,
        ext: extname(name).toLowerCase(),
      });
    }

    // Sort: directories first, then alphabetical
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return {
      root,
      name: basename(root) || root,
      dir: relative(root, targetDir),
      items,
    };
  } catch (err) {
    return { error: String(err.message || err), items: [], root };
  }
});

// Supported Image Mime Types
const IMAGE_MIMES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp'
};

// Supported Audio/Video Media Mime Types
const MEDIA_MIMES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime'
};

const OFFICE_EXTS = new Set(['.docx', '.xlsx', '.pptx']);

// 3. Raw Media Streaming Handler (Supports HTTP 206 Partial Content, Range headers, HEAD & Streams)
function handleRawMedia(req, res, url) {
  try {
    const isHead = req.method === 'HEAD';
    if (req.method !== 'GET' && !isHead) {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    const searchParams = url.searchParams;
    const pathParam = searchParams.get('path');
    const rootParam = searchParams.get('root');
    const workspaceUriParam = searchParams.get('workspaceUri');

    const root = resolveRoot({ root: rootParam, workspaceUri: workspaceUriParam });
    if (!pathParam) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing path parameter');
      return;
    }

    const fullPath = resolve(root, pathParam);
    if (!existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Media file not found');
      return;
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Cannot stream directory');
      return;
    }

    const totalSize = stat.size;
    const ext = extname(fullPath).toLowerCase();
    const mime = MEDIA_MIMES[ext] || IMAGE_MIMES[ext] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      // Parse Range header e.g. "bytes=0-1000", "bytes=1000-", "bytes=-500"
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : NaN;
        let end = match[2] ? parseInt(match[2], 10) : NaN;

        if (isNaN(start) && !isNaN(end)) {
          start = totalSize - end;
          end = totalSize - 1;
        } else if (!isNaN(start) && isNaN(end)) {
          end = totalSize - 1;
        }

        if (isNaN(start) || isNaN(end) || start < 0 || start >= totalSize || end < start || end >= totalSize) {
          res.writeHead(416, {
            'Content-Range': `bytes */${totalSize}`,
            'Content-Type': 'text/plain'
          });
          res.end('Requested range not satisfiable');
          return;
        }

        const chunkSize = (end - start) + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': mime,
          'Cache-Control': 'no-cache',
        });

        if (isHead) {
          res.end();
          return;
        }

        const stream = createReadStream(fullPath, { start, end });
        stream.pipe(res);
        req.on('close', () => {
          try { stream.destroy(); } catch (_) {}
        });
        stream.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          res.end();
        });
        return;
      }
    }

    // Full content response (200 OK)
    res.writeHead(200, {
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
    });

    if (isHead) {
      res.end();
      return;
    }

    const stream = createReadStream(fullPath);
    stream.pipe(res);
    req.on('close', () => {
      try { stream.destroy(); } catch (_) {}
    });
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end();
    });
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    res.end(String(err.message || err));
  }
}

// 4. Read preview of a file (Supports Images, Audio, Video, PDF, Office, and Text)
app.api('/api/file-content', async (data) => {
  const root = resolveRoot(data);
  if (!data?.path) return { error: 'No path specified' };
  const fullPath = resolve(root, data.path);

  if (!existsSync(fullPath)) return { error: `File not found: ${fullPath}` };

  try {
    const st = statSync(fullPath);
    if (st.isDirectory()) return { error: 'Cannot preview directory' };

    const ext = extname(fullPath).toLowerCase();
    const mime = IMAGE_MIMES[ext];

    // If it's an image, encode to base64 Data URL (up to 100MB) or provide mediaUrl
    if (mime) {
      const relPath = relative(root, fullPath);
      const mediaUrl = `/api/raw-media?path=${encodeURIComponent(relPath)}&root=${encodeURIComponent(root)}`;
      const maxImgBytes = 100 * 1024 * 1024;
      if (st.size > maxImgBytes) {
        return {
          ext,
          isImage: true,
          mediaUrl,
          size: st.size,
          name: basename(fullPath),
          path: relPath,
          message: 'Image exceeds 100MB dataUrl limit, loading via stream'
        };
      }
      const buffer = readFileSync(fullPath);
      const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
      return {
        ext,
        isImage: true,
        dataUrl,
        mediaUrl,
        size: st.size,
        name: basename(fullPath),
        path: relPath,
      };
    }

    // Audio & Video Media preview
    if (MEDIA_MIMES[ext]) {
      const isVideo = ['.mp4', '.webm', '.ogv', '.mov'].includes(ext);
      const relPath = relative(root, fullPath);
      const mediaUrl = `/api/raw-media?path=${encodeURIComponent(relPath)}&root=${encodeURIComponent(root)}`;
      return {
        ext,
        isMedia: true,
        mediaType: isVideo ? 'video' : 'audio',
        mime: MEDIA_MIMES[ext],
        mediaUrl,
        size: st.size,
        name: basename(fullPath),
        path: relPath,
      };
    }

    // Office Documents (.docx, .xlsx, .pptx via officecli)
    if (OFFICE_EXTS.has(ext)) {
      try {
        const { stdout } = await execFileAsync('officecli', ['view', fullPath, 'html'], {
          maxBuffer: 60 * 1024 * 1024,
          timeout: 25000,
          windowsHide: true,
        });
        return {
          ext,
          isOffice: true,
          html: stdout,
          size: st.size,
          name: basename(fullPath),
          path: relative(root, fullPath),
        };
      } catch (officeErr) {
        return {
          ext,
          isOffice: false,
          isBinary: true,
          size: st.size,
          name: basename(fullPath),
          path: relative(root, fullPath),
          message: `OfficeCLI preview failed: ${officeErr.message}`
        };
      }
    }

    // PDF file preview (up to 25MB)
    if (ext === '.pdf') {
      const maxPdfBytes = 25 * 1024 * 1024;
      if (st.size > maxPdfBytes) {
        return {
          ext: '.pdf',
          isPdf: false,
          isBinary: true,
          size: st.size,
          name: basename(fullPath),
          path: relative(root, fullPath),
          message: 'PDF exceeds 25MB preview limit'
        };
      }
      const buffer = readFileSync(fullPath);
      return {
        ext: '.pdf',
        isPdf: true,
        base64: buffer.toString('base64'),
        size: st.size,
        name: basename(fullPath),
        path: relative(root, fullPath),
      };
    }

    // Text file preview (up to 300KB)
    const maxBytes = 300 * 1024;
    const buffer = readFileSync(fullPath);
    const isBinary = buffer.slice(0, 1024).includes(0);

    if (isBinary) {
      return {
        ext,
        isImage: false,
        isBinary: true,
        size: st.size,
        name: basename(fullPath),
        path: relative(root, fullPath),
      };
    }

    const content = buffer.slice(0, maxBytes).toString('utf8');
    const truncated = buffer.length > maxBytes;

    return {
      ext,
      isImage: false,
      isBinary: false,
      truncated,
      size: st.size,
      name: basename(fullPath),
      path: relative(root, fullPath),
      content,
    };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

// 5. Save annotated image to disk
app.api('/api/save-annotated-image', (data) => {
  const root = resolveRoot(data);
  if (!data?.base64) return { error: 'No image data provided' };

  try {
    const rawData = data.base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(rawData, 'base64');

    const outDir = join(root, '.gemini', 'annotated');
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }

    const timestamp = Date.now();
    const origBase = data.originalPath ? basename(data.originalPath, extname(data.originalPath)) : 'image';
    const fileName = `annotated_${origBase}_${timestamp}.png`;
    const fullPath = join(outDir, fileName);

    writeFileSync(fullPath, buffer);

    return {
      success: true,
      fullPath,
      relPath: relative(root, fullPath),
      name: fileName,
    };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

// 6. Copy annotated image natively to OS clipboard (Windows / macOS / Linux)
app.api('/api/copy-image-to-clipboard', async (data) => {
  const root = resolveRoot(data);
  if (!data?.base64) return { error: 'No image data provided' };

  try {
    const rawData = data.base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(rawData, 'base64');

    const outDir = join(root, '.gemini', 'annotated');
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }

    const timestamp = Date.now();
    const origBase = data.originalPath ? basename(data.originalPath, extname(data.originalPath)) : 'image';
    const fileName = `annotated_${origBase}_${timestamp}.png`;
    const fullPath = join(outDir, fileName);

    writeFileSync(fullPath, buffer);

    if (process.platform === 'darwin') {
      await execFileAsync('/usr/bin/osascript', [
        '-e',
        'on run argv',
        '-e',
        'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)',
        '-e',
        'end run',
        fullPath
      ]);
    } else if (process.platform === 'win32') {
      const normalizedPath = fullPath.replace(/\\/g, '\\\\');
      const psScript = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Drawing.Image]::FromFile('${normalizedPath}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', psScript]);
    } else {
      await execFileAsync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', fullPath]);
    }

    return {
      success: true,
      ok: true,
      fullPath,
      relPath: relative(root, fullPath),
      name: fileName,
    };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

// 7. Copy text snippet natively to OS clipboard (Windows / macOS / Linux)
app.api('/api/copy-text-to-clipboard', async (data) => {
  if (!data?.text) return { error: 'No text provided' };
  try {
    if (process.platform === 'darwin') {
      await pipeToCommand('/usr/bin/pbcopy', [], data.text);
    } else if (process.platform === 'win32') {
      const encoded = Buffer.from(data.text, 'utf8').toString('base64');
      const psScript = `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}')) | Set-Clipboard`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
    } else {
      try {
        await pipeToCommand('wl-copy', [], data.text);
      } catch {
        await pipeToCommand('xclip', ['-selection', 'clipboard'], data.text);
      }
    }
    return { success: true, ok: true };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

// 8. Open file directly in Antigravity's native preview tab via CDP
function getDevToolsPort() {
  const envPort = parseInt(process.env.AG_CDP_PORT || '', 10);
  if (envPort > 0 && envPort < 65536) return envPort;

  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push(join(USER_HOME, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));
  } else if (process.platform === 'win32') {
    if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort'));
    if (process.env.USERPROFILE) candidates.push(join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort'));
  } else {
    if (process.env.XDG_CONFIG_HOME) candidates.push(join(process.env.XDG_CONFIG_HOME, 'Antigravity', 'DevToolsActivePort'));
    candidates.push(join(USER_HOME, '.config', 'Antigravity', 'DevToolsActivePort'));
  }

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf8');
        const firstLine = content.split(/\r?\n/)[0].trim();
        const port = parseInt(firstLine, 10);
        if (port > 0 && port < 65536) return port;
      } catch (err) {
        console.warn('Failed to read DevToolsActivePort from', p, err);
      }
    }
  }
  return 52369; // Fallback default
}

async function openNativeTab(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileUri = normalizedPath.startsWith('file:///') ? normalizedPath : `file:///${normalizedPath.replace(/^\/+/, '')}`;
  const port = getDevToolsPort();

  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  const list = await listRes.json();
  const pageTarget =
    list.find(t => t.type === 'page' && t.webSocketDebuggerUrl && /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(t.url || '') && /Antigravity/i.test(t.title || '')) ||
    list.find(t => t.type === 'page' && t.webSocketDebuggerUrl && /^https:\/\/(127\.0\.0\.1|localhost)/i.test(t.url || '')) ||
    list.find(t => t.type === 'page' && t.webSocketDebuggerUrl && !(t.url || '').startsWith('data:'));
  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    throw new Error('Antigravity main window target not found in DevTools list');
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('WebSocket connection timed out'));
    }, 4000);

    ws.onopen = () => {
      const expr = `(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const el = all.find(e => Object.keys(e).some(k => k.startsWith('__reactFiber$')));
        let openUri = null;
        if (el) {
          const k = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
          let root = el[k];
          while (root.return) root = root.return;
          function search(node) {
            if (!node || openUri) return;
            if (node.memoizedProps && typeof node.memoizedProps.openUri === 'function') {
              openUri = node.memoizedProps.openUri;
              return;
            }
            let child = node.child;
            while (child) {
              search(child);
              child = child.sibling;
            }
          }
          search(root);
        }

        const target = ${JSON.stringify(fileUri)};
        if (openUri) {
          openUri(target);
          return { success: true, method: 'openUri', target };
        }

        // Fallback: router query param
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('tab', 'file__' + encodeURIComponent(target));
          window.history.pushState({}, '', url.toString());
          window.dispatchEvent(new PopStateEvent('popstate'));
          return { success: true, method: 'pushState', target };
        } catch (e) {
          return { error: 'Both openUri and pushState failed: ' + e.message };
        }
      })()`;

      ws.send(JSON.stringify({
        id: 101,
        method: 'Runtime.evaluate',
        params: { expression: expr, returnByValue: true }
      }));
    };

    ws.onmessage = (event) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(event.data);
        const val = data.result?.result?.value;
        resolve(val);
      } catch (err) {
        reject(err);
      } finally {
        try { ws.close(); } catch {}
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });
}

app.api('/api/open-native-tab', async (data) => {
  const root = resolveRoot(data);
  const targetPath = data?.fullPath || (data?.path ? resolve(root, data.path) : null);
  if (!targetPath) return { error: 'No file path provided' };

  try {
    const result = await openNativeTab(targetPath);
    return {
      success: true,
      result,
      fullPath: targetPath,
      name: basename(targetPath)
    };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

// 8b. Inject Parent-Frame Drag Bridge into Antigravity 2.25 main window via CDP
// Bypasses Chromium's cross-scheme OOPIF (plugin:// -> https://127.0.0.1) HTML5 drag block
const MAIN_DRAG_BRIDGE_SCRIPT = `(() => {
  if (window.__wftDragBridgeInstalled === '1.2.6') {
    return { status: 'already_installed' };
  }
  if (window.__wftDragBridgeCleanup) {
    try { window.__wftDragBridgeCleanup(); } catch {}
  }

  let activeDrag = null;

  function buildDataTransfer(uris, plainPaths) {
    const dt = new DataTransfer();
    const uriJson = JSON.stringify(uris);
    const uriList = uris.join('\\r\\n');
    try { dt.setData('ResourceURLs', uriJson); } catch {}
    try { dt.setData('resourceurls', uriJson); } catch {}
    try { dt.setData('CodeEditors', uriJson); } catch {}
    try { dt.setData('application/vnd.code.uri-list', uriList); } catch {}
    try { dt.setData('text/uri-list', uriList); } catch {}
    try { dt.setData('text/plain', (plainPaths && plainPaths.length ? plainPaths : uris).join('\\n')); } catch {}
    return dt;
  }

  function endActiveDrag(commitDrop, clientX, clientY, shiftKey) {
    if (!activeDrag) return;
    const state = activeDrag;
    activeDrag = null;

    for (const f of state.iframes) {
      f.style.pointerEvents = state.prevPointerEvents.get(f) || '';
    }
    if (state.badge && state.badge.parentNode) {
      state.badge.parentNode.removeChild(state.badge);
    }
    document.body.style.cursor = '';

    const dt = buildDataTransfer(state.uris, state.plainPaths);

    let insideSourceIframe = false;
    if (state.sourceIframe) {
      const r = state.sourceIframe.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        insideSourceIframe = true;
      }
    }

    if (commitDrop && !insideSourceIframe) {
      const target = document.elementFromPoint(clientX, clientY) || window;
      const dropEv = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        shiftKey: Boolean(shiftKey),
        dataTransfer: dt
      });
      target.dispatchEvent(dropEv);
    } else {
      const leaveEv = new DragEvent('dragleave', {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0,
        relatedTarget: null,
        dataTransfer: dt
      });
      window.dispatchEvent(leaveEv);
    }

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
  }

  function updateDragPosition(clientX, clientY, shiftKey) {
    if (!activeDrag) return;
    const { badge, uris, plainPaths, sourceIframe } = activeDrag;
    if (badge) {
      badge.style.display = 'flex';
      badge.style.left = (clientX + 14) + 'px';
      badge.style.top = (clientY + 14) + 'px';
    }

    let insideSourceIframe = false;
    if (sourceIframe) {
      const r = sourceIframe.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        insideSourceIframe = true;
      }
    }

    const dt = buildDataTransfer(uris, plainPaths);
    if (!insideSourceIframe) {
      if (!activeDrag.enteredChat) {
        activeDrag.enteredChat = true;
        window.dispatchEvent(new DragEvent('dragenter', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          shiftKey: Boolean(shiftKey),
          dataTransfer: dt
        }));
      }
      const target = document.elementFromPoint(clientX, clientY) || window;
      target.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        shiftKey: Boolean(shiftKey),
        dataTransfer: dt
      }));
    } else if (activeDrag.enteredChat) {
      activeDrag.enteredChat = false;
      window.dispatchEvent(new DragEvent('dragleave', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        relatedTarget: null,
        dataTransfer: dt
      }));
    }
  }

  function onWindowMouseMove(e) {
    if (!activeDrag) return;
    if ((e.buttons & 1) === 0) {
      endActiveDrag(true, e.clientX, e.clientY, e.shiftKey);
      return;
    }
    updateDragPosition(e.clientX, e.clientY, e.shiftKey);
  }

  function onWindowMouseUp(e) {
    if (!activeDrag) return;
    endActiveDrag(true, e.clientX, e.clientY, e.shiftKey);
  }

  function onWindowKeyDown(e) {
    if (!activeDrag) return;
    if (e.key === 'Escape') {
      endActiveDrag(false, 0, 0, false);
    }
  }

  function onMessage(e) {
    const data = e.data;
    if (!data || typeof data.type !== 'string') return;

    if (data.type === 'WFT_DRAG_START') {
      if (activeDrag) {
        endActiveDrag(false, 0, 0, false);
      }

      const iframes = Array.from(document.querySelectorAll('iframe'));
      const sourceIframe = iframes.find(f => f.contentWindow === e.source) ||
        iframes.find(f => (f.src || '').includes('workspace-file-tree')) || null;

      const prevPointerEvents = new Map();
      for (const f of iframes) {
        prevPointerEvents.set(f, f.style.pointerEvents || '');
        f.style.pointerEvents = 'none';
      }

      const badge = document.createElement('div');
      badge.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'pointer-events:none',
        'display:none',
        'align-items:center',
        'gap:6px',
        'padding:5px 10px',
        'border-radius:6px',
        'background:rgba(24,24,27,0.95)',
        'color:#f4f4f5',
        'border:1px solid rgba(99,102,241,0.85)',
        'box-shadow:0 8px 20px rgba(0,0,0,0.45)',
        'font-family:system-ui,-apple-system,sans-serif',
        'font-size:12px',
        'font-weight:500',
        'white-space:nowrap'
      ].join(';');
      badge.textContent = data.label || '?? File';

      let initX = 0;
      let initY = 0;
      if (sourceIframe && typeof data.clientX === 'number' && typeof data.clientY === 'number') {
        const r = sourceIframe.getBoundingClientRect();
        initX = r.left + data.clientX;
        initY = r.top + data.clientY;
        badge.style.display = 'flex';
        badge.style.left = (initX + 14) + 'px';
        badge.style.top = (initY + 14) + 'px';
      }
      document.body.appendChild(badge);
      document.body.style.cursor = 'copy';

      activeDrag = {
        uris: data.uris || [],
        plainPaths: data.plainPaths || [],
        iframes,
        sourceIframe,
        prevPointerEvents,
        badge,
        enteredChat: false
      };
    } else if (data.type === 'WFT_DRAG_MOVE' && activeDrag) {
      const r = activeDrag.sourceIframe ? activeDrag.sourceIframe.getBoundingClientRect() : { left: 0, top: 0 };
      updateDragPosition(r.left + (data.clientX || 0), r.top + (data.clientY || 0), data.shiftKey);
    } else if (data.type === 'WFT_DRAG_END' && activeDrag) {
      const r = activeDrag.sourceIframe ? activeDrag.sourceIframe.getBoundingClientRect() : { left: 0, top: 0 };
      endActiveDrag(true, r.left + (data.clientX || 0), r.top + (data.clientY || 0), data.shiftKey);
    } else if (data.type === 'WFT_INSERT_TO_CHAT') {
      const dt = buildDataTransfer(data.uris || [], data.plainPaths || []);
      const target =
        document.querySelector('[aria-label="Message input"][contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea') ||
        window;
      let cx = 0;
      let cy = 0;
      if (target && typeof target.getBoundingClientRect === 'function') {
        const rect = target.getBoundingClientRect();
        cx = rect.left + rect.width / 2;
        cy = rect.top + rect.height / 2;
      }
      window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt }));
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    }
  }

  // Multi-image preview gallery switcher (Left/Right buttons + ArrowLeft/ArrowRight)
  // Works for uploaded chat images opened in either fullscreen lightbox modals or native image tabs.
  const galHost = document.createElement('div');
  galHost.id = 'wft-image-gallery-host';
  galHost.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483645;';
  const galShadow = galHost.attachShadow({ mode: 'open' });
  const galStyle = document.createElement('style');
  galStyle.textContent = [
    '.gal-btn{position:fixed;pointer-events:auto;width:40px;height:40px;border-radius:999px;border:1px solid rgba(255,255,255,0.22);background:rgba(20,22,30,0.72);color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(10px);box-shadow:0 6px 20px rgba(0,0,0,0.35);transition:transform 0.14s ease,background 0.14s ease;padding:0;}',
    '.gal-btn:hover{background:rgba(30,34,46,0.92);transform:translateY(-50%) scale(1.07);}',
    '.gal-btn:active{transform:translateY(-50%) scale(0.96);}',
    '.gal-btn svg{width:20px;height:20px;display:block;}',
    '.gal-btn[hidden],.gal-pill[hidden]{display:none!important;}',
    '.gal-pill{position:fixed;pointer-events:auto;transform:translateX(-50%);padding:5px 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:rgba(20,22,30,0.76);color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;font-weight:500;backdrop-filter:blur(10px);box-shadow:0 6px 18px rgba(0,0,0,0.32);white-space:nowrap;user-select:none;}'
  ].join('');
  galShadow.appendChild(galStyle);

  const galPrevBtn = document.createElement('button');
  galPrevBtn.type = 'button';
  galPrevBtn.className = 'gal-btn';
  galPrevBtn.title = 'Previous Image (←)';
  galPrevBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 4.5L7 10l5.5 5.5"/></svg>';
  galPrevBtn.hidden = true;
  galShadow.appendChild(galPrevBtn);

  const galNextBtn = document.createElement('button');
  galNextBtn.type = 'button';
  galNextBtn.className = 'gal-btn';
  galNextBtn.title = 'Next Image (→)';
  galNextBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.5L13 10l-5.5 5.5"/></svg>';
  galNextBtn.hidden = true;
  galShadow.appendChild(galNextBtn);

  const galPillEl = document.createElement('div');
  galPillEl.className = 'gal-pill';
  galPillEl.hidden = true;
  galShadow.appendChild(galPillEl);

  document.documentElement.appendChild(galHost);

  let galleryState = { items: [], index: -1, container: null, clickedAt: 0 };
  let activePreviewCtx = null;
  let isProgrammaticSwitch = false;

  function isOverlayAncestor(el) {
    let cur = el;
    for (let i = 0; i < 12 && cur && cur !== document.body && cur !== document.documentElement; i++) {
      try {
        const role = cur.getAttribute && cur.getAttribute('role');
        const modal = cur.getAttribute && cur.getAttribute('aria-modal');
        if (role === 'dialog' || modal === 'true') return cur;
        const st = getComputedStyle(cur);
        if (st.position === 'fixed') {
          const r = cur.getBoundingClientRect();
          if (r.width >= window.innerWidth * 0.45 && r.height >= window.innerHeight * 0.45) return cur;
        }
      } catch {}
      cur = cur.parentElement;
    }
    return null;
  }

  function isContentImage(img) {
    if (!img || img.tagName !== 'IMG' || !img.isConnected) return false;
    if (galHost.contains(img)) return false;
    const src = img.currentSrc || img.src || '';
    if (!src || src.startsWith('data:image/svg+xml')) return false;
    if (img.closest('header, nav')) return false;
    const r = img.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) return false;
    if (img.complete && img.naturalWidth > 0 && img.naturalWidth < 32 && img.naturalHeight < 32) return false;
    return true;
  }

  function collectSiblingImages(clickedImg) {
    let el = clickedImg.parentElement;
    for (let depth = 0; depth < 7 && el && el !== document.body && el !== document.documentElement; depth++) {
      const r = el.getBoundingClientRect();
      if (r.height > window.innerHeight * 0.92 && el.querySelectorAll('img').length > 24) break;
      const imgs = Array.from(el.querySelectorAll('img')).filter((im) => isContentImage(im) && !isOverlayAncestor(im));
      const dedup = [];
      const seen = new Set();
      for (const im of imgs) {
        const ir = im.getBoundingClientRect();
        const key = (im.currentSrc || im.src || '') + '|' + Math.round(ir.top) + '|' + Math.round(ir.left);
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push({
          img: im,
          clickTarget: im.closest('button, a, [role="button"]') || im,
          src: im.currentSrc || im.src || ''
        });
      }
      if (dedup.length >= 2) {
        const idx = dedup.findIndex((it) => it.img === clickedImg);
        if (idx >= 0) return { items: dedup, index: idx, container: el };
      }
      el = el.parentElement;
    }
    return null;
  }

  function hideGalleryControls() {
    galPrevBtn.hidden = true;
    galNextBtn.hidden = true;
    galPillEl.hidden = true;
    activePreviewCtx = null;
  }

  function findActiveImagePreview() {
    if (!galleryState.items || galleryState.items.length < 2) return null;
    const thumbImgs = new Set(galleryState.items.map((it) => it.img));
    const thumbSrcs = new Set(galleryState.items.map((it) => it.src).filter(Boolean));
    const allImgs = Array.from(document.querySelectorAll('img'));

    let bestModal = null;
    let bestModalArea = 0;
    for (const im of allImgs) {
      if (galHost.contains(im) || thumbImgs.has(im)) continue;
      const overlay = isOverlayAncestor(im);
      if (!overlay) continue;
      const r = im.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) continue;
      const area = r.width * r.height;
      if (area > bestModalArea) {
        bestModalArea = area;
        bestModal = { mode: 'modal', previewImg: im, overlay, bounds: overlay.getBoundingClientRect() };
      }
    }
    if (bestModal) return bestModal;

    let bestTab = null;
    let bestTabArea = 0;
    for (const im of allImgs) {
      if (galHost.contains(im) || thumbImgs.has(im)) continue;
      if (galleryState.container && galleryState.container.contains(im)) continue;
      const r = im.getBoundingClientRect();
      if (r.width < 160 || r.height < 110) continue;
      const src = im.currentSrc || im.src || '';
      const srcMatches = thumbSrcs.has(src);
      const recentClick = Date.now() - galleryState.clickedAt < 15000;
      if (!srcMatches && !recentClick) continue;
      const area = r.width * r.height;
      if (area > bestTabArea) {
        bestTabArea = area;
        const pane = im.closest('[class*="pane"], [class*="panel"], [class*="viewer"], [class*="preview"], section, main') || im.parentElement;
        bestTab = { mode: 'tab', previewImg: im, overlay: pane, bounds: (pane || im).getBoundingClientRect() };
      }
    }
    return bestTab;
  }

  function syncImageGalleryControls() {
    if (!galleryState.items || galleryState.items.length < 2) {
      hideGalleryControls();
      return;
    }
    if (galleryState.items.every((it) => !it.img.isConnected) && !activePreviewCtx) {
      galleryState = { items: [], index: -1, container: null, clickedAt: 0 };
      hideGalleryControls();
      return;
    }
    const found = findActiveImagePreview();
    if (!found) {
      hideGalleryControls();
      return;
    }
    activePreviewCtx = found;

    const curSrc = found.previewImg.currentSrc || found.previewImg.src || '';
    if (curSrc) {
      const matchedIdx = galleryState.items.findIndex((it) => it.src === curSrc);
      if (matchedIdx >= 0) galleryState.index = matchedIdx;
    }

    const b = found.bounds;
    const leftEdge = Math.max(12, Math.min(window.innerWidth - 60, b.left + 16));
    const rightEdge = Math.max(60, Math.min(window.innerWidth - 52, b.right - 56));
    const midY = Math.max(64, Math.min(window.innerHeight - 64, b.top + b.height / 2));
    const centerX = Math.max(80, Math.min(window.innerWidth - 80, b.left + b.width / 2));
    const bottomY = Math.max(80, Math.min(window.innerHeight - 44, b.bottom - 42));

    galPrevBtn.style.left = leftEdge + 'px';
    galPrevBtn.style.top = midY + 'px';
    galPrevBtn.style.transform = 'translateY(-50%)';
    galNextBtn.style.left = rightEdge + 'px';
    galNextBtn.style.top = midY + 'px';
    galNextBtn.style.transform = 'translateY(-50%)';
    galPillEl.style.left = centerX + 'px';
    galPillEl.style.top = bottomY + 'px';
    galPillEl.textContent = (galleryState.index + 1) + ' / ' + galleryState.items.length + '  ·  ← →';

    galPrevBtn.hidden = false;
    galNextBtn.hidden = false;
    galPillEl.hidden = false;
  }

  function closeModalAndClickTarget(overlay, targetItem) {
    isProgrammaticSwitch = true;
    let closed = false;
    try {
      const closeBtn = overlay && overlay.querySelector('button[aria-label*="Close" i], button[aria-label*="关闭"], button[aria-label*="關閉"], button[title*="Close" i]');
      if (closeBtn) {
        closeBtn.click();
        closed = true;
      }
    } catch {}
    if (!closed) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    }
    setTimeout(() => {
      try {
        if (targetItem.clickTarget && targetItem.clickTarget.isConnected) targetItem.clickTarget.click();
      } finally {
        setTimeout(() => {
          isProgrammaticSwitch = false;
          syncImageGalleryControls();
        }, 120);
      }
    }, 60);
  }

  function navigateGallery(delta) {
    if (!activePreviewCtx || !galleryState.items || galleryState.items.length < 2) return;
    const total = galleryState.items.length;
    const prevIdx = galleryState.index;
    const nextIdx = (prevIdx + delta + total) % total;
    const prevItem = galleryState.items[prevIdx];
    const nextItem = galleryState.items[nextIdx];
    galleryState.index = nextIdx;
    galPillEl.textContent = (nextIdx + 1) + ' / ' + total + '  ·  ← →';

    if (activePreviewCtx.mode === 'tab' && nextItem.clickTarget && nextItem.clickTarget.isConnected) {
      isProgrammaticSwitch = true;
      try { nextItem.clickTarget.click(); } finally {
        setTimeout(() => {
          isProgrammaticSwitch = false;
          syncImageGalleryControls();
        }, 120);
      }
      return;
    }

    const liveImg = activePreviewCtx.previewImg;
    const curLiveSrc = liveImg?.currentSrc || liveImg?.src || '';
    const sameSrcPattern = Boolean(nextItem.src && (!prevItem?.src || curLiveSrc === prevItem.src || curLiveSrc.startsWith('data:') || curLiveSrc.startsWith('blob:')));
    if (liveImg && liveImg.isConnected && sameSrcPattern) {
      liveImg.removeAttribute('srcset');
      liveImg.src = nextItem.src;
      setTimeout(() => {
        if (liveImg.isConnected && (liveImg.currentSrc || liveImg.src) !== nextItem.src) {
          closeModalAndClickTarget(activePreviewCtx?.overlay, nextItem);
        } else {
          syncImageGalleryControls();
        }
      }, 90);
      return;
    }
    closeModalAndClickTarget(activePreviewCtx.overlay, nextItem);
  }

  galPrevBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); navigateGallery(-1); });
  galNextBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); navigateGallery(1); });
  galPillEl.addEventListener('click', (e) => { e.stopPropagation(); });

  function onGalleryClick(e) {
    if (isProgrammaticSwitch) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.includes(galHost)) return;
    let clickedImg = e.target && e.target.tagName === 'IMG' ? e.target : null;
    if (!clickedImg && e.target && e.target.closest) {
      const btn = e.target.closest('button, a, [role="button"]');
      if (btn) {
        const r = btn.getBoundingClientRect();
        if (r.width <= 360 && r.height <= 360) clickedImg = btn.querySelector('img');
      }
    }
    if (!clickedImg || !isContentImage(clickedImg) || isOverlayAncestor(clickedImg)) {
      setTimeout(() => { try { syncImageGalleryControls(); } catch {} }, 120);
      return;
    }
    const group = collectSiblingImages(clickedImg);
    if (group && group.items.length >= 2) {
      galleryState = { ...group, clickedAt: Date.now() };
      setTimeout(() => { try { syncImageGalleryControls(); } catch {} }, 80);
      setTimeout(() => { try { syncImageGalleryControls(); } catch {} }, 250);
      setTimeout(() => { try { syncImageGalleryControls(); } catch {} }, 550);
    } else {
      galleryState = { items: [], index: -1, container: null, clickedAt: 0 };
      hideGalleryControls();
    }
  }

  function onGalleryKeyDown(e) {
    if (e.key === 'Escape') {
      setTimeout(() => { try { syncImageGalleryControls(); } catch {} }, 120);
      return;
    }
    if (!galPrevBtn.hidden && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const ae = document.activeElement;
      const inEditable = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (!inEditable) {
        e.preventDefault();
        e.stopPropagation();
        navigateGallery(e.key === 'ArrowLeft' ? -1 : 1);
      }
    }
  }

  function onGalleryResize() {
    if (!galPrevBtn.hidden) syncImageGalleryControls();
  }

  let galSyncTimer = null;
  const galObserver = new MutationObserver(() => {
    if (galSyncTimer) return;
    galSyncTimer = setTimeout(() => {
      galSyncTimer = null;
      try { syncImageGalleryControls(); } catch {}
    }, 180);
  });
  galObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

  window.addEventListener('message', onMessage);
  window.addEventListener('mousemove', onWindowMouseMove, true);
  window.addEventListener('mouseup', onWindowMouseUp, true);
  window.addEventListener('keydown', onWindowKeyDown, true);
  document.addEventListener('click', onGalleryClick, true);
  document.addEventListener('keydown', onGalleryKeyDown, true);
  window.addEventListener('resize', onGalleryResize);

  window.__wftDragBridgeCleanup = () => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('mousemove', onWindowMouseMove, true);
    window.removeEventListener('mouseup', onWindowMouseUp, true);
    window.removeEventListener('keydown', onWindowKeyDown, true);
    document.removeEventListener('click', onGalleryClick, true);
    document.removeEventListener('keydown', onGalleryKeyDown, true);
    window.removeEventListener('resize', onGalleryResize);
    galObserver.disconnect();
    galHost.remove();
  };
  window.__wftDragBridgeInstalled = '1.2.6';
  return { status: 'installed' };
})()`;

async function ensureMainDragBridge() {
  try {
    const port = getDevToolsPort();
    const listRes = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    const list = await listRes.json();
    const pageTargets = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
    const results = [];
    for (const target of pageTargets) {
      const res = await new Promise((resolve) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        const timer = setTimeout(() => {
          try { ws.close(); } catch {}
          resolve({ error: 'timeout' });
        }, 2500);
        ws.onopen = () => {
          ws.send(JSON.stringify({
            id: 202,
            method: 'Runtime.evaluate',
            params: { expression: MAIN_DRAG_BRIDGE_SCRIPT, returnByValue: true }
          }));
        };
        ws.onmessage = (ev) => {
          clearTimeout(timer);
          try {
            const parsed = JSON.parse(ev.data);
            resolve(parsed.result?.result?.value || { ok: true });
          } catch (e) {
            resolve({ error: e.message });
          } finally {
            try { ws.close(); } catch {}
          }
        };
        ws.onerror = () => {
          clearTimeout(timer);
          resolve({ error: 'ws_error' });
        };
      });
      results.push(res);
    }
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

app.api('/api/ensure-drag-bridge', async () => {
  return await ensureMainDragBridge();
});

setTimeout(() => { ensureMainDragBridge().catch(() => {}); }, 800);

// 9. Send file or directory safely to System Trash / Recycle Bin (Windows / macOS / Linux)
app.api('/api/delete-to-recycle-bin', async (data) => {
  const root = resolveRoot(data);
  const targetPath = data?.fullPath || (data?.path ? resolve(root, data.path) : null);
  if (!targetPath) return { error: 'No path specified' };

  if (!existsSync(targetPath)) {
    return { error: `File or directory not found: ${targetPath}` };
  }

  try {
    const isDir = statSync(targetPath).isDirectory();
    if (process.platform === 'darwin') {
      await execFileAsync('/usr/bin/osascript', [
        '-e',
        'on run argv',
        '-e',
        'tell application "Finder" to delete POSIX file (item 1 of argv)',
        '-e',
        'end run',
        targetPath
      ]);
    } else if (process.platform === 'win32') {
      const normalizedPath = targetPath.replace(/'/g, "''");
      const psScript = `Add-Type -AssemblyName Microsoft.VisualBasic; if (Test-Path -LiteralPath '${normalizedPath}' -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${normalizedPath}', 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${normalizedPath}', 'OnlyErrorDialogs', 'SendToRecycleBin') }`;
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        psScript
      ]);
    } else {
      await execFileAsync('gio', ['trash', targetPath]);
    }

    return {
      success: true,
      ok: true,
      path: data.path || relative(root, targetPath),
      name: basename(targetPath),
      isDir
    };
  } catch (err) {
    return { error: `Failed to move to Trash / Recycle Bin: ${err.message || err}` };
  }
});

// 10. Detect installed external apps (Editors / IDEs / Terminals) & extract real macOS app icons
const KNOWN_MAC_EDITORS = [
  { id: 'vscode', name: 'Visual Studio Code', icon: '💻', paths: ['/Applications/Visual Studio Code.app', '~/Applications/Visual Studio Code.app'] },
  { id: 'cursor', name: 'Cursor', icon: '⚡', paths: ['/Applications/Cursor.app', '~/Applications/Cursor.app'] },
  { id: 'windsurf', name: 'Windsurf', icon: '🌊', paths: ['/Applications/Windsurf.app', '~/Applications/Windsurf.app'] },
  { id: 'zed', name: 'Zed', icon: '⚡', paths: ['/Applications/Zed.app', '~/Applications/Zed.app'] },
  { id: 'trae', name: 'Trae', icon: '🧩', paths: ['/Applications/Trae.app', '~/Applications/Trae.app'] },
  { id: 'kiro', name: 'Kiro', icon: '👻', paths: ['/Applications/Kiro.app', '~/Applications/Kiro.app'] },
  { id: 'clion', name: 'CLion', icon: '⚙️', paths: ['/Applications/CLion.app', '~/Applications/CLion.app'] },
  { id: 'xcode', name: 'Xcode', icon: '🛠️', paths: ['/Applications/Xcode.app'] },
  { id: 'sublime', name: 'Sublime Text', icon: '📝', paths: ['/Applications/Sublime Text.app', '~/Applications/Sublime Text.app'] },
  { id: 'idea', name: 'IntelliJ IDEA', icon: '☕', paths: ['/Applications/IntelliJ IDEA.app', '/Applications/IntelliJ IDEA CE.app'] },
  { id: 'pycharm', name: 'PyCharm', icon: '🐍', paths: ['/Applications/PyCharm.app', '/Applications/PyCharm CE.app'] },
  { id: 'webstorm', name: 'WebStorm', icon: '🌐', paths: ['/Applications/WebStorm.app'] },
  { id: 'android-studio', name: 'Android Studio', icon: '📱', paths: ['/Applications/Android Studio.app'] },
];

const KNOWN_MAC_TERMINALS = [
  { id: 'ghostty', name: 'Ghostty', icon: '👻', paths: ['/Applications/Ghostty.app', '~/Applications/Ghostty.app'] },
  { id: 'iterm', name: 'iTerm', icon: '⌨️', paths: ['/Applications/iTerm.app', '~/Applications/iTerm.app'] },
  { id: 'warp', name: 'Warp', icon: '⌨️', paths: ['/Applications/Warp.app', '~/Applications/Warp.app'] },
  { id: 'terminal', name: 'Terminal', icon: '⌨️', paths: ['/System/Applications/Utilities/Terminal.app'] },
];

const KNOWN_WIN_EDITORS = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    icon: '💻',
    paths: [
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : '',
      'C:\\Program Files\\Microsoft VS Code\\Code.exe'
    ].filter(Boolean)
  },
  {
    id: 'cursor',
    name: 'Cursor',
    icon: '⚡',
    paths: [
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'cursor', 'Cursor.exe') : ''
    ].filter(Boolean)
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    icon: '🌊',
    paths: [
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Windsurf', 'Windsurf.exe') : ''
    ].filter(Boolean)
  }
];

const FINDER_APP_PATH = '/System/Library/CoreServices/Finder.app';
const ICON_CACHE_DIR = join(tmpdir(), 'workspace-file-tree-app-icons');
const iconMemCache = new Map();

const JXA_EXTRACT_MAC_ICONS = `
ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const p = argv[i];
    try {
      const icon = ws.iconForFile(p);
      if (!icon) continue;
      const size = $.NSMakeSize(36, 36);
      const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
        null, 36, 36, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0
      );
      rep.setSize(size);
      $.NSGraphicsContext.saveGraphicsState;
      const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
      $.NSGraphicsContext.setCurrentContext(ctx);
      ctx.setImageInterpolation($.NSImageInterpolationHigh);
      icon.drawInRectFromRectOperationFraction(
        $.NSMakeRect(0, 0, 36, 36),
        $.NSZeroRect,
        $.NSCompositingOperationSourceOver,
        1.0
      );
      $.NSGraphicsContext.restoreGraphicsState;
      const pngData = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
      const b64 = ObjC.unwrap(pngData.base64EncodedStringWithOptions(0));
      if (b64) out[p] = 'data:image/png;base64,' + b64;
    } catch (e) {}
  }
  return JSON.stringify(out);
}
`;

function hashAppKey(p) {
  let h = 2166136261;
  for (let i = 0; i < p.length; i++) {
    h ^= p.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function resolveMacAppIcons(appPaths) {
  const unique = [...new Set((appPaths || []).filter((p) => typeof p === 'string' && p && existsSync(p)))];
  const result = {};
  const missing = [];

  for (const p of unique) {
    if (iconMemCache.has(p)) {
      result[p] = iconMemCache.get(p);
      continue;
    }
    const cacheFile = join(ICON_CACHE_DIR, `${hashAppKey(p)}.png`);
    try {
      if (existsSync(cacheFile)) {
        const dataUrl = `data:image/png;base64,${readFileSync(cacheFile).toString('base64')}`;
        iconMemCache.set(p, dataUrl);
        result[p] = dataUrl;
        continue;
      }
    } catch {}
    missing.push(p);
  }

  if (missing.length > 0 && process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', JXA_EXTRACT_MAC_ICONS, ...missing],
        { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }
      );
      const extracted = JSON.parse(stdout.trim() || '{}');
      mkdirSync(ICON_CACHE_DIR, { recursive: true });
      for (const [p, dataUrl] of Object.entries(extracted)) {
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
          iconMemCache.set(p, dataUrl);
          result[p] = dataUrl;
          try {
            writeFileSync(
              join(ICON_CACHE_DIR, `${hashAppKey(p)}.png`),
              Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
            );
          } catch {}
        }
      }
    } catch {}
  }

  return result;
}

function expandTildePath(p) {
  return p.startsWith('~/') ? join(USER_HOME, p.slice(2)) : p;
}

function detectInstalledApps(catalog) {
  const found = [];
  for (const entry of catalog) {
    for (const rawPath of entry.paths) {
      const resolved = expandTildePath(rawPath);
      if (existsSync(resolved)) {
        found.push({
          id: entry.id,
          name: entry.name,
          icon: entry.icon,
          appPath: resolved
        });
        break;
      }
    }
  }
  return found;
}

app.api('/api/available-apps', async (data) => {
  if (process.platform === 'darwin') {
    const editors = detectInstalledApps(KNOWN_MAC_EDITORS);
    const terminals = detectInstalledApps(KNOWN_MAC_TERMINALS);
    const extraPaths = Array.isArray(data?.extraAppPaths) ? data.extraAppPaths : [];
    const icons = await resolveMacAppIcons([
      ...editors.map((e) => e.appPath),
      ...terminals.map((t) => t.appPath),
      FINDER_APP_PATH,
      ...extraPaths
    ]);
    return {
      platform: 'darwin',
      editors: editors.map((e) => ({ ...e, iconDataUrl: icons[e.appPath] || '' })),
      terminals: terminals.map((t) => ({ ...t, iconDataUrl: icons[t.appPath] || '' })),
      finderIconDataUrl: icons[FINDER_APP_PATH] || '',
      extraIcons: icons
    };
  }
  if (process.platform === 'win32') {
    return {
      platform: 'win32',
      editors: detectInstalledApps(KNOWN_WIN_EDITORS),
      terminals: [],
      finderIconDataUrl: '',
      extraIcons: {}
    };
  }
  return {
    platform: process.platform,
    editors: [],
    terminals: [],
    finderIconDataUrl: '',
    extraIcons: {}
  };
});

// 11. Open file or directory in external App, Finder/Explorer, Terminal, or System Default
app.api('/api/open-with-app', async (data) => {
  const root = resolveRoot(data);
  const targetPath = data?.fullPath || (data?.path ? resolve(root, data.path) : root);
  if (!targetPath || !existsSync(targetPath)) {
    return { error: `Path not found: ${targetPath || '(empty)'}` };
  }

  const action = data?.action || 'app';
  const appSpec = typeof data?.app === 'string' ? data.app.trim() : '';

  try {
    if (process.platform === 'darwin') {
      if (action === 'reveal') {
        await execFileAsync('/usr/bin/open', ['-R', targetPath]);
        return { success: true, action: 'reveal', targetPath };
      }
      if (action === 'default') {
        await execFileAsync('/usr/bin/open', [targetPath]);
        return { success: true, action: 'default', targetPath };
      }
      if (action === 'terminal') {
        const dirPath = statSync(targetPath).isDirectory() ? targetPath : dirname(targetPath);
        const termApp = appSpec || '/System/Applications/Utilities/Terminal.app';
        await execFileAsync('/usr/bin/open', ['-a', termApp, dirPath]);
        return { success: true, action: 'terminal', appPath: termApp, targetPath: dirPath };
      }
      if (action === 'choose') {
        let chosenPath = '';
        try {
          const { stdout } = await execFileAsync('/usr/bin/osascript', [
            '-e',
            'POSIX path of (choose file of type {"com.apple.application-bundle"} default location (POSIX file "/Applications") with prompt "Choose an application to open this item")'
          ]);
          chosenPath = stdout.trim().replace(/\/+$/, '');
        } catch (pickErr) {
          const msg = String(pickErr?.stderr || pickErr?.message || '');
          if (msg.includes('-128') || msg.toLowerCase().includes('cancel')) {
            return { cancelled: true };
          }
          throw pickErr;
        }
        if (!chosenPath) return { cancelled: true };
        await execFileAsync('/usr/bin/open', ['-a', chosenPath, targetPath]);
        const appName = basename(chosenPath).replace(/\.app$/i, '');
        const icons = await resolveMacAppIcons([chosenPath]);
        return { success: true, action: 'choose', appPath: chosenPath, appName, iconDataUrl: icons[chosenPath] || '', targetPath };
      }

      if (!appSpec) return { error: 'No target application specified' };
      await execFileAsync('/usr/bin/open', ['-a', appSpec, targetPath]);
      const appName = basename(appSpec).replace(/\.app$/i, '');
      return { success: true, action: 'app', appPath: appSpec, appName, targetPath };
    }

    if (process.platform === 'win32') {
      if (action === 'reveal') {
        await execFileAsync('explorer.exe', ['/select,', targetPath]);
        return { success: true, action: 'reveal', targetPath };
      }
      if (action === 'terminal') {
        const dirPath = statSync(targetPath).isDirectory() ? targetPath : dirname(targetPath);
        const child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `cd /d "${dirPath}"`], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref?.();
        return { success: true, action: 'terminal', targetPath: dirPath };
      }
      if (action === 'default' || !appSpec) {
        await execFileAsync('cmd.exe', ['/c', 'start', '', targetPath]);
        return { success: true, action: 'default', targetPath };
      }
      const child = spawn(appSpec, [targetPath], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref?.();
      return { success: true, action: 'app', appPath: appSpec, appName: basename(appSpec), targetPath };
    }

    // Linux fallback
    const openTarget = action === 'reveal' || action === 'terminal'
      ? (statSync(targetPath).isDirectory() ? targetPath : dirname(targetPath))
      : targetPath;
    await execFileAsync('xdg-open', [openTarget]);
    return { success: true, action, targetPath: openTarget };
  } catch (err) {
    return { error: `Failed to open: ${err?.stderr?.trim() || err?.message || err}` };
  }
});

const server = await app.run();
const defaultListeners = server.listeners('request').slice();
server.removeAllListeners('request');

server.on('request', (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/raw-media') {
    handleRawMedia(req, res, url);
    return;
  }
  for (const listener of defaultListeners) {
    listener.call(server, req, res);
  }
});
