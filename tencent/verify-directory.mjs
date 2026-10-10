import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {transferChunks} from './test-upload.mjs';
const state=JSON.parse(await fs.readFile('outputs/tencent-cloud-verification.json','utf8'));
const base=state.base, pid=state.projectId, requestId=randomUUID();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let cookie;
async function api(path,data) {
  const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
  const value=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error('API '+response.status+': '+(value.error||'failed'));
  return {value,response};
}
const login=await api('/api/auth/login',{username:state.accounts[0].username,password:'Gongyan-Test-Only-20261010'});
cookie=login.response.headers.get('set-cookie').split(';')[0];
const manifests=[],contents=[];
for(let i=0;i<500;i++) {
  const bytes=i===499?Buffer.alloc(0):Buffer.from('文件 '+i+'\n');
  contents.push(bytes);manifests.push({id:randomUUID(),name:'folder-'+Math.floor(i/50)+'/file-'+i+'.txt',reference:'./folder-'+Math.floor(i/50)+'/file-'+i+'.txt',size:bytes.length,sha256:sha(bytes)});
}
async function parallel(items,fn,workers=4){let next=0;await Promise.all(Array.from({length:workers},async()=>{while(next<items.length){const index=next++;await fn(items[index],index)}}));}
let uploaded=0,downloaded=0;
const started=Date.now();
try {
 await parallel(manifests,async(file,i)=>{
   let failed;
   for(let attempt=0;attempt<3;attempt++) {
     try {
       const {value:p}=await api('/api/markdown-share/prepare?projectId='+pid,{requestId,file});
       if(!p.verified) {
         await transferChunks(base,pid,requestId,file,contents[i],p,cookie,api);
         const {value:r}=await api('/api/markdown-share/verify?projectId='+pid,{requestId,file,ticket:p.ticket});
         assert.equal(r.verified,true);assert.equal(r.sha256,file.sha256);assert.equal(r.size,file.size);
       }
       failed=null;break;
     }catch(error){failed=error}
   }
   if(failed)throw failed;
   uploaded++;if(uploaded%50===0)console.log('Verified '+uploaded+'/500 files');
 });
 const payload={requestId,markdown:'# 完整目录验收\n\n## User\n分享全部文件。\n\n## Assistant\n目录中 500 个文件，包含空文件和子目录。',title:'500 文件完整目录验收',files:manifests};
 const {value:published}=await api('/api/markdown-share?projectId='+pid,payload);assert.equal(published.files.length,500);assert.equal(published.verified,true);
 const {value:retry}=await api('/api/markdown-share?projectId='+pid,payload);assert.equal(retry.postId,published.postId);
 await parallel(manifests,async(file)=>{
   const redirect=await fetch(base+'/api/files/'+file.id,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(redirect.status,302);
   const response=await fetch(redirect.headers.get('location'));assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);
   downloaded++;if(downloaded%100===0)console.log('Downloaded and checked '+downloaded+'/500 files');
 });
 await fs.writeFile('outputs/tencent-directory-verification.json',JSON.stringify({passed:true,projectId:pid,requestId,postId:published.postId,uploaded,downloaded,elapsedMs:Date.now()-started},null,2)+'\n');
 console.log('Complete: all 500 actual storage uploads and downloads match.');
}catch(error){await fs.writeFile('outputs/tencent-directory-verification.json',JSON.stringify({passed:false,projectId:pid,requestId,uploaded,downloaded,failure:error.message},null,2)+'\n');console.error(error.message);process.exitCode=1}
