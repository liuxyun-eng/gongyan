import { build } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(project, ".sites-runtime/tencent-static");
await build({ configFile: path.join(project, "tencent/vite.config.ts") });
// The free static-hosting domain cannot forward APIs. Keep its old links usable.
const indexFile = path.join(output, "index.html");
const redirect = '<script>if(location.hostname==="gongyan-d6gqg5jl234d901e6-1503317224.tcloudbaseapp.com")location.replace("https://gongyan-d6gqg5jl234d901e6-1503317224.ap-shanghai.app.tcloudbase.com"+location.pathname+location.search+location.hash);</script>';
await fs.writeFile(indexFile, (await fs.readFile(indexFile,"utf8")).replace("<head>","<head>"+redirect));
// Static hosting does not execute the server router. Give each direct entry a real HTML file.
for (const route of ["login", "share"]) {
  await fs.mkdir(path.join(output, route), { recursive: true });
  await fs.copyFile(path.join(output, "index.html"), path.join(output, route, "index.html"));
}
await fs.copyFile(path.join(output, "index.html"), path.join(output, "404.html"));
const archive = path.join(project, "outputs/gongyan-tencent-static.zip");
await fs.mkdir(path.dirname(archive), { recursive: true });
await fs.rm(archive, { force: true });
const result = spawnSync("zip", ["-qr", archive, "."], { cwd: output, stdio: "inherit" });
if (result.status !== 0) throw new Error("Static archive creation failed");
console.log("Tencent static deployment archive:", archive);
