import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
const fixture=JSON.parse(await fs.readFile('outputs/tencent-cloud-verification.json','utf8'));
const base=fixture.base,pid=fixture.projectId,sha=b=>createHash('sha256').update(b).digest('hex');
let cookie;
async function api(path,method='GET',data) {
 const response=await fetch(base+path,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 return {response,data:await response.json().catch(()=>({}))};
}
const login=await api('/api/auth/login','POST',{username:fixture.accounts[0].username,password:'Gongyan-Test-Only-20261010'});assert.equal(login.response.status,200);cookie=login.response.headers.get('set-cookie').split(';')[0];
const room=await api('/api/room?projectId='+pid);
const post=room.data.posts.find(p=>p.id===fixture.postId);assert.ok(post);
const removed=await api('/api/posts/'+post.id,'DELETE',{revision:sha(post.transcript)});assert.equal(removed.response.status,200);
const duplicate=await api('/api/posts/'+post.id,'DELETE',{revision:sha(post.transcript)});assert.equal(duplicate.response.status,200);
const refreshed=await api('/api/room?projectId='+pid);assert.ok(!refreshed.data.posts.some(p=>p.id===post.id));
const markdown='# 云端验收\n\n## User\n帮我检查工作目录。\n\n## Assistant\n已完成。公式：$E=mc^2$。\n';
const retry=await api('/api/markdown-share?projectId='+pid,'POST',{requestId:fixture.requestId,title:'云端验收',markdown,files:fixture.files});assert.equal(retry.response.status,410);
const requestId=randomUUID(),file={id:randomUUID(),name:'checksum-test.txt',reference:'./checksum-test.txt',size:4,sha256:sha('good')};
const prepared=await api('/api/markdown-share/prepare?projectId='+pid,'POST',{requestId,file});assert.equal(prepared.response.status,200);
const ticket=prepared.data.ticket;
const bad=await fetch(base+'/api/markdown-share/chunk?projectId='+pid+'&requestId='+requestId+'&file='+encodeURIComponent(JSON.stringify(file))+'&ticket='+encodeURIComponent(ticket)+'&index=0',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/octet-stream'},body:'evil'});assert.equal(bad.status,200);await bad.body?.cancel();
const seal=await api('/api/markdown-share/seal?projectId='+pid,'POST',{requestId,file,ticket,chunks:[{index:0,size:4,sha256:sha('evil')}]});assert.ok(!seal.response.ok);
const verify=await api('/api/markdown-share/verify?projectId='+pid,'POST',{requestId,file,ticket});assert.ok(!verify.response.ok);
const publish=await api('/api/markdown-share?projectId='+pid,'POST',{requestId,title:'corruption test',markdown:'## User\n测试。\n\n## Assistant\n测试。',files:[file]});assert.equal(publish.response.status,409);
await fs.writeFile('outputs/tencent-deletion-and-corruption-verification.json',JSON.stringify({passed:true,authorDelete:200,repeatedDelete:200,deletedContentRepublish:410,corruptFilePublish:409},null,2)+'\n');
console.log('Author deletion persists; retry cannot resurrect it; corrupt bytes cannot publish.');
