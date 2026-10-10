import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(project,'.sites-runtime/tencent-function');
await fs.mkdir(out,{recursive:true});
await build({entryPoints:[path.join(project,'tencent/server/index.ts')],outfile:path.join(out,'index.mjs'),bundle:true,platform:'node',format:'esm',target:'node20',alias:{'cloudflare:workers':path.join(project,'tencent/server/runtime.mjs'),'next/headers':path.join(project,'tencent/server/context.mjs'),'next/navigation':path.join(project,'tencent/server/context.mjs'),'@':project}});
await fs.copyFile(path.join(project,'.sites-runtime/tencent-static/index.html'),path.join(out,'index.html'));
await fs.cp(path.join(project,'.sites-runtime/tencent-static/assets'),path.join(out,'assets'),{recursive:true});
await fs.copyFile(path.join(project,'public/favicon.svg'),path.join(out,'favicon.svg'));
for (const name of await fs.readdir(path.join(out,'assets'))) {
  if (/\.(js|css)$/.test(name)) await fs.writeFile(path.join(out,'assets',name+'.gz'),gzipSync(await fs.readFile(path.join(out,'assets',name))));
}
await fs.writeFile(path.join(out,'scf_bootstrap'),'#!/bin/sh\ncd /var/user\nexec node index.mjs\n',{mode:0o755});
await fs.chmod(path.join(out,'scf_bootstrap'),0o755);
await fs.writeFile(path.join(out,'package.json'),'{"name":"gongyan-backend","private":true,"type":"module"}\n');
console.log('Tencent HTTP function built.');
