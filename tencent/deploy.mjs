import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { manager, ENV_ID } from './manage.mjs';
const name='gongyan-backend';
const domain='gongyan-d6gqg5jl234d901e6-1503317224.ap-shanghai.app.tcloudbase.com';
const cloud=await manager();
const functions=await cloud.functions.listFunctions();
const exists=functions.some(f=>f.FunctionName===name);
let variables;
if(exists) {
  const detail=await cloud.functions.getFunctionDetail(name);
  variables=Object.fromEntries(detail.Environment.Variables.map(v=>[v.Key,v.Value]));
} else {
  const key=await cloud.env.createApiKey({KeyType:'api_key',KeyName:'gongyan-backend',ExpireIn:0});
  if(!key.ApiKey) throw new Error('API key creation failed');
  variables={CLOUDBASE_ENV_ID:ENV_ID,CLOUDBASE_APIKEY:key.ApiKey,AUTH_PEPPER:randomBytes(48).toString('hex'),APP_ORIGIN:'https://'+domain};
}
variables.APP_ORIGIN='https://'+domain;
const func={name,type:'HTTP',runtime:'Nodejs20.19',timeout:3,memorySize:256,installDependency:false,description:'共研：账号、工作区、对话与私有文件',envVariables:variables};
try {
  await cloud.functions.createFunction({func,force:exists,functionPath:path.resolve('.sites-runtime/tencent-function'),deployMode:'cos'});
  console.log('HTTP function deployed.');
  const info=await cloud.env.describeHttpServiceRoute({EnvId:ENV_ID,Filters:[{Name:'Domain',Values:[domain]}]});
  const current=info.Domains.find(d=>d.Domain===domain);
  if(!current) throw new Error('Existing website domain is unavailable');
  const routes=[{Path:'/',UpstreamResourceType:'WEB_SCF',UpstreamResourceName:name,EnableAuth:false,EnableSafeDomain:false,EnablePathTransmission:true,Enable:true}];
  const routeParams={EnvId:ENV_ID,Domain:{Domain:domain,Routes:routes}};
  if(current.Routes?.some(r=>r.Path==='/')) await cloud.env.modifyHttpServiceRoute(routeParams);
  else await cloud.env.createHttpServiceRoute(routeParams);
  console.log('Same-origin login and upload routes connected.');
  await cloud.hosting.uploadFiles({localPath:path.resolve('.sites-runtime/tencent-static'),cloudPath:'',parallel:8,verify:true,safe:true,retryCount:2});
  console.log('Frontend assets deployed.');
} catch(error) {
  // SDK errors can carry request environments. Log only the response's code/message.
  console.error('Deployment failed:',error.code||'unknown',error.message||'unknown');
  process.exitCode=1;
}
