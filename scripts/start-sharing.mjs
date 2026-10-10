import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const processes = [
  spawn(
    process.execPath,
    [
      "scripts/run-framework.mjs",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
    ],
    { cwd: app, stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      "integrations/codex/upload-panel.mjs",
      "--port",
      "6062",
      "--workspace",
      resolve(app, ".."),
    ],
    { cwd: app, stdio: "inherit" },
  ),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const process of processes) process.kill("SIGTERM");
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
for (const child of processes) {
  child.once("error", (error) => {
    console.error("无法启动共研：" + error.message);
    process.exitCode = 1;
    stop();
  });
  child.once("exit", (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
  });
}
console.log("共享工作区：http://127.0.0.1:5173/");
console.log("粘贴 Markdown 分享：http://127.0.0.1:6062/");
