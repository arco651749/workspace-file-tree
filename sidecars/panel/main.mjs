import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';

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

// 3. Read preview of a file (Supports Text & Images)
app.api('/api/file-content', (data) => {
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

    // Text file preview (up to 100KB)
    const maxBytes = 100 * 1024;
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

app.run();
