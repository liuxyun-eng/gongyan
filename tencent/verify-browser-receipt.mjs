import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const fixture=JSON.parse(await fs.readFile('outputs/tencent-cloud-verification-direct-pass.json','utf8'));
const base=fixture.base,pid=fixture.projectId,postId='b7cade48-8e70-470e-af54-02756fb8f6f7';
const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:fixture.accounts[0].username,password:'Gongyan-Test-Only-20261010'})});
assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];await r.body?.cancel();
const room=await (await fetch(base+'/api/room?projectId='+pid,{headers:{Cookie:cookie}})).json();
assert.ok(room.posts.some(p=>p.id===postId));
const files=room.files.filter(f=>f.post_id===postId);assert.equal(files.length,3);
const checks=[];
for(const file of files) {
  assert.ok(['boundary-20mb.bin','empty.txt','nested/中文.txt'].includes(file.name));
  const local=await fs.readFile('/private/tmp/gongyan-cloud-ui/'+file.name);
  const response=await fetch(base+'/api/files/'+file.id,{headers:{Cookie:cookie}});assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,local.length);
  const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(bytes),sha(local));
  checks.push({name:file.name,size:bytes.length,sha256:sha(bytes)});
}
await fs.writeFile('outputs/tencent-browser-upload-verification.json',JSON.stringify({passed:true,projectId:pid,postId,checks,proof:'outputs/tencent-cloud-browser-upload.png'},null,2)+'\n');
console.log('All three browser-selected files downloaded with identical contents.');
