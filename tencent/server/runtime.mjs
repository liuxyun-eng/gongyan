import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { context } from './context.mjs';
import { Database } from './database.mjs';

const gateway = () => `https://${process.env.CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com`;
export async function cloudFetch(path, options = {}) {
  if (!process.env.CLOUDBASE_APIKEY) throw new Error('Storage/database credentials are unavailable');
  const headers = new Headers(options.headers);
  headers.set('Authorization', 'Bearer ' + process.env.CLOUDBASE_APIKEY);
  const response = await fetch(gateway() + path, { ...options, headers, signal: AbortSignal.timeout(14000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('CloudBase resource request failed: ' + response.status);
  }
  return response;
}
export const database = new Database(async (name, input) => {
  const response = await cloudFetch('/v1/rdb/rest/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  return response.json();
});
const bucketName = 'gongyan-files';
const objectPath = key => '/' + bucketName + '/' + key.split('/').map(encodeURIComponent).join('/');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ticketSignature = data => createHmac('sha256', process.env.AUTH_PEPPER).update(data).digest('base64url');
function decodeTicket(key, signature, ticket) {
  const [payload, mac] = ticket.split('.');
  const actual = Buffer.from(mac || ''), expected = Buffer.from(ticketSignature(payload || ''));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid upload ticket');
  const data = JSON.parse(Buffer.from(payload,'base64url').toString());
  if (data.key !== key || data.signature !== signature || data.expires < Date.now() || !/^staging\/[a-f0-9-]{36}$/.test(data.stage) || !/^verified\/[a-f0-9-]{36}$/.test(data.physicalKey)) throw new Error('Upload ticket mismatch or expiry');
  return data;
}
async function registerObject(key, physicalKey, size, signature, hash) {
  const folder = key.slice(0, key.lastIndexOf('/') + 1);
  const result = await database.prepare('INSERT INTO stored_objects(object_key,physical_key,folder,size,signature,sha256) VALUES (?,?,?,?,?,?) ON CONFLICT(object_key) DO UPDATE SET physical_key=excluded.physical_key WHERE stored_objects.signature=excluded.signature AND stored_objects.sha256=excluded.sha256 AND stored_objects.size=excluded.size')
    .bind(key, physicalKey, folder, size, signature, hash).run();
  if (!result.meta.changes) throw new Error('Object receipt conflict');
  context.getStore().objectFolders.delete(folder);
}
export const storage = {
  async prepareUpload(key, file, signature) {
    const stage = 'staging/' + randomUUID();
    const payload = Buffer.from(JSON.stringify({ stage, key, signature, chunks: true, physicalKey: 'verified/' + randomUUID(), expires: Date.now() + 60*60*1000 })).toString('base64url');
    // Same-origin chunks work with the free gateway's body limit and all browsers.
    // No hidden cross-site page, browser storage credential or CORS exception.
    return { transport: 'chunks', chunkSize: 2*1024*1024, ticket: payload + '.' + ticketSignature(payload) };
  },
  async uploadChunk(key, file, signature, ticket, index, bytes) {
    const data = decodeTicket(key, signature, ticket);
    const count = Math.max(1, Math.ceil(file.size/(2*1024*1024)));
    const expectedSize = Math.min(2*1024*1024, file.size-index*2*1024*1024);
    if (!data.chunks || !Number.isSafeInteger(index) || index<0 || index>=count || bytes.length!==expectedSize) throw new Error('Invalid upload chunk');
    const hash = sha(bytes), partKey = data.stage+'/'+index+'-'+hash;
    try {
      await cloudFetch('/v1/storages/object' + objectPath(partKey), {method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});
    } catch {
      // Immutable, content-addressed parts make a lost-response retry safe.
      const existing = await cloudFetch('/v1/storages/object/authenticated' + objectPath(partKey), {method:'HEAD'});
      if (Number(existing.headers.get('content-length'))!==bytes.length) throw new Error('Chunk size mismatch');
    }
    return {index,sha256:hash,size:bytes.length};
  },
  async sealUpload(key, signature, ticket, file, parts) {
    const data = decodeTicket(key, signature, ticket);
    if (data.chunks) {
      // Retry can observe a completed upload even if its acknowledgement was lost.
      const head = await fetch(gateway()+'/v1/storages/object/authenticated'+objectPath(data.physicalKey),{method:'HEAD',headers:{Authorization:'Bearer '+process.env.CLOUDBASE_APIKEY}});
      if (head.ok) return;
      await head.body?.cancel();
      const count=Math.max(1,Math.ceil(file.size/(2*1024*1024)));
      if (!Array.isArray(parts) || parts.length!==count || parts.some((p,i)=>p.index!==i || !/^[a-f0-9]{64}$/.test(p.sha256) || p.size!==Math.min(2*1024*1024,file.size-i*2*1024*1024))) throw new Error('Incomplete chunk manifest');
      if(file.size===0) {
        const response=await cloudFetch('/v1/storages/object/authenticated'+objectPath(data.stage+'/0-'+parts[0].sha256));
        const empty=Buffer.from(await response.arrayBuffer());
        if(empty.length || sha(empty)!==file.sha256 || parts[0].sha256!==file.sha256)throw new Error('Empty file checksum mismatch');
        await cloudFetch('/v1/storages/object'+objectPath(data.physicalKey),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:empty});
        return;
      }
      // Stream assembly overlaps reads and writes inside the free 3-second limit.
      // The private destination is exposed only by the separate read-back check.
      const responses=parts.map(p=>cloudFetch('/v1/storages/object/authenticated'+objectPath(data.stage+'/'+p.index+'-'+p.sha256)).then(response=>({response}),error=>({error})));
      async function* assembled() {
        const hash=createHash('sha256');let size=0;
        for(let i=0;i<parts.length;i++) {
          const result=await responses[i];if(result.error)throw result.error;
          const bytes=Buffer.from(await result.response.arrayBuffer());
          if(bytes.length!==parts[i].size || sha(bytes)!==parts[i].sha256)throw new Error('Chunk checksum mismatch');
          hash.update(bytes);size+=bytes.length;yield bytes;
        }
        if(size!==file.size || hash.digest('hex')!==file.sha256)throw new Error('Assembled file checksum mismatch');
      }
      await cloudFetch('/v1/storages/object'+objectPath(data.physicalKey),{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(file.size)},body:assembled(),duplex:'half'});
      return;
    }
    try {
      await cloudFetch('/v1/storages/object/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bucketId: bucketName, sourceKey: data.stage, destinationKey: data.physicalKey }) });
    } catch {
      // A lost response may leave the immutable copy complete. Confirm its existence.
      await cloudFetch('/v1/storages/object/authenticated' + objectPath(data.physicalKey), {method:'HEAD'});
    }
  },
  async verifyUpload(key, file, signature, ticket) {
    const data = decodeTicket(key, signature, ticket);
    const response = await cloudFetch('/v1/storages/object/authenticated' + objectPath(data.physicalKey));
    if (Number(response.headers.get('content-length')) > 20*1024*1024) { await response.body?.cancel(); throw new Error('Uploaded file too large'); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== file.size || sha(bytes) !== file.sha256) throw new Error('Uploaded file checksum mismatch');
    // The browser token only controls staging. Verify a separate immutable copy,
    // then atomically expose its receipt; races can never mutate published bytes.
    await registerObject(key, data.physicalKey, bytes.length, signature, file.sha256);
  },
  async head(key) {
    const state = context.getStore();
    const prefix = key.slice(0, key.lastIndexOf('/') + 1);
    if (!state.objectFolders.has(prefix)) {
      const rows = await database.prepare('SELECT object_key,size,signature,sha256 FROM stored_objects WHERE folder=?').bind(prefix).all();
      state.objectFolders.set(prefix, new Map(rows.results.map(row => [row.object_key, row])));
    }
    const row = state.objectFolders.get(prefix).get(key);
    return row ? { size: row.size, customMetadata: { signature: row.signature, sha256: row.sha256 } } : null;
  },
  async put(key, bytes, options = {}) {
    // Every object receipt is persisted only after a complete storage read-back matches.
    const metadata = options.customMetadata || {};
    const hash = sha(bytes);
    const physicalKey = 'verified/' + randomUUID();
    await cloudFetch('/v1/storages/object' + objectPath(physicalKey), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'x-metadata': Buffer.from(JSON.stringify(metadata)).toString('base64') }, body: bytes });
    const response = await cloudFetch('/v1/storages/object/authenticated' + objectPath(physicalKey));
    const saved = new Uint8Array(await response.arrayBuffer());
    if (saved.length !== bytes.length || sha(saved) !== hash) throw new Error('Storage verification failed');
    await registerObject(key, physicalKey, bytes.length, metadata.signature || '', hash);
    const state = context.getStore();
    state.savedObjects.set(key, saved);
  },
  async get(key) {
    const cached = context.getStore().savedObjects.get(key);
    if (cached) return { size: cached.length, body: cached, async arrayBuffer() { return cached.buffer; } };
    const row = await database.prepare('SELECT size,coalesce(physical_key,object_key) AS physical_key FROM stored_objects WHERE object_key=?').bind(key).first();
    if (!row) return null;
    const response = await cloudFetch('/v1/storages/object/authenticated' + objectPath(row.physical_key));
    return { size: row.size, body: response.body, async arrayBuffer() { return response.arrayBuffer(); } };
  },
  async signedDownload(key, name) {
    const row = await database.prepare('SELECT coalesce(physical_key,object_key) AS physical_key FROM stored_objects WHERE object_key=?').bind(key).first();
    if (!row) throw new Error('Stored file is unavailable');
    const response = await cloudFetch('/v1/storages/object/sign' + objectPath(row.physical_key), { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expiresIn:60}) });
    const data = await response.json();
    if (typeof data.signedURL !== 'string') throw new Error('Download authorization failed');
    const target = new URL(data.signedURL, gateway() + '/v1/storages/');
    if (target.hostname !== new URL(gateway()).hostname) throw new Error('Unexpected storage destination');
    if (target.pathname.startsWith('/object/')) target.pathname = '/v1/storages' + target.pathname;
    target.searchParams.set('download', name.split(/[\\/]/).at(-1));
    return target.href;
  },
  async delete(key) {
    const row = await database.prepare('SELECT coalesce(physical_key,object_key) AS physical_key FROM stored_objects WHERE object_key=?').bind(key).first();
    if (row) await cloudFetch('/v1/storages/object' + objectPath(row.physical_key), { method: 'DELETE' });
    await database.prepare('DELETE FROM stored_objects WHERE object_key=?').bind(key).run();
    context.getStore().objectFolders.delete(key.slice(0, key.lastIndexOf('/') + 1));
  },
};
export const env = {
  DB: database, BUCKET: storage, AUTH_MODE: 'standalone', OPEN_REGISTRATION: 'true',
  get AUTH_PEPPER() { return process.env.AUTH_PEPPER; },
  get REGISTRATION_CODE() { return process.env.REGISTRATION_CODE; },
};
