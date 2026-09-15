#!/usr/bin/env node
/**
 * 一键启动脚本（AC-1）。
 *
 * 只使用 Node 内置模块，跨平台（Windows / macOS / Linux）：
 *   1. 解析 Python 解释器（优先 TD_PYTHON，其次仓库内 .venv，再次任务信封提供的 venv，最后 PATH 上的 python）
 *   2. 若 client/node_modules 缺失，自动执行 npm install（保证「真正一键」）
 *   3. 并发拉起后端 uvicorn(:8000) 与前端 vite(:5173)，输出带前缀
 *   4. 任一子进程退出 / Ctrl+C → 一并回收（Windows 下用 taskkill /T 杀进程树；
 *      并额外回收 uvicorn --reload 派生的孙进程，避免父进程先退时端口残留）
 *
 * 用法：
 *   npm run dev                # 前后端一起起
 *   npm run dev:server         # 只起后端
 *   npm run dev:client         # 只起前端
 *   npm run setup              # 只确保依赖就绪，不起服务
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const SERVER_DIR = path.join(ROOT, 'server');
const IS_WIN = process.platform === 'win32';

const flags = new Set(process.argv.slice(2));
const SERVER_ONLY = flags.has('--server-only');
const CLIENT_ONLY = flags.has('--client-only');
const SETUP_ONLY = flags.has('--setup-only');
const RELOAD = !flags.has('--no-reload') && process.env.TD_NO_RELOAD !== '1';

const BACKEND_PORT = 8000;
const FRONTEND_PORT = 5173;

const log = (tag, msg) => process.stdout.write(`[${tag}] ${msg}\n`);
const warn = (tag, msg) => process.stderr.write(`[${tag}] ${msg}\n`);

/** 解析可用的 Python 解释器。 */
function resolvePython() {
  const candidates = [];
  if (process.env.TD_PYTHON) candidates.push(process.env.TD_PYTHON);
  candidates.push(
    IS_WIN ? path.join(ROOT, '.venv', 'Scripts', 'python.exe') : path.join(ROOT, '.venv', 'bin', 'python'),
  );
  // 任务信封提供的 venv：与本仓库同级目录 artifacts/.venv（相对路径，便于整目录搬迁）
  candidates.push(
    IS_WIN
      ? path.join(ROOT, '..', 'artifacts', '.venv', 'Scripts', 'python.exe')
      : path.join(ROOT, '..', 'artifacts', '.venv', 'bin', 'python'),
  );
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return IS_WIN ? 'python' : 'python3';
}

/** 探测解释器是否具备后端依赖；缺失只告警不阻断（便于用户自行修复）。 */
function probeBackendDeps(python) {
  const probe = spawnSync(
    python,
    ['-c', 'import fastapi, uvicorn, sqlalchemy, pydantic; print("deps-ok")'],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0 || !String(probe.stdout).includes('deps-ok')) {
    warn('setup', `解释器 ${python} 上未找到后端依赖（fastapi/uvicorn/sqlalchemy/pydantic）。`);
    warn('setup', `修复方式： "${python}" -m pip install -r "${path.join(SERVER_DIR, 'requirements.txt')}"`);
    warn('setup', '或设置环境变量 TD_PYTHON 指向已就绪的解释器后重跑 npm run dev。');
    return false;
  }
  return true;
}

/** 确保前端依赖就绪；缺失则自动安装（AC-1「真正一键」）。 */
function ensureClientDeps() {
  const viteBin = path.join(CLIENT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  if (existsSync(viteBin)) return true;
  log('setup', 'client/node_modules 缺失，正在执行 npm install（首次较慢）…');
  const npmCmd = IS_WIN ? 'npm.cmd' : 'npm';
  const res = spawnSync(npmCmd, ['install', '--no-audit', '--no-fund'], {
    cwd: CLIENT_DIR,
    stdio: 'inherit',
    shell: true,
  });
  if (res.status !== 0 || !existsSync(viteBin)) {
    warn('setup', 'npm install 失败，无法启动前端。请手工在 client/ 下执行 npm install 后重试。');
    return false;
  }
  log('setup', '前端依赖安装完成。');
  return true;
}

const children = [];

/**
 * uvicorn --reload 会派生「reloader → worker」两层子进程。Windows 上「杀父不杀孙」，
 * 且 Ctrl+C 会把 CTRL_C_EVENT 广播给同控制台的所有进程（父进程可能先于我们的回收动作而退出）。
 * 故从后端启动日志里记录这两个 PID，退出时按 PID 直接回收，杜绝 8000 端口残留
 * —— 残留会让用户第二次 `npm run dev` 直接撞端口冲突（AC-1 可用性缺陷）。
 */
const backendPids = new Set();
const BACKEND_PID_RE = /Started (?:reloader|server) process \[(\d+)\]/;

function trackBackendLine(line) {
  const match = BACKEND_PID_RE.exec(line);
  if (match) backendPids.add(Number(match[1]));
}

function pipeWithPrefix(child, tag, onLine) {
  const forward = (stream, isErr) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        (isErr ? process.stderr : process.stdout).write(`[${tag}] ${line}\n`);
        if (onLine) onLine(line);
        idx = buffer.indexOf('\n');
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) (isErr ? process.stderr : process.stdout).write(`[${tag}] ${buffer}\n`);
    });
  };
  forward(child.stdout, false);
  forward(child.stderr, true);
}

/**
 * 树级回收单个子进程。
 * 刻意**不**因「直接子进程已退出」而提前返回：Ctrl+C / 外部 kill 可能先把父进程干掉，
 * 此时 taskkill 找不到父进程，需依赖 killTrackedBackendPids() 兜底回收孙进程。
 */
function killTree(child) {
  if (!child || child.pid == null) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      /* 忽略 */
    }
  }
}

/** 回收记录到的 uvicorn reloader / worker（父进程先退、taskkill /T 触达不到时的兜底）。 */
function killTrackedBackendPids() {
  if (!IS_WIN) return;
  for (const pid of backendPids) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  }
}

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return; // 幂等：Ctrl+C 与子进程 exit 可能几乎同时触发
  shuttingDown = true;
  for (const child of children) killTree(child);
  killTrackedBackendPids();
  process.exit(code);
}

function registerChild(child, tag, name, onLine) {
  children.push(child);
  pipeWithPrefix(child, tag, onLine);
  child.on('exit', (code, signal) => {
    log(tag, `${name} 退出（code=${code ?? 'null'} signal=${signal ?? 'null'}），正在回收其余进程…`);
    shutdown(code ?? 1);
  });
  child.on('error', (err) => {
    warn(tag, `${name} 启动失败：${err.message}`);
    shutdown(1);
  });
}

const python = resolvePython();
probeBackendDeps(python);

if (!SERVER_ONLY) {
  if (!ensureClientDeps()) shutdown(1);
}

if (SETUP_ONLY) {
  log('setup', '依赖就绪检查完成（--setup-only，不启动服务）。');
  process.exit(0);
}

log('dev', `仓库根：${ROOT}`);
log('dev', `Python：${python}`);

if (!CLIENT_ONLY) {
  const uvicornArgs = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)];
  if (RELOAD) uvicornArgs.push('--reload');
  log('dev', `启动后端：${python} ${uvicornArgs.join(' ')}（cwd=server）`);
  const backend = spawn(python, uvicornArgs, {
    cwd: SERVER_DIR,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  registerChild(backend, 'backend', '后端 uvicorn', trackBackendLine);
}

if (!SERVER_ONLY) {
  const viteBin = path.join(CLIENT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  log('dev', `启动前端：${process.execPath} ${viteBin}（端口 ${FRONTEND_PORT}）`);
  const frontend = spawn(process.execPath, [viteBin, '--port', String(FRONTEND_PORT), '--strictPort'], {
    cwd: CLIENT_DIR,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  registerChild(frontend, 'frontend', '前端 vite');
}

process.on('SIGINT', () => {
  log('dev', '收到 Ctrl+C，正在关闭…');
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));
// Windows 下 Ctrl+Break（以及程序化 CTRL_BREAK_EVENT）对应的信号，等价走同一关闭路径。
process.on('SIGBREAK', () => {
  log('dev', '收到 SIGBREAK，正在关闭…');
  shutdown(0);
});

setTimeout(() => {
  if (!CLIENT_ONLY) log('dev', `后端就绪 → http://127.0.0.1:${BACKEND_PORT}（健康检查 /api/health，配置 /api/config）`);
  if (!SERVER_ONLY) log('dev', `前端就绪 → http://localhost:${FRONTEND_PORT} （开发代理 /api → 127.0.0.1:${BACKEND_PORT}）`);
  log('dev', '按 Ctrl+C 结束。');
}, 1200);
