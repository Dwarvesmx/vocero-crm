import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, realpathSync, readFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
const root=realpathSync(process.cwd());
const cluster=realpathSync(resolve(root,'../tmp/demo-f2a02-pg'));
if(!cluster.replaceAll('\\','/').endsWith('/tmp/demo-f2a02-pg'))throw Error('Clúster no autorizado');
const config=readFileSync(resolve(cluster,'PG_VERSION'),'utf8').trim();
if(config!=='16')throw Error('Versión inesperada');
const pg='C:/Program Files/PostgreSQL/16/bin/pg_ctl.exe';
const evidence=resolve(root,'../tmp/demo-generation-evidence',new Date().toISOString().replaceAll(':','-'));
mkdirSync(evidence,{recursive:true});
const env={};
for(const key of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP','COMSPEC','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles'])if(process.env[key])env[key]=process.env[key];
Object.assign(env,{DATABASE_URL:'postgres://demo@127.0.0.1:55529/demo_f2a',DEMO_FINANCE_TEST:'1',DEMO_FINANCE_ISOLATED:'1',APP_BASE_URL:'http://127.0.0.1:55530',BETTER_AUTH_SECRET:'synthetic-test-only-secret',ENCRYPTION_KEY:Buffer.alloc(32).toString('base64'),META_WEBHOOK_VERIFY_TOKEN:'synthetic-test-only',DEMO_REAL_ENABLED:'false',DEMO_EXTERNAL_SESSIONS_ENABLED:'true',DEMO_EXTERNAL_GENERATION_ENABLED:'true',DEMO_CONSUMER_ENABLED:'true',BOT_API_KEY:'synthetic-demo-service-key'});
function control(args){const fd=openSync(resolve(evidence,'postgres.log'),'a');try{const result=spawnSync(pg,args,{env,stdio:['ignore',fd,fd],timeout:30000,windowsHide:true});if(result.error)throw result.error;return result.status;}finally{closeSync(fd);}}

// Nunca apropiarse de un servidor en ejecución; tampoco crear bases o migrarlas.
if(control(['status','-D',cluster])!==3)throw Error('El clúster debe estar detenido; no se modifica uno en ejecución');
let started=false;
try{
 started=true;
 if(control(['start','-D',cluster,'-o','-h 127.0.0.1 -p 55529','-l',resolve(evidence,'server.log')])!==0)throw Error('No se pudo iniciar el clúster sintético');
 started=true;
 const result=await new Promise((done,reject)=>{
  const child=spawn(process.execPath,[resolve(root,'node_modules/vitest/vitest.mjs'),'run','tests/unit/demo-center-generation-http.integration.test.ts'],{cwd:root,env,windowsHide:true});
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{process.stdout.write(data);appendFileSync(resolve(evidence,'vitest.log'),data);});
  child.on('error',reject);child.on('close',done);
 });
 process.exitCode=result??1;
}finally{
 if(started && control(['stop','-D',cluster,'-m','fast'])!==0)process.exitCode=1;
 console.log('Evidencia:',evidence);
}
