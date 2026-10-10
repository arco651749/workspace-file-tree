import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
  if (data?.uri || data?.path) {
    const p = toLocalPath(data.uri || data.path);
    if (p && existsSync(p)) {
      activeWorkspaceRoot = p;
    }
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

// 3. Raw Media Streaming API (Direct HTTP endpoint for <audio> and <video>)
app.api('/api/raw-media', (data) => {
  const root = resolveRoot(data);
  if (!data?.path) return new Response('Missing path parameter', { status: 400 });
  const fullPath = resolve(root, data.path);
  if (!existsSync(fullPath)) return new Response('Media file not found', { status: 404 });

  const ext = extname(fullPath).toLowerCase();
  const mime = MEDIA_MIMES[ext] || 'application/octet-stream';

  try {
    const buffer = readFileSync(fullPath);
    return new Response(buffer, {
      contentType: mime,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(buffer.length)
      }
    });
  } catch (err) {
    return new Response(String(err.message), { status: 500 });
  }
}, 'GET');

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

    // If it's an image, encode to base64 Data URL (up to 10MB)
    if (mime) {
      const maxImgBytes = 10 * 1024 * 1024;
      if (st.size > maxImgBytes) {
        return {
          isImage: false,
          isBinary: true,
          size: st.size,
          name: basename(fullPath),
          path: relative(root, fullPath),
          message: 'Image exceeds 10MB preview limit'
        };
      }
      const buffer = readFileSync(fullPath);
      const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
      return {
        ext,
        isImage: true,
        dataUrl,
        size: st.size,
        name: basename(fullPath),
        path: relative(root, fullPath),
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
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript]);

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

app.run();
