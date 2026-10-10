import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Synthetic test callers exercise the same same-origin transport as the browser.
export async function transferChunks(base, pid, requestId, file, bytes, prepared, cookie, api) {
  assert.equal(prepared.transport,'chunks');
  assert.equal(prepared.chunkSize,2*1024*1024);
  const query='?projectId='+pid;
  const chunks=[];
  for(let index=0;index<Math.max(1,Math.ceil(bytes.length/prepared.chunkSize));index++) {
    const part=bytes.subarray(index*prepared.chunkSize,(index+1)*prepared.chunkSize);
    const url=base+'/api/markdown-share/chunk'+query+'&requestId='+requestId+'&file='+encodeURIComponent(JSON.stringify(file))+'&ticket='+encodeURIComponent(prepared.ticket)+'&index='+index;
    let receipt;
    for(let attempt=0;attempt<3;attempt++) {
      const r=await fetch(url,{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/octet-stream'},body:part,signal:AbortSignal.timeout(20000)});
      receipt=await r.json().catch(()=>({}));
      if(r.ok)break;
      if(attempt===2)throw new Error('Chunk transfer '+r.status+': '+(receipt.error||''));
    }
    assert.equal(receipt.sha256,sha(part));assert.equal(receipt.size,part.length);assert.equal(receipt.index,index);
    chunks.push({index,sha256:sha(part),size:part.length});
  }
  for(let attempt=0;attempt<3;attempt++) {
    try {await api('/api/markdown-share/seal'+query,{requestId,file,ticket:prepared.ticket,chunks});break;}
    catch(error){if(attempt===2)throw error;}
  }
  return chunks;
}
