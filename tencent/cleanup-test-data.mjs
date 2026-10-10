import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {manager} from './manage.mjs';

// Delete only disposable accounts named in this project's own verification reports.
// An unrelated real account or workspace is never selected by its name alone.
const fixtures=new Map();
for(const name of await fs.readdir('outputs')) {
  if(!/^tencent-cloud-verification.*\.json$/.test(name))continue;
  const report=JSON.parse(await fs.readFile('outputs/'+name,'utf8'));
  for(const user of report.accounts||[])if(/^gy\.verify\.(owner|member|outsider)\.[a-f0-9]{8}$/.test(user.username))fixtures.set(user.id,user.username);
}
if(!fixtures.size)throw new Error('No exact fixture identities found');
const cloud=await manager(),detail=await cloud.functions.getFunctionDetail('gongyan-backend');
for(const variable of detail.Environment.Variables)process.env[variable.Key]=variable.Value;
const {database,cloudFetch}=await import('./server/runtime.mjs');
const accounts=(await database.prepare('SELECT id,username FROM accounts').all()).results;
const ids=accounts.filter(row=>fixtures.get(row.id)===row.username).map(row=>row.id);
if(!ids.length){console.log('Disposable test accounts already removed.');process.exit(0);}
const placeholders=ids.map(()=>'?').join(',');
const projects=(await database.prepare('SELECT id,owner_id FROM projects WHERE owner_id IN ('+placeholders+')').bind(...ids).all()).results;
const pid=projects.map(row=>row.id),projectPlaceholders=pid.map(()=>'?').join(',');
if(pid.length) {
  const members=(await database.prepare('SELECT user_id FROM members WHERE project_id IN ('+projectPlaceholders+')').bind(...pid).all()).results;
  if(members.some(row=>!ids.includes(row.user_id)))throw new Error('A test workspace now has a real member; preserve it for manual review');
}
const prefixes=new Set();
for(const project of projects)for(const userId of ids)prefixes.add('markdown/'+createHash('sha256').update(project.id+'\n'+userId).digest('hex')+'/');
const receipts=(await database.prepare('SELECT object_key,physical_key FROM stored_objects').all()).results.filter(row=>[...prefixes].some(prefix=>row.object_key.startsWith(prefix)));
const objects=new Set(receipts.map(row=>row.physical_key||row.object_key));
const onlyFixtures=accounts.every(row=>ids.includes(row.id));
if(onlyFixtures) {
  // Snapshot exact names while the app contains only our fixtures. Files created
  // after this snapshot are never covered by the cleanup, including new users'.
  const result=await cloud.database.executePGSql({Sql:"SELECT name FROM storage.objects WHERE bucket_id='gongyan-files'"});
  for(const row of result.Rows||[])objects.add(JSON.parse(row)[0]);
}
console.log(JSON.stringify({testAccounts:ids.length,testWorkspaces:pid.length,testObjects:objects.size,unrelatedAccountsPreserved:accounts.length-ids.length,mode:process.argv.includes('--apply')?'apply':'preview'}));
if(!process.argv.includes('--apply'))process.exit(0);
let deleted=0,next=0;const keys=[...objects];
await Promise.all(Array.from({length:4},async()=>{while(next<keys.length){const key=keys[next++];const response=await cloudFetch('/v1/storages/object/gongyan-files/'+key.split('/').map(encodeURIComponent).join('/'),{method:'DELETE'});await response.body?.cancel();deleted++;}}));
// Every statement executes in a single database transaction with the exact IDs.
const statements=[];
for(const row of receipts)statements.push(database.prepare('DELETE FROM stored_objects WHERE object_key=?').bind(row.object_key));
// The RPC caps batches at 100. Receipt removal can safely be retried separately.
for(let i=0;i<statements.length;i+=90)await database.batch(statements.slice(i,i+90));
const removals=[];
if(pid.length) {
  removals.push(database.prepare('DELETE FROM deliveries WHERE project_id IN ('+projectPlaceholders+')').bind(...pid),
    database.prepare('DELETE FROM files WHERE project_id IN ('+projectPlaceholders+')').bind(...pid),
    database.prepare('DELETE FROM posts WHERE project_id IN ('+projectPlaceholders+')').bind(...pid),
    database.prepare('DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE project_id IN ('+projectPlaceholders+'))').bind(...pid),
    database.prepare('DELETE FROM sessions WHERE project_id IN ('+projectPlaceholders+')').bind(...pid),
    database.prepare('DELETE FROM tasks WHERE project_id IN ('+projectPlaceholders+')').bind(...pid),
    database.prepare('DELETE FROM members WHERE project_id IN ('+projectPlaceholders+')').bind(...pid),
    database.prepare('DELETE FROM projects WHERE id IN ('+projectPlaceholders+')').bind(...pid));
}
removals.push(database.prepare('DELETE FROM members WHERE user_id IN ('+placeholders+')').bind(...ids),
  database.prepare('DELETE FROM login_sessions WHERE user_id IN ('+placeholders+')').bind(...ids),
  database.prepare('DELETE FROM accounts WHERE id IN ('+placeholders+')').bind(...ids));
await database.batch(removals);
const remaining=(await database.prepare('SELECT id FROM accounts WHERE id IN ('+placeholders+')').bind(...ids).all()).results.length;
if(remaining)throw new Error('Fixture cleanup incomplete');
await fs.writeFile('outputs/tencent-test-cleanup.json',JSON.stringify({completedAt:new Date().toISOString(),deletedAccounts:ids.length,deletedWorkspaces:pid.length,deletedStoredObjects:deleted,unrelatedAccountsPreserved:accounts.length-ids.length,privateLocalDataUploaded:false},null,2)+'\n');
console.log('Synthetic cloud test accounts and their data removed.');
