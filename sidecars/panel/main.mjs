import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs';
import { dirname, join, relative, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SidecarApp, Response } from 'sidecar_sdk';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

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

// ---------------------------------------------------------------------------
// Static Page & Resource Routes
// ---------------------------------------------------------------------------
app.page('/', () => readLocal('index.html'));
app.page('/app.js', () => readLocal('app.js'));
app.page('/previewers.js', () => readLocal('previewers.js'));
app.page('/highlight.min.js', () => readLocal('highlight.min.js'));
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

// 6. Copy annotated image natively to Windows OS clipboard
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

    // Set Windows OS system clipboard directly via PowerShell
    const normalizedPath = fullPath.replace(/\\/g, '\\\\');
    const psScript = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Drawing.Image]::FromFile('${normalizedPath}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', psScript]);

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

// 7. Copy text snippet natively to Windows OS clipboard
app.api('/api/copy-text-to-clipboard', async (data) => {
  if (!data?.text) return { error: 'No text provided' };
  try {
    const encoded = Buffer.from(data.text, 'utf8').toString('base64');
    const psScript = `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}')) | Set-Clipboard`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
    return { success: true, ok: true };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

// 8. Open file directly in Antigravity's native preview tab via CDP
function getDevToolsPort() {
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort') : null,
  ].filter(Boolean);

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
  const pageTarget = list.find(t => t.type === 'page');
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

// 9. Send file or directory safely to Windows Recycle Bin
app.api('/api/delete-to-recycle-bin', async (data) => {
  const root = resolveRoot(data);
  const targetPath = data?.fullPath || (data?.path ? resolve(root, data.path) : null);
  if (!targetPath) return { error: 'No path specified' };

  if (!existsSync(targetPath)) {
    return { error: `File or directory not found: ${targetPath}` };
  }

  try {
    const isDir = statSync(targetPath).isDirectory();
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

    return {
      success: true,
      ok: true,
      path: data.path || relative(root, targetPath),
      name: basename(targetPath),
      isDir
    };
  } catch (err) {
    return { error: `Failed to move to Recycle Bin: ${err.message || err}` };
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
