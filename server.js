'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const course = require('./course.js');

const rawPort = process.env.PORT;
const PORT = rawPort && Number(rawPort) > 0 ? Number(rawPort) : 4173;
const PUBLIC = path.join(__dirname, 'public');
const WORK = path.join(__dirname, '.work');
const MAX_SOURCE = 60 * 1024;
const MAX_OUTPUT = 20000;
const COMPILE_TIMEOUT = 15000;
const RUN_TIMEOUT = 5000;

fs.mkdirSync(WORK, { recursive: true });

/* ---------------------------------------------------------------- gcc yolu */

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function findGccFrom(dir, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && (e.name === 'gcc.exe' || e.name === 'gcc')) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = findGccFrom(path.join(dir, e.name), depth - 1);
    if (found) return found;
  }
  return null;
}

function locateGcc() {
  const tried = [];
  const explicit = process.env.GCC_PATH;
  if (explicit) {
    tried.push(explicit);
    if (isFile(explicit)) return explicit;
  }
  const common = [
    'gcc.exe',
    'gcc',
    'C:\\msys64\\ucrt64\\bin\\gcc.exe',
    'C:\\msys64\\mingw64\\bin\\gcc.exe',
    'C:\\MinGW\\bin\\gcc.exe',
    'C:\\TDM-GCC-64\\bin\\gcc.exe',
    'C:\\Program Files\\mingw-w64\\bin\\gcc.exe',
  ];
  for (const c of common) {
    tried.push(c);
    if (c.includes('\\') || c.startsWith('/')) {
      if (isFile(c)) return c;
    } else {
      try {
        const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', [c], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).split(/\r?\n/)[0];
        if (which && isFile(which.trim())) return which.trim();
      } catch {
        /* yok */
      }
    }
  }
  const winget = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WinGet',
    'Packages'
  );
  if (fs.existsSync(winget)) {
    for (const e of fs.readdirSync(winget, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (!/WinLibs|mingw|LLVM/i.test(e.name)) continue;
      const found = findGccFrom(path.join(winget, e.name), 5);
      if (found) return found;
    }
  }
  return null;
}

let GCC = null;
function gcc() {
  if (GCC === null) GCC = locateGcc();
  return GCC;
}

function withGccOnPath(binDir) {
  const env = Object.assign({}, process.env);
  const sep = path.delimiter;
  const current = env.PATH || env.Path || '';
  if (binDir && !current.split(sep).includes(binDir)) env.PATH = binDir + sep + current;
  return env;
}

/* ------------------------------------------------------- derleme ve çalıştırma */

function clamp(text) {
  if (text.length > MAX_OUTPUT) {
    return text.slice(0, MAX_OUTPUT) + '\n... [çıktı kırpıldı]';
  }
  return text;
}

function compileAndRun(source, options) {
  const opts = options || {};
  const stdin = typeof opts.stdin === 'string' ? opts.stdin : '';
  const timeout = opts.timeout || RUN_TIMEOUT;
  const flags = opts.flags || ['-std=c17', '-Wall', '-Wextra', '-O0'];

  const cc = gcc();
  if (!cc) {
    return Promise.resolve({
      ok: false,
      stage: 'toolchain',
      message:
        'C derleyicisi (gcc) bulunamadı. Lütfen gcc kurulumunu kontrol edin ya da GCC_PATH değişkenini tanımlayın.',
    });
  }

  const dir = fs.mkdtempSync(path.join(WORK, 'run-'));
  const srcFile = path.join(dir, 'main.c');
  const exeFile = path.join(dir, process.platform === 'win32' ? 'a.exe' : 'a.out');
  fs.writeFileSync(srcFile, source, 'utf8');

  // Testin hazırladığı dosyaları çalışma klasörüne yaz
  if (opts.files && typeof opts.files === 'object') {
    for (const [name, content] of Object.entries(opts.files)) {
      const safe = path.basename(name);
      fs.writeFileSync(path.join(dir, safe), String(content), 'utf8');
    }
  }

  const env = withGccOnPath(path.dirname(cc));
  const started = Date.now();
  const readFiles = opts.readFiles || [];

  const collectFiles = () => {
    const out = {};
    for (const name of readFiles) {
      const safe = path.basename(name);
      try {
        out[safe] = fs.readFileSync(path.join(dir, safe), 'utf8');
      } catch {
        out[safe] = null;
      }
    }
    return out;
  };

  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      setTimeout(() => {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* yoksay */
        }
      }, 500);
      resolve(value);
    };

    const compiler = spawn(cc, flags.concat([srcFile, '-o', exeFile]), { env, cwd: dir, windowsHide: true });
    let compileOut = '';
    compiler.stdout.on('data', (d) => (compileOut += d.toString()));
    compiler.stderr.on('data', (d) => (compileOut += d.toString()));
    compiler.on('error', (err) => finish({ ok: false, stage: 'toolchain', message: String(err.message || err) }));

    const compileTimer = setTimeout(() => {
      try {
        compiler.kill();
      } catch {
        /* yoksay */
      }
      finish({ ok: false, stage: 'compile', message: 'Derleme zaman aşımına uğradı.' });
    }, COMPILE_TIMEOUT);

    compiler.on('close', (code) => {
      clearTimeout(compileTimer);
      if (code !== 0) {
        return finish({
          ok: false,
          stage: 'compile',
          message: clamp(compileOut || 'Derleme hatası.'),
          ms: Date.now() - started,
        });
      }

      const runStart = Date.now();
      const child = spawn(exeFile, opts.args || [], { env, cwd: dir, windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (err += d.toString()));
      child.on('error', (e) =>
        finish({ ok: false, stage: 'run', message: String(e.message || e), ms: Date.now() - runStart })
      );
      if (stdin) child.stdin.write(stdin);
      child.stdin.end();

      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* yoksay */
        }
        finish({
          ok: false,
          stage: 'timeout',
          message: `Program ${Math.round(timeout / 1000)} saniyeden uzun sürdü (sonsuz döngü olabilir).`,
          stdout: clamp(out),
          stderr: clamp(err),
          files: collectFiles(),
          ms: Date.now() - runStart,
        });
      }, timeout);

      child.on('close', (runCode) => {
        clearTimeout(timer);
        finish({
          ok: true,
          exitCode: runCode,
          stdout: clamp(out),
          stderr: clamp(err),
          warnings: compileOut.trim() ? compileOut.trim() : '',
          files: collectFiles(),
          ms: Date.now() - runStart,
        });
      });
    });
  });
}

/* ------------------------------------------------------------------ yardımcılar */

function checkSource(code, test) {
  if (test.source && !new RegExp(test.source).test(code)) {
    return `Kodunda bunu kullanmalısın: ${test.name}`;
  }
  if (test.notSource && new RegExp(test.notSource).test(code)) {
    return `Bunu kullanmamalısın: ${test.name}`;
  }
  return null;
}

function normalize(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 512 * 1024) {
        reject(new Error('İstek gövdesi çok büyük.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Yasak');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bulunamadı');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

/* ---------------------------------------------------------------------- route */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/api/status') {
      return json(res, 200, {
        gcc: gcc(),
        platform: os.platform(),
        course: { lessons: course.lessons.length, exercises: course.exerciseCount },
      });
    }

    if (pathname === '/api/course') {
      const lessons = course.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        level: lesson.level,
        minutes: lesson.minutes,
        goal: lesson.goal,
        blocks: lesson.blocks,
        example: lesson.example,
        exercises: lesson.exercises.map((ex) => ({
          id: ex.id,
          title: ex.title,
          brief: ex.brief,
          starter: ex.starter,
          hint: ex.hint,
          solution: ex.solution,
          testNames: ex.tests.filter((t) => !t.hidden).map((t) => t.name),
          testCount: ex.tests.length,
        })),
      }));
      return json(res, 200, { meta: course.meta, lessons });
    }

    if (pathname === '/api/run' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const code = String(body.code || '');
      if (!code.trim()) return json(res, 400, { ok: false, stage: 'input', message: 'Kaynak kod boş.' });
      if (code.length > MAX_SOURCE) return json(res, 400, { ok: false, stage: 'input', message: 'Kod çok uzun.' });
      const result = await compileAndRun(code, { stdin: body.stdin || '' });
      return json(res, 200, result);
    }

    if (pathname === '/api/check' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const code = String(body.code || '');
      const exercise = course.exerciseIndex[body.exerciseId];
      if (!exercise) return json(res, 404, { ok: false, message: 'Alıştırma bulunamadı.' });
      if (!code.trim()) return json(res, 400, { ok: false, message: 'Önce kodunu yaz.' });
      if (code.length > MAX_SOURCE) return json(res, 400, { ok: false, message: 'Kod çok uzun.' });

      const results = [];
      let passCount = 0;
      let compileFailed = false;

      for (const test of exercise.tests) {
        const sourceIssue = checkSource(code, test);
        if (sourceIssue) {
          results.push({ name: test.name, pass: false, sourceRule: sourceIssue, hidden: !!test.hidden });
          continue;
        }

        const result = await compileAndRun(code, {
          stdin: test.stdin || '',
          timeout: 7000,
          files: test.files,
          readFiles: test.fileCheck ? [test.fileCheck.path] : [],
        });
        if (!result.ok && result.stage === 'compile') {
          compileFailed = true;
          results.push({ name: test.name, pass: false, error: result.message, hidden: !!test.hidden });
          break;
        }
        if (!result.ok && result.stage === 'toolchain') {
          return json(res, 500, { ok: false, message: result.message });
        }
        const actual = normalize(result.stdout || '');
        const expected = normalize(test.expected || '');
        let pass = result.ok && result.exitCode === 0 && actual === expected && !result.stderr.trim();
        let reason;
        if (pass && test.fileCheck) {
          const got = result.files ? result.files[path.basename(test.fileCheck.path)] : null;
          if (got === null || got === undefined) {
            pass = false;
            reason = `Dosya oluşturulamadı: ${test.fileCheck.path}`;
          } else if (normalize(got) !== normalize(test.fileCheck.expected)) {
            pass = false;
            reason = `Dosya içeriği uyuşmuyor (${test.fileCheck.path}):\n${normalize(got)}`;
          }
        }
        if (pass) passCount++;
        results.push({
          name: test.name,
          pass,
          hidden: !!test.hidden,
          expected: test.hidden ? undefined : expected,
          actual: pass || test.hidden ? undefined : actual,
          reason,
          stderr: pass ? undefined : (result.stderr || '').trim().slice(0, 1200),
          timeout: result.stage === 'timeout' ? result.message : undefined,
        });
      }

      const total = exercise.tests.length;
      return json(res, 200, {
        ok: passCount === total && !compileFailed,
        passed: passCount,
        total,
        compileFailed,
        results,
        solved: passCount === total,
      });
    }

    if (pathname === '/api/solution' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const exercise = course.exerciseIndex[body.exerciseId];
      if (!exercise) return json(res, 404, { ok: false, message: 'Alıştırma bulunamadı.' });
      return json(res, 200, { ok: true, solution: exercise.solution, hint: exercise.hint });
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    res.writeHead(405);
    res.end('Method not allowed');
  } catch (err) {
    json(res, 500, { ok: false, message: String((err && err.message) || err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const cc = gcc();
  console.log(`C Kursu hazır: http://127.0.0.1:${PORT}`);
  console.log(cc ? `gcc: ${cc}` : 'gcc: BULUNAMADI');
});