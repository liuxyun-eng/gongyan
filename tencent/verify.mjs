import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { transferChunks } from './test-upload.mjs';
const base='https://gongyan-d6gqg5jl234d901e6-1503317224.ap-shanghai.app.tcloudbase.com';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const results=[];
const report={base,createdAt:new Date().toISOString(),checks:results,accounts:[],projectId:null};
async function call(path,method='GET',data,cookie,extra={}) {
  const headers={...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:base}: {}),...extra};
  const raw=data instanceof Uint8Array;
  if(data!==undefined) headers['Content-Type']=raw?'application/octet-stream':'application/json';
  const start=Date.now();
  const response=await fetch(base+path,{method,headers,body:data===undefined?undefined:raw?data:JSON.stringify(data),signal:AbortSignal.timeout(35000)});
  const text=await response.text();let json;try{json=JSON.parse(text)}catch{json={error:text.slice(0,160)}}
  return {status:response.status,data:json,cookie:response.headers.get('set-cookie')?.split(';')[0],ms:Date.now()-start};
}
function ok(label,r,status=200) { assert.equal(r.status,status,`${label}: status=${r.status}, ${JSON.stringify(r.data)}`);results.push({check:label,status:r.status,ms:r.ms});console.log(label, r.status,r.ms+'ms');return r.data; }
try {
  ok('cloud ready',await call('/health'));
  assert.equal((await call('/api/projects')).status,401);
  assert.equal((await call('/api/projects','GET',undefined,undefined,{'X-OpenAI-User-Id':'fake','X-OpenAI-User-Email':'fake@example.com'})).status,401);
  const tag=randomBytes(4).toString('hex');
  const users=[];
  for(const role of ['owner','member','outsider']) {
    const username='gy.verify.'+role+'.'+tag;
    // Public, disposable fixture password; these accounts are removed after browser verification.
    const r=await call('/api/auth/register','POST',{username,password:'Gongyan-Test-Only-20261010',name:'验收 '+role});
    const user=ok('register '+role,r,201).user;
    assert.ok(r.cookie);users.push({...user,cookie:r.cookie,username});report.accounts.push({...user,username});
  }
  const [a,b,c]=users;
  ok('session identity',await call('/api/auth/me','GET',undefined,a.cookie));
  const login=await call('/api/auth/login','POST',{username:a.username,password:'Gongyan-Test-Only-20261010'});ok('existing account login',login);assert.ok(login.cookie);
  assert.equal((await call('/api/auth/login','POST',{username:a.username,password:'wrong-password'})).status,401);
  assert.equal((await call('/api/projects','POST',{name:'CSRF'},a.cookie,{Origin:'https://wrong.example'})).status,403);
  const created=ok('create workspace',await call('/api/projects','POST',{name:'云端验收 · 临时',description:'仅含合成测试数据'},a.cookie),201);
  report.projectId=created.id;
  const room=ok('workspace persisted',await call('/api/room?projectId='+created.id,'GET',undefined,a.cookie));
  assert.equal((await call('/api/room?projectId='+created.id,'GET',undefined,c.cookie)).status,403);
  ok('member accepts invite',await call('/api/join','POST',{code:room.project.invite_code},b.cookie));
  ok('duplicate invite is idempotent',await call('/api/join','POST',{code:room.project.invite_code},b.cookie));
  report.requestId=randomUUID();
  const bytesList=[Buffer.from('中文与换行\nUTF-8 integrity\n'),Buffer.alloc(0),randomBytes(20*1024*1024)];
  const manifest=bytesList.map((bytes,i)=>({id:randomUUID(),name:['nested/中文.txt','empty.txt','boundary-20mb.bin'][i],reference:'./'+['nested/中文.txt','empty.txt','boundary-20mb.bin'][i],size:bytes.length,sha256:sha(bytes)}));
  report.files=manifest;
  const markdown='# 云端验收\n\n## User\n帮我检查工作目录。\n\n## Assistant\n已完成。公式：$E=mc^2$。\n';
  const publish={requestId:report.requestId,title:'云端验收',markdown,files:manifest};
  assert.equal((await call('/api/markdown-share?projectId='+created.id,'POST',publish,a.cookie)).status,409);
  for(const [i,file] of manifest.entries()) {
    const prepared=ok('prepare '+file.name,await call('/api/markdown-share/prepare?projectId='+created.id,'POST',{requestId:report.requestId,file},a.cookie));
    await transferChunks(base,created.id,report.requestId,file,bytesList[i],prepared,a.cookie,async(path,data)=>ok('seal '+file.name,await call(path,'POST',data,a.cookie)));
    const r=await call('/api/markdown-share/verify?projectId='+created.id,'POST',{requestId:report.requestId,file,ticket:prepared.ticket},a.cookie);
    const receipt=ok('upload '+file.name,r);
    assert.equal(receipt.sha256,file.sha256);assert.equal(receipt.size,file.size);assert.equal(receipt.verified,true);
  }
  const published=ok('publish only after all verified',await call('/api/markdown-share?projectId='+created.id,'POST',publish,a.cookie),201);
  report.postId=published.postId;
  assert.equal(published.files.length,3);
  ok('lost response retry has one post',await call('/api/markdown-share?projectId='+created.id,'POST',publish,a.cookie));
  const memberRoom=ok('second account reads conversation',await call('/api/room?projectId='+created.id,'GET',undefined,b.cookie));
  assert.equal(memberRoom.posts.length,1);assert.equal(memberRoom.files.length,3);
  for(const file of manifest) {
    const response=await fetch(base+'/api/files/'+file.id,{headers:{Cookie:b.cookie}});
    assert.equal(response.status,200);const downloaded=new Uint8Array(await response.arrayBuffer());assert.equal(downloaded.length,file.size);assert.equal(sha(downloaded),file.sha256);
    assert.equal((await call('/api/files/'+file.id,'GET',undefined,c.cookie)).status,403);
    results.push({check:'member download hash '+file.name,status:200});console.log('download hash',file.name,'OK');
  }
  const revision=sha(memberRoom.posts[0].transcript);
  assert.equal((await call('/api/posts/'+published.postId+'/messages','DELETE',{index:0,revision},b.cookie)).status,403);
  ok('author deletes one message',await call('/api/posts/'+published.postId+'/messages','DELETE',{index:0,revision},a.cookie));
  const changed=ok('deletion persists to second account',await call('/api/room?projectId='+created.id,'GET',undefined,b.cookie));
  assert.equal(JSON.parse(changed.posts[0].transcript).length,JSON.parse(memberRoom.posts[0].transcript).length-1);
  assert.equal((await call('/api/posts/'+published.postId+'/messages','DELETE',{index:0,revision},a.cookie)).status,409);
  assert.equal((await call('/api/posts/'+published.postId,'DELETE',{revision:sha(changed.posts[0].transcript)},b.cookie)).status,403);
  report.passed=true;
} catch(error) { report.passed=false;report.failure=error.message;console.error(error.message);process.exitCode=1; }
await fs.mkdir('outputs',{recursive:true});
await fs.writeFile('outputs/tencent-cloud-verification.json',JSON.stringify(report,null,2)+'\n');
