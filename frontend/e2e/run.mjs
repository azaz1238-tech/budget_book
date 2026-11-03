// 화면 점검 실행기. 빌드한 화면을 임시 DB와 빈 포트의 서버로 띄워 점검한다.
// 실제 budget.db와 이미 켜 둔 서버는 건드리지 않는다.
// 사용법: npm --prefix frontend run e2e

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const isWindows = process.platform === "win32";
const python = path.join(root, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");
const SUITES = ["mobile.cjs", "regress.cjs"];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, server) {
  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode !== null) throw new Error("서버가 시작하지 못했습니다.");
    try {
      await fetch(`${url}/api/categories`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("서버 응답을 기다리다 시간이 지났습니다.");
}

// Windows의 .venv python은 실제 python을 자식으로 띄우므로 프로세스 묶음째 끝낸다.
function stopServer(server) {
  if (isWindows) spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
}

async function runSuite(suite) {
  const dir = mkdtempSync(path.join(tmpdir(), "budget-e2e-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(python, ["-m", "uvicorn", "app.main:app", "--port", String(port), "--log-level", "warning"], {
    cwd: root,
    env: { ...process.env, BUDGET_DB_PATH: path.join(dir, "budget.db") },
    stdio: "inherit",
  });
  let status = 1;
  try {
    await waitForServer(url, server);
    console.log(`\n=== ${suite} ===`);
    status = spawnSync(process.execPath, [path.join(here, suite), url, dir], { stdio: "inherit" }).status;
  } finally {
    stopServer(server);
  }
  // 실패하면 스크린샷을 볼 수 있게 임시 폴더를 남긴다.
  if (status === 0) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  else console.log(`결과 파일: ${dir}`);
  return status;
}

if (!existsSync(python)) {
  console.error(`가상환경의 Python을 찾을 수 없습니다: ${python}`);
  process.exit(2);
}

let failed = false;
for (const suite of SUITES) {
  if ((await runSuite(suite)) !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
