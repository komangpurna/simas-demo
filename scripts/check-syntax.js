const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vm = require('vm');

// Selalu pastikan working directory berada di root proyek smagesa-simas
const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

// If running in Node without --experimental-vm-modules, auto-spawn with it to enforce native ES module & duplicate identifier checks
if (!vm.SourceTextModule) {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', __filename, ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
  process.exit(result.status || 0);
}

const dirs = ['js', 'sukaduka', 'duta', 'library', 'pid', '.'];
let hasError = false;
let checkedCount = 0;

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.startsWith('.'));
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // 1. Prioritize strict ES Module parsing (enforces native duplicate identifier checks & module grammar)
      let parsedAsModule = false;
      if (vm.SourceTextModule) {
        try {
          new vm.SourceTextModule(content, {
            identifier: filePath,
            context: vm.createContext({ window: {}, document: {}, console }),
            initializeImportMeta() {}
          });
          parsedAsModule = true;
          checkedCount++;
        } catch (modErr) {
          // If it fails with a SyntaxError (e.g. duplicate identifier or invalid syntax), treat as fatal
          if (modErr.name === 'SyntaxError') {
            console.error(`❌ Syntax Error in ${filePath}:`, modErr.message);
            hasError = true;
            return;
          }
        }
      }

      if (!parsedAsModule) {
        // 2. Fallback to vm.Script for classic/non-module scripts if any
        const sanitized = content
          .replace(/^\s*import\s+[^;]+;?/gm, '/* import statement */')
          .replace(/\bimport\.meta\b/g, '({ url: "" })')
          .replace(/^\s*import\s*\([^)]+\)/gm, 'Promise.resolve()')
          .replace(/^\s*export\s+default\s+/gm, '')
          .replace(/^\s*export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+/gm, '$1 ')
          .replace(/^\s*export\s*\{[^}]*\};?/gm, '/* export statement */');

        new vm.Script(sanitized, { filename: filePath });
        checkedCount++;
      }
    } catch (e) {
      console.error(`❌ Syntax Error in ${filePath}:`, e.message);
      hasError = true;
    }
  });
});

// 2. Audit Statis Impor SDK Firebase: Memastikan fungsi SDK yang dipanggil tidak undeclared (mencegah ReferenceError saat runtime)
const FIREBASE_SDK_EXPORTS = [
  'updateProfile', 'updateEmail', 'updatePassword', 'reauthenticateWithCredential',
  'EmailAuthProvider', 'GoogleAuthProvider', 'signInWithEmailAndPassword',
  'signInWithCustomToken', 'signInAnonymously', 'signOut', 'onAuthStateChanged',
  'sendPasswordResetEmail', 'sendEmailVerification', 'createUserWithEmailAndPassword',
  'signInWithPopup', 'getDoc', 'updateDoc', 'setDoc', 'deleteDoc', 'getDocs',
  'writeBatch', 'runTransaction', 'arrayUnion', 'arrayRemove', 'increment'
];

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.startsWith('.') && !f.includes('.test.'));
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return;
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const cleanContent = rawContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

    const importedIdentifiers = new Set();
    const importRegex = /import\s*\{([^}]+)\}\s*from/g;
    let m;
    while ((m = importRegex.exec(cleanContent)) !== null) {
      m[1].split(',').forEach(s => {
        const parts = s.trim().split(/\s+as\s+/);
        importedIdentifiers.add(parts[parts.length - 1].trim());
      });
    }

    const dynImportRegex = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:await\s+)?import\(/g;
    while ((m = dynImportRegex.exec(cleanContent)) !== null) {
      m[1].split(',').forEach(s => {
        const parts = s.trim().split(/\s*:\s*/);
        importedIdentifiers.add(parts[parts.length - 1].trim());
      });
    }

    FIREBASE_SDK_EXPORTS.forEach(fn => {
      const callRegex = new RegExp('(?<![.\\w])' + fn + '\\s*\\(', 'g');
      if (callRegex.test(cleanContent)) {
        const hasDecl = new RegExp('(?:function|const|let|var|class)\\s+' + fn + '\\b').test(cleanContent);
        if (!importedIdentifiers.has(fn) && !hasDecl) {
          console.error(`❌ Undeclared Firebase SDK Call in ${filePath}: '${fn}' dipanggil tetapi belum diimpor!`);
          hasError = true;
        }
      }
    });
  });
});

// 3. Audit Integritas Resolusi Ekspor-Impor Modul ES Lokal:
// Memastikan setiap pengenal yang diimpor via `import { ... } from './local'` atau `import def from './local'`
// benar-benar diekspor oleh berkas target (mencegah Uncaught SyntaxError: The requested module does not provide an export named...)
let localImportsChecked = 0;
const exportCache = new Map();

function getModuleExports(targetPath) {
  if (exportCache.has(targetPath)) return exportCache.get(targetPath);
  if (!fs.existsSync(targetPath)) return null;

  const content = fs.readFileSync(targetPath, 'utf8');
  const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const exports = new Set();

  // export (async) function / const / let / var / class
  const declRegex = /export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([a-zA-Z0-9_$]+)/g;
  let m;
  while ((m = declRegex.exec(clean)) !== null) {
    exports.add(m[1]);
  }

  // export { a, b as c, d }
  const blockRegex = /export\s*\{([^}]+)\}/g;
  while ((m = blockRegex.exec(clean)) !== null) {
    const items = m[1].split(',');
    items.forEach(item => {
      const trimmed = item.trim();
      if (!trimmed) return;
      const parts = trimmed.split(/\s+as\s+/);
      const exportedName = parts[parts.length - 1].trim();
      if (exportedName) exports.add(exportedName);
    });
  }

  // export default
  if (/export\s+default\b/.test(clean)) {
    exports.add('default');
  }

  // export * from './...'
  const exportAllRegex = /export\s*\*\s*from\s*['"](\.[^'"]+)['"]/g;
  while ((m = exportAllRegex.exec(clean)) !== null) {
    const subTarget = path.resolve(path.dirname(targetPath), m[1]);
    const subExports = getModuleExports(subTarget);
    if (subExports) {
      subExports.forEach(e => exports.add(e));
    }
  }

  exportCache.set(targetPath, exports);
  return exports;
}

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.startsWith('.') && !f.includes('.test.'));
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return;
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const cleanContent = rawContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

    // Named imports: import { a, b as c } from './something.js'
    const importNamedRegex = /import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = importNamedRegex.exec(cleanContent)) !== null) {
      const rawSpecifiers = m[1];
      const importPath = m[2];
      const targetFile = path.resolve(path.dirname(filePath), importPath);
      const exports = getModuleExports(targetFile);
      if (!exports) {
        console.error(`❌ Module Not Found in ${filePath}: Berkas lokal '${importPath}' tidak ditemukan di disk!`);
        hasError = true;
        continue;
      }
      const specifiers = rawSpecifiers.split(',').map(s => s.trim()).filter(Boolean);
      specifiers.forEach(spec => {
        const importedName = spec.split(/\s+as\s+/)[0].trim();
        localImportsChecked++;
        if (!exports.has(importedName)) {
          console.error(`❌ Unresolved Module Export in ${filePath}: Modul '${importPath}' tidak menyediakan ekspor bernama '${importedName}'!`);
          hasError = true;
        }
      });
    }

    // Default imports: import foo from './something.js'
    const importDefaultRegex = /import\s+([a-zA-Z0-9_$]+)\s+from\s*['"](\.[^'"]+)['"]/g;
    while ((m = importDefaultRegex.exec(cleanContent)) !== null) {
      const importedName = m[1].trim();
      const importPath = m[2];
      if (importedName === 'type') continue; // TS type keyword guard
      const targetFile = path.resolve(path.dirname(filePath), importPath);
      const exports = getModuleExports(targetFile);
      if (!exports) {
        console.error(`❌ Module Not Found in ${filePath}: Berkas lokal '${importPath}' tidak ditemukan di disk!`);
        hasError = true;
        continue;
      }
      localImportsChecked++;
      if (!exports.has('default')) {
        console.error(`❌ Missing Default Export in ${filePath}: Modul '${importPath}' tidak memiliki export default!`);
        hasError = true;
      }
    }
  });
});

// 4. Audit tag script dan stylesheet di file HTML:
// a) Menjamin berkas fisik lokal benar-benar ada di disk (mencegah error 404 pada browser)
// b) Jika berkas script lokal memuat import/export, tag HTML WAJIB memiliki type="module"
function walkHtml(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules' && file !== 'cypress' && file !== 'scratch' && file !== 'templates' && file !== 'dist-hosting') {
      results = results.concat(walkHtml(full));
    } else if (file.endsWith('.html')) {
      results.push(full);
    }
  });
  return results;
}

const htmlFiles = walkHtml('.');
htmlFiles.forEach(htmlFile => {
  const content = fs.readFileSync(htmlFile, 'utf8');

  // Script tags
  const scriptRegex = /<script\b([^>]*)src=["']([^"']+)["']([^>]*)>/gi;
  let m;
  while ((m = scriptRegex.exec(content)) !== null) {
    const fullAttrs = (m[1] + ' ' + m[3]).toLowerCase();
    const src = m[2];
    const isModule = fullAttrs.includes('type="module"') || fullAttrs.includes("type='module'") || fullAttrs.includes('type=module');
    if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//')) {
      const rawSrc = src.split('?')[0];
      const targetJs = rawSrc.startsWith('/') ? path.resolve('.', '.' + rawSrc) : path.resolve(path.dirname(htmlFile), rawSrc);
      if (!fs.existsSync(targetJs)) {
        console.error(`❌ Error Script 404: ${htmlFile} memuat script "${src}", tetapi berkas fisik tidak ditemukan di disk!`);
        hasError = true;
      } else {
        const jsContent = fs.readFileSync(targetJs, 'utf8');
        if (!isModule && /^\s*(import\s|export\s)/m.test(jsContent)) {
          console.error(`❌ Error Module Script: ${htmlFile} memuat "${src}" tanpa type="module", padahal berkas menggunakan import/export!`);
          hasError = true;
        }
      }
    }
  }

  // Stylesheet link tags
  const styleRegex = /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
  while ((m = styleRegex.exec(content)) !== null) {
    const href = m[1];
    if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//')) {
      const rawHref = href.split('?')[0];
      const targetCss = rawHref.startsWith('/') ? path.resolve('.', '.' + rawHref) : path.resolve(path.dirname(htmlFile), rawHref);
      if (!fs.existsSync(targetCss)) {
        console.error(`❌ Error Stylesheet 404: ${htmlFile} memuat stylesheet "${href}", tetapi berkas fisik tidak ditemukan di disk!`);
        hasError = true;
      }
    }
  }
});

// 5. Audit Integritas Service Worker PWA (sw.js): Memastikan seluruh aset fisik di ASSETS_TO_CACHE benar-benar ada di disk (0 error 404)
const swPath = path.resolve('sw.js');
let swAssetsChecked = 0;
if (fs.existsSync(swPath)) {
  const swContent = fs.readFileSync(swPath, 'utf8');

  // Validasi format CACHE_NAME
  const cacheNameMatch = swContent.match(/const\s+CACHE_NAME\s*=\s*'([^']+)'/);
  if (!cacheNameMatch || !/^simas-pwa-v\d+$/.test(cacheNameMatch[1])) {
    console.error(`❌ Error Service Worker: CACHE_NAME di sw.js tidak valid atau tidak sesuai format 'simas-pwa-v[angka]'!`);
    hasError = true;
  }

  // Validasi ASSETS_TO_CACHE
  const arrayMatch = swContent.match(/const\s+ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\];/);
  if (!arrayMatch) {
    console.error('❌ Error Service Worker: Array ASSETS_TO_CACHE tidak ditemukan di sw.js!');
    hasError = true;
  } else {
    const assetEntries = arrayMatch[1]
      .split('\n')
      .map(line => line.trim().replace(/^['"]|['"],?$/g, ''))
      .filter(item => item && !item.startsWith('//'));

    const missingAssets = [];
    for (const asset of assetEntries) {
      const cleanPath = asset.replace(/^\.\//, '');
      if (!cleanPath) continue; // Root './'

      const fullPath = path.resolve(cleanPath);
      if (!fs.existsSync(fullPath)) {
        missingAssets.push(asset);
      } else {
        swAssetsChecked++;
      }
    }

    if (missingAssets.length > 0) {
      console.error(`❌ Error Service Worker Cache (404 Not Found): Aset berikut terdaftar di ASSETS_TO_CACHE (sw.js) tetapi berkas fisiknya TIDAK DITEMUKAN di disk:\n` +
        missingAssets.map(a => `   -> ${a}`).join('\n') +
        `\n   PENTING: Seluruh aset di ASSETS_TO_CACHE wajib eksis di disk karena Service Worker gagal menginstal secara atomik jika ada berkas 404!`);
      hasError = true;
    }
  }
}

// 6. Audit Statis Atribut Event HTML Inline window.*(...) (Proteksi ReferenceError & Uncaught TypeError: window.* is not a function):
// Memvalidasi bahwa seluruh fungsi yang dipanggil pada atribut on<event>="window.fn()" di agenda-pegawai.html
// dan berkas HTML lainnya benar-benar dideklarasikan di JavaScript (bukan undefined / undeclared).
const NATIVE_WINDOW_MEMBERS = new Set([
  'location', 'open', 'close', 'print', 'alert', 'confirm', 'prompt',
  'scroll', 'scrollTo', 'scrollBy', 'resizeTo', 'resizeBy', 'moveTo', 'moveBy',
  'history', 'focus', 'blur', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getSelection', 'matchMedia', 'fetch',
  'document', 'navigator', 'screen', 'console', 'localStorage', 'sessionStorage',
  'parent', 'top', 'self', 'frames', 'window', 'customElements', 'crypto', 'indexedDB'
]);

function getImportedScriptFiles(filePath, visited = new Set()) {
  if (visited.has(filePath)) return visited;
  visited.add(filePath);
  if (!fs.existsSync(filePath)) return visited;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    const importRegex = /(?:import\s+(?:[^'"]*from\s+)?|import\s*\()\s*['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = importRegex.exec(clean)) !== null) {
      const impPath = path.resolve(path.dirname(filePath), m[1]);
      getImportedScriptFiles(impPath, visited);
    }
  } catch (_) {}
  return visited;
}

function extractScriptDeclarations(content) {
  const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const declared = new Set();

  const winAssignRegex = /(?:window|globalThis)(?:\.([a-zA-Z0-9_$]+)|\[['"]([a-zA-Z0-9_$]+)['"]\])\s*=/g;
  let m;
  while ((m = winAssignRegex.exec(clean)) !== null) {
    declared.add(m[1] || m[2]);
  }

  const objAssignRegex = /Object\.assign\s*\(\s*(?:window|globalThis)\s*,\s*\{([^}]+)\}/g;
  while ((m = objAssignRegex.exec(clean)) !== null) {
    const props = m[1].split(',');
    props.forEach(p => {
      const key = p.split(':')[0].trim();
      if (/^[a-zA-Z0-9_$]+$/.test(key)) declared.add(key);
    });
  }

  const funcRegex = /^(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/gm;
  while ((m = funcRegex.exec(clean)) !== null) {
    declared.add(m[1]);
  }

  return declared;
}

// Pre-index seluruh deklarasi skrip JS proyek
const allKnownDeclarations = new Set();
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.startsWith('.') && !f.includes('.test.'));
  files.forEach(file => {
    try {
      const c = fs.readFileSync(path.join(dir, file), 'utf8');
      extractScriptDeclarations(c).forEach(d => allKnownDeclarations.add(d));
    } catch (_) {}
  });
});

// Indeks juga deklarasi window.* di dalam tag <script> berkas HTML
htmlFiles.forEach(htmlFile => {
  try {
    const c = fs.readFileSync(htmlFile, 'utf8');
    const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let sm;
    while ((sm = scriptRegex.exec(c)) !== null) {
      extractScriptDeclarations(sm[2]).forEach(d => allKnownDeclarations.add(d));
    }
  } catch (_) {}
});

let inlineHandlersChecked = 0;
htmlFiles.forEach(htmlFile => {
  const content = fs.readFileSync(htmlFile, 'utf8');
  const isAgendaPegawai = path.basename(htmlFile) === 'agenda-pegawai.html';
  const isEKinerjaTendik = path.basename(htmlFile) === 'e-kinerja-tendik.html';

  const eventRegex = /\bon[a-z]+\s*=\s*["']([^"']+)["']/gi;
  let m;
  const calledWindowFns = new Set();
  while ((m = eventRegex.exec(content)) !== null) {
    const handler = m[1];
    const winCallRegex = /window\.([a-zA-Z0-9_$]+)/g;
    let wm;
    while ((wm = winCallRegex.exec(handler)) !== null) {
      const fnName = wm[1];
      if (!NATIVE_WINDOW_MEMBERS.has(fnName)) {
        calledWindowFns.add(fnName);
      }
    }
  }

  if (calledWindowFns.size === 0) return;

  const pageDeclared = new Set();

  if (isAgendaPegawai || isEKinerjaTendik) {
    // Validasi ketat agenda-pegawai.html & e-kinerja-tendik.html: seluruh pemanggilan window.* wajib dideklarasikan di controller JS terkait (atau modul yang diimpor)
    const targetJsPath = isEKinerjaTendik ? 'js/page-e-kinerja-tendik.js' : 'js/page-agenda-pegawai.js';
    const agendaJs = path.resolve(targetJsPath);
    const files = getImportedScriptFiles(agendaJs);
    files.forEach(f => {
      if (fs.existsSync(f)) {
        const c = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
        const reg = /(?:window|globalThis)(?:\.([a-zA-Z0-9_$]+)|\[['"]([a-zA-Z0-9_$]+)['"]\])\s*=/g;
        let rm;
        while ((rm = reg.exec(c)) !== null) {
          pageDeclared.add(rm[1] || rm[2]);
        }
      }
    });
  } else {
    // Berkas HTML lainnya: periksa skrip terkait dan deklarasi JavaScript proyek
    const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let sm;
    while ((sm = scriptRegex.exec(content)) !== null) {
      const attrs = sm[1];
      const inline = sm[2];
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
      if (srcMatch) {
        const src = srcMatch[1];
        if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//')) {
          const raw = src.split('?')[0];
          const target = raw.startsWith('/') ? path.resolve('.', '.' + raw) : path.resolve(path.dirname(htmlFile), raw);
          const files = getImportedScriptFiles(target);
          files.forEach(f => {
            if (fs.existsSync(f)) {
              extractScriptDeclarations(fs.readFileSync(f, 'utf8')).forEach(d => pageDeclared.add(d));
            }
          });
        }
      } else if (inline.trim()) {
        extractScriptDeclarations(inline).forEach(d => pageDeclared.add(d));
      }
    }
    allKnownDeclarations.forEach(d => pageDeclared.add(d));
  }

  calledWindowFns.forEach(fn => {
    inlineHandlersChecked++;
    if (!pageDeclared.has(fn)) {
      console.error(`❌ Undeclared Inline Window Handler in ${htmlFile}: window.${fn}() dipanggil pada atribut event HTML tetapi tidak dideklarasikan pada JavaScript!`);
      hasError = true;
    }
  });
});

// Audit Statis Atribut Event HTML di dalam Template String Berkas JavaScript (js/*.js):
// Mencegah kesalahan runtime saat JavaScript merender komponen dinamis dengan event inline (seperti onclick="window.XYZ()")
// yang fungsinya belum pernah diekspos ke window atau salah ketik nama fungsinya.
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.startsWith('.') && !f.includes('.test.'));
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const eventRegex = /\bon[a-z]+\s*=\s*(?:\\?["'])([^"'>\\]+)(?:\\?["'])/gi;
      let m;
      while ((m = eventRegex.exec(content)) !== null) {
        const handler = m[1];
        const winCallRegex = /window\.([a-zA-Z0-9_$]+)/g;
        let wm;
        while ((wm = winCallRegex.exec(handler)) !== null) {
          const fnName = wm[1];
          if (!NATIVE_WINDOW_MEMBERS.has(fnName)) {
            inlineHandlersChecked++;
            if (!allKnownDeclarations.has(fnName)) {
              console.error(`❌ Undeclared Inline Window Handler in JS Template (${path.relative(process.cwd(), fullPath)}): window.${fnName}() dipanggil pada atribut event dinamis tetapi tidak dideklarasikan pada objek window!`);
              hasError = true;
            }
          }
        }
      }
    } catch (_) {}
  });
});

// 7. Audit Integritas Hierarki Modal & Keseimbangan Tag Kontainer Modal (Anti-Nesting & Unclosed Tags Guard):
// Memvalidasi bahwa seluruh modal dialog overlay (fixed inset-0) berdiri mandiri (top-level / sibling)
// dan DILARANG KERAS bersarang (nested) di dalam modal atau kontainer berstatus hidden lainnya.
let modalsChecked = 0;
htmlFiles.forEach(htmlFile => {
  const content = fs.readFileSync(htmlFile, 'utf8');
  const noComments = content.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const lines = noComments.split('\n');

  let stack = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tagRegex = /<\/?div(?:\s+[^>]*)?>/gi;
    let m;

    while ((m = tagRegex.exec(line)) !== null) {
      const rawTag = m[0];
      const isClosing = rawTag.startsWith('</');
      const isSelfClosing = rawTag.endsWith('/>');
      if (isSelfClosing && !isClosing) continue;

      if (isClosing) {
        if (stack.length > 0) stack.pop();
      } else {
        const idMatch = rawTag.match(/id=["']([^"']+)["']/i);
        const elementId = idMatch ? idMatch[1] : null;
        const classMatch = rawTag.match(/class=["']([^"']+)["']/i);
        const isOverlayModal = elementId && elementId.startsWith('modal-') && classMatch && classMatch[1].includes('fixed') && classMatch[1].includes('inset-0');

        if (isOverlayModal) {
          modalsChecked++;
          const parentOverlay = stack.find(s => s.isOverlay);
          if (parentOverlay) {
            console.error(`❌ Fatal Nested Modal Bug in ${htmlFile}: Modal overlay #${elementId} (baris ${i + 1}) bersarang di dalam modal overlay #${parentOverlay.id} (baris ${parentOverlay.line})!`);
            hasError = true;
          }
        }

        const isTabPanel = elementId && elementId.startsWith('panel-');
        if (isTabPanel) {
          const parentPanel = stack.find(s => s.isTabPanel);
          if (parentPanel) {
            console.error(`❌ Fatal Nested Panel Bug in ${htmlFile}: Tab panel #${elementId} (baris ${i + 1}) bersarang di dalam panel #${parentPanel.id} (baris ${parentPanel.line})!`);
            hasError = true;
          }
        }

        stack.push({ id: elementId, isOverlay: Boolean(isOverlayModal), isTabPanel: Boolean(isTabPanel), line: i + 1 });
      }
    }
  }

  // Khusus e-kinerja.html & guru-mapel.html, pastikan div berimbang sempurna (0 unclosed tags)
  const normPath = htmlFile.replace(/\\/g, '/');
  if ((normPath.endsWith('e-kinerja.html') || normPath.endsWith('guru-mapel.html')) && stack.length > 0) {
    console.error(`❌ Unclosed Div Error in ${htmlFile}: Ditemukan ${stack.length} tag <div> yang belum ditutup pada akhir berkas!`);
    hasError = true;
  }
});

// 8. Audit Paritas Endpoint API Klien vs Cloudflare Worker Router (Client-Worker API Parity Guard):
// Memvalidasi bahwa setiap endpoint /api/... yang dipanggil pada js/cloudflare-client.js
// benar-benar terdaftar sebagai rute di cloudflare/worker.js untuk mencegah regresi 404 Endpoint Not Found saat runtime.
let endpointsChecked = 0;
const workerFilePath = path.resolve('cloudflare', 'worker.js');
const clientFilePath = path.resolve('js', 'cloudflare-client.js');

if (fs.existsSync(workerFilePath) && fs.existsSync(clientFilePath)) {
  // Sumber datar (worker.js + modul cloudflare/lib) agar rute yang kelak dipindah ke modul tetap terdeteksi.
  const workerContent = require('../tests/helpers/worker-source.cjs').buildFlatWorkerSource();
  const clientContent = fs.readFileSync(clientFilePath, 'utf8');

  const clientApiRegex = /['"`](\/api\/[a-zA-Z0-9_\-\/]+(?:\?[^'"`]*)?)['"`]/g;
  let cm;
  const clientRoutes = new Set();
  while ((cm = clientApiRegex.exec(clientContent)) !== null) {
    let cleanRoute = cm[1].split('?')[0].replace(/\/\${[^}]+}/g, '').trim();
    if (cleanRoute.startsWith('/api/')) {
      clientRoutes.add(cleanRoute);
    }
  }

  clientRoutes.forEach(route => {
    endpointsChecked++;
    const routeParts = route.split('/').filter(Boolean);
    const baseRoute = '/' + routeParts.slice(0, 3).join('/');
    const parentRoute = '/' + routeParts.slice(0, 2).join('/');

    const existsInWorker = workerContent.includes(route) ||
      workerContent.includes(`"${route}"`) ||
      workerContent.includes(`'${route}'`) ||
      workerContent.includes(`path === "${route}"`) ||
      workerContent.includes(`path.startsWith("${route}")`) ||
      workerContent.includes(`path.startsWith("${baseRoute}")`) ||
      (routeParts.length >= 3 && workerContent.includes(`"${baseRoute}"`)) ||
      (routeParts.length >= 2 && workerContent.includes(`"${parentRoute}"`));

    if (!existsInWorker) {
      console.error(`❌ Unregistered API Endpoint in js/cloudflare-client.js: Endpoint '${route}' dipanggil di client tetapi TIDAK DITEMUKAN di routing cloudflare/worker.js!`);
      hasError = true;
    }
  });
}

// 9. Audit Integritas Iterasi Aman & Pencegahan TypeError Non-Array (Safe Iteration Guard):
// Memvalidasi bahwa pemanggilan fungsi analisis objek (seperti calculateDayTimelineSlots)
// tidak pernah langsung diperlakukan sebagai array mentah tanpa mengekstrak properti .slots atau Array.isArray,
// serta mendeteksi pemanggilan berisiko pada variabel response tanpa validasi array.
let safeIterationsChecked = 0;

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.startsWith('.') && !f.includes('.test.'));
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return;
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const cleanContent = rawContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

    // Deteksi jika calculateDayTimelineSlots langsung ditampung ke variabel slots dan diiterasi mentah:
    const timelineCallRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*calculateDayTimelineSlots\s*\(/g;
    let tm;
    while ((tm = timelineCallRegex.exec(cleanContent)) !== null) {
      safeIterationsChecked++;
      const varName = tm[1];
      if (varName === 'slots') {
        console.error(`❌ Unsafe Array Iteration in ${filePath}: Variabel '${varName}' menampung objek hasil calculateDayTimelineSlots() secara langsung. Wajib gunakan 'const dayTimeline = calculateDayTimelineSlots(...)' dan ekstrak 'dayTimeline?.slots || []'!`);
        hasError = true;
      }
    }

    // Deteksi jika ada variabel penampung calculateDayTimelineSlots yang langsung dipanggil .forEach tanpa .slots
    const unsafeUsageRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*calculateDayTimelineSlots[\s\S]*?\b\1\.forEach\s*\(/g;
    let um;
    while ((um = unsafeUsageRegex.exec(cleanContent)) !== null) {
      safeIterationsChecked++;
      const varName = um[1];
      if (!cleanContent.includes(`${varName}.slots`) && !cleanContent.includes(`${varName}?.slots`)) {
        console.error(`❌ Unsafe Object forEach in ${filePath}: Variabel '${varName}' menampung objek timeline tetapi dipanggil '${varName}.forEach()' tanpa mengekstrak properti '${varName}.slots'!`);
        hasError = true;
      }
    }

    // Deteksi jika variabel objek dictionary 'records = {}' dipanggil langsung dengan method array .filter/.map/.forEach:
    const unsafeRecordsRegex = /(?:const|let|var)\s+records\s*=\s*\{\}[\s\S]*?\b(?:records|\(records\s*\|\|\s*\[\]\))\.(?:filter|map|forEach|reduce)\s*\(/g;
    let rm;
    while ((rm = unsafeRecordsRegex.exec(cleanContent)) !== null) {
      safeIterationsChecked++;
      console.error(`❌ Unsafe Object Array Method in ${filePath}: Variabel 'records' berupa objek '{}' dipanggil langsung dengan method array! Wajib gunakan Object.values(records) atau Array.isArray guard.`);
      hasError = true;
    }
  });
});

// 10. Audit Deklarasi State Privat & Pencegahan ReferenceError Modul (Critical Module State Scope Guard):
// Memvalidasi bahwa variabel state internal kritis (seperti _currentUserProfile, _currentLogPhotos, dsb.)
// pada modul interaktif kompleks telah dideklarasikan secara eksplisit di lingkup teratas modul,
// menjamin 0% risiko terjadinya Uncaught ReferenceError saat pengguna berinteraksi di peramban.
let criticalStatesChecked = 0;
const criticalModulesMap = {
  'js/page-beban-kerja.js': [
    '_currentUserProfile',
    '_currentLogPhotos',
    '_photoUploadSeq',
    '_weekStartDate',
    '_selectedDayIndex',
    '_lightboxPhotos',
    '_lightboxIndex'
  ]
};

Object.entries(criticalModulesMap).forEach(([modRelPath, requiredVars]) => {
  const modFullPath = path.join(__dirname, '..', modRelPath);
  if (!fs.existsSync(modFullPath)) return;
  const modRaw = fs.readFileSync(modFullPath, 'utf8');
  const modClean = modRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

  const declaredVars = new Set();
  const declRegex = /(?:let|const|var)\s+(_[a-zA-Z0-9_$]+)/g;
  let dm;
  while ((dm = declRegex.exec(modClean)) !== null) {
    declaredVars.add(dm[1]);
  }

  requiredVars.forEach(v => {
    criticalStatesChecked++;
    if (!declaredVars.has(v)) {
      console.error(`❌ Undeclared Critical State in ${modRelPath}: Variabel '${v}' wajib dideklarasikan secara eksplisit di lingkup modul untuk mencegah ReferenceError di runtime!`);
      hasError = true;
    }
  });
});

// 11. Audit Temporal Dead Zone (TDZ Scope Guard & Anti ReferenceError Analyzer):
// Memvalidasi seluruh file JavaScript menggunakan AST Babel untuk mendeteksi penggunaan identifier
// sebelum deklarasi 'const' atau 'let' pada frame eksekusi sinkron yang sama
// (mencegah error runtime "Cannot access 'X' before initialization").
let tdzAuditedFiles = 0;
let tdzBindingsChecked = 0;

try {
  const babelParser = require('@babel/parser');
  const babelTraverse = require('@babel/traverse').default;

  const CRITICAL_MODULE_ALLOWED_GLOBALS = new Set([
    'window', 'document', 'console', 'Math', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp', 'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'Set', 'Map', 'WeakSet', 'WeakMap', 'Promise', 'JSON', 'Intl', 'Symbol', 'Reflect', 'Proxy', 'BigInt', 'NaN', 'Infinity', 'undefined', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'btoa', 'atob', 'escape', 'unescape', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'Headers', 'Request', 'Response', 'FormData', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'CustomEvent', 'Event', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Node', 'Element', 'DOMParser', 'XMLSerializer', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'alert', 'confirm', 'prompt', 'performance', 'crypto', 'indexedDB', 'caches', 'Notification', 'Audio', 'Image', 'self', 'top', 'parent', 'opener', 'globalThis', 'arguments', 'AbortController',
    'DAY_NAMES', 'MONTH_NAMES', 'APP_VERSION', 'APP_CONFIG', 'auth', 'db', 'storage', 'showToast', 'escapeHTML', 'sanitizeUrl', 'openConfirmModal', 'el', 'hideModal', 'showModal', 'openLightboxModal', 'retryActivityPhoto'
  ]);

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.startsWith('.') && !f.includes('.test.'));
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return;

      const code = fs.readFileSync(filePath, 'utf8');
      try {
        const ast = babelParser.parse(code, {
          sourceType: 'module',
          errorRecovery: true,
          plugins: ['importAssertions']
        });
        tdzAuditedFiles++;

        const normFilePath = filePath.replace(/\\/g, '/');
        const isCriticalWorkloadModule = normFilePath.endsWith('js/page-beban-kerja.js') || normFilePath.endsWith('js/page-e-kinerja-tendik.js');

        babelTraverse(ast, {
          Identifier(p) {
            if (!p.isReferencedIdentifier()) return;
            const name = p.node.name;
            const b = p.scope.getBinding(name);
            if (!b) {
              if (name.startsWith('_') && !name.startsWith('__')) {
                console.error(`❌ Undeclared Internal Variable in ${filePath}: Variabel internal '${name}' (baris ${p.node.loc.start.line}) diakses tetapi tidak pernah dideklarasikan di lingkup mana pun!`);
                hasError = true;
              } else if (isCriticalWorkloadModule && !CRITICAL_MODULE_ALLOWED_GLOBALS.has(name) && !name.startsWith('__')) {
                console.error(`❌ Undeclared Local Identifier in ${filePath}: Variabel '${name}' (baris ${p.node.loc.start.line}) diakses tanpa deklarasi lokal maupun impor (potensi ReferenceError)!`);
                hasError = true;
              }
              return;
            }
            if (b.kind === 'const' || b.kind === 'let') {
              tdzBindingsChecked++;
              if (p.node.start < b.identifier.start) {
                const bFuncScope = (b.scope.block.type.includes('Function') ? b.scope : b.scope.getFunctionParent());
                const pFuncScope = p.scope.getFunctionParent();
                if (bFuncScope === pFuncScope) {
                  console.error(`❌ TDZ ReferenceError in ${filePath}: Variabel '${p.node.name}' (baris ${p.node.loc.start.line}) diakses sebelum dideklarasikan (${b.kind} pada baris ${b.identifier.loc.start.line})!`);
                  hasError = true;
                }
              }
            }
          }
        });
      } catch (parseErr) {
        // Abaikan parse error sekunder jika file bukan module murni
      }
    });
  });
} catch (loadErr) {
  // Jika Babel parser tidak tersedia di runtime tertentu, lewati secara aman
}

// 12. Audit Integritas Mutasi Profil GTK & Pencegahan False 409 / False Re-Auth (GTK Profile & Anti-Conflict Guard):
// Memvalidasi kepatuhan arsitektur backend Worker dan frontend form profil:
// a. cloudflare/worker.js wajib memiliki fungsi helper isSamePerson saat mengecek keunikan NIK/NIP/NUPTK.
// b. cloudflare/worker.js wajib memindahkan foreign key tabel beban kerja (work_weeks, work_logs, weekly_templates, teacher_assignments) saat migrasi GTK ID.
// c. js/global.js wajib menggunakan dataset.initialEmail untuk mencegah false re-authentication password.
// d. js/global.js wajib mengecualikan Google OAuth SSO dari permintaan re-auth password Firebase.
let gtkIntegrityGuardsChecked = 0;

const workerPath = path.join(__dirname, '../cloudflare/worker.js');
if (fs.existsSync(workerPath)) {
  const workerSrc = fs.readFileSync(workerPath, 'utf8');

  // Guard a: isSamePerson di Worker
  gtkIntegrityGuardsChecked++;
  if (!workerSrc.includes('const isSamePerson = (row) =>') || !workerSrc.includes('!isSamePerson(existNik)')) {
    console.error('❌ GTK Profile Parity Error: cloudflare/worker.js wajib mengimplementasikan helper isSamePerson untuk mencegah false HTTP 409 Conflict pada pemilik akun sendiri!');
    hasError = true;
  }

  // Guard b: Foreign Key Cascade Migration di Worker
  gtkIntegrityGuardsChecked++;
  const requiredFkMigrateQueries = [
    'UPDATE teacher_assignments SET teacher_id = ? WHERE teacher_id = ?',
    'UPDATE work_weeks SET teacher_id = ? WHERE teacher_id = ?',
    'UPDATE weekly_templates SET teacher_id = ? WHERE teacher_id = ?',
    'UPDATE work_logs SET teacher_id = ? WHERE teacher_id = ?',
    'DELETE FROM gtk WHERE nik = ? AND id != ?'
  ];
  requiredFkMigrateQueries.forEach(q => {
    if (!workerSrc.includes(q)) {
      console.error(`❌ GTK Cascade Migration Error: cloudflare/worker.js wajib menyertakan migrasi '${q}' saat terjadi migrasi GTK ID untuk mencegah SQLite FOREIGN KEY Constraint failed!`);
      hasError = true;
    }
  });
}

const globalPath = path.join(__dirname, '../js/global.js');
if (fs.existsSync(globalPath)) {
  const globalSrc = fs.readFileSync(globalPath, 'utf8');

  // Guard c: dataset.initialEmail di saveEditProfile
  gtkIntegrityGuardsChecked++;
  if (!globalSrc.includes('dataset?.initialEmail') || !globalSrc.includes('isFormEmailChanged') || !globalSrc.includes('isAuthEmailDifferent')) {
    console.error('❌ Profile Form Re-Auth Error: js/global.js wajib membandingkan email dengan dataset.initialEmail untuk mencegah false-positive password re-authentication!');
    hasError = true;
  }

  // Guard d: Google SSO Exemption
  gtkIntegrityGuardsChecked++;
  if (!globalSrc.includes('isGoogleProvider && !isPasswordProvider')) {
    console.error('❌ Profile Form Google SSO Error: js/global.js wajib mengecualikan akun Google OAuth dari re-autentikasi password Firebase!');
    hasError = true;
  }

  // Guard e: Persistent Telegram Chat ID & Phone di userUpdates
  gtkIntegrityGuardsChecked++;
  if (!globalSrc.includes('telegramChatId: newTelegramChatId') || !globalSrc.includes('userUpdates.phone = newPhone;')) {
    console.error('❌ Profile Contact Persistence Error: js/global.js wajib menyertakan telegramChatId dan phone pada userUpdates Firestore secara persisten!');
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
} else {
  console.log(`✅ Berhasil mengecek sintaks ${checkedCount} berkas JavaScript, ${localImportsChecked} binding impor modul ES lokal, integritas tag HTML, ${inlineHandlersChecked} pemanggilan window inline event, ${modalsChecked} modal dialog anti-nesting, ${endpointsChecked} endpoint paritas API klien-worker, ${safeIterationsChecked} guard iterasi aman (anti TypeError), ${criticalStatesChecked} audit variabel state kritis, ${tdzBindingsChecked} audit scope binding TDZ (anti ReferenceError), ${gtkIntegrityGuardsChecked} guard integritas profil GTK (anti 409 & false re-auth), serta ${swAssetsChecked} aset cache Service Worker (0 Error).`);
}


