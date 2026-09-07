import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = join(root, ".local-service");
const pidFile = join(stateDir, "service.pid");
const logFile = join(stateDir, "service.log");
const frontendDir = join(root, "frontend");
const backendDir = join(root, "backend");
const command = process.argv[2] || "start";

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  if (!existsSync(pidFile)) return null;
  const pid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function runBuild() {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: frontendDir,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function startDaemon() {
  const existing = readPid();
  if (existing && isAlive(existing)) {
    console.log(`本地服务已在运行：http://localhost:4180（进程 ${existing}）`);
    return;
  }
  if (existsSync(pidFile)) unlinkSync(pidFile);

  runBuild();
  const daemon = spawn(process.execPath, [fileURLToPath(import.meta.url), "daemon"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  daemon.unref();
  console.log("本地服务已在后台启动：http://localhost:4180");
  console.log(`日志：${logFile}`);
}

function startChild(name, executable, args, cwd, env, log, logFd, children, shouldRestart) {
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ["ignore", logFd, logFd],
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shouldRestart()) return;
    log.write(`[${new Date().toISOString()}] ${name} exited (code=${code}, signal=${signal}); restarting in 2s\n`);
    setTimeout(() => startChild(name, executable, args, cwd, env, log, logFd, children, shouldRestart), 2000).unref();
  });
  return child;
}

function runDaemon() {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(pidFile, `${process.pid}\n`);
  const log = createWriteStream(logFile, { flags: "a" });
  const logFd = openSync(logFile, "a");
  log.write(`\n[${new Date().toISOString()}] local service started (pid=${process.pid})\n`);
  let stopping = false;

  const children = new Set();
  [
    startChild(
      "paper-worker",
      process.execPath,
      ["--experimental-sqlite", join(backendDir, "server", "index.mjs")],
      backendDir,
      { ...process.env, QUANT_PORT: "8810", QUANT_DB_PATH: join(root, "data", "quant.db") },
      log,
      logFd,
      children,
      () => !stopping,
    ),
    startChild(
      "frontend",
      "npm",
      ["run", "start", "--", "--hostname", "127.0.0.1", "--port", "4180"],
      frontendDir,
      { ...process.env, NODE_ENV: "production", QUANT_WORKER_URL: "http://127.0.0.1:8810" },
      log,
      logFd,
      children,
      () => !stopping,
    ),
  ];

  const stop = () => {
    stopping = true;
    log.write(`[${new Date().toISOString()}] local service stopping\n`);
    for (const child of children) child.kill("SIGTERM");
    if (existsSync(pidFile)) unlinkSync(pidFile);
    log.end(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function showStatus() {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    console.log("本地服务未运行。执行：node scripts/local-service.mjs start");
    return;
  }
  const health = await fetch("http://127.0.0.1:8810/api/health")
    .then((response) => (response.ok ? "正常" : `异常 (${response.status})`))
    .catch(() => "未响应");
  const frontend = await fetch("http://127.0.0.1:4180/overview")
    .then((response) => (response.ok ? "正常" : `异常 (${response.status})`))
    .catch(() => "未响应");
  console.log(`前端：${frontend}；模拟盘服务：${health}；守护进程：${pid}`);
}

if (command === "start") startDaemon();
else if (command === "daemon") runDaemon();
else if (command === "status") await showStatus();
else if (command === "stop") {
  const pid = readPid();
  if (pid && isAlive(pid)) process.kill(pid, "SIGTERM");
  console.log(pid ? "已请求停止本地服务。" : "本地服务未运行。");
} else {
  console.error("用法：node scripts/local-service.mjs [start|status|stop]");
  process.exit(1);
}
