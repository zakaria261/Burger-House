import { existsSync, mkdirSync, renameSync, readdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const api='src/app/api';const hidden='.openai/api-build-backup';
if(existsSync(hidden)&&!existsSync(api))renameSync(hidden,api);
renameSync(api,hidden);
try{
 const r=spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{stdio:'inherit',env:{...process.env,SITES_EXPORT:'1'}});
 if(r.status!==0)throw new Error('La compilation Next.js a échoué.');
 const assets={};function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else assets['/'+path.relative('out',f).split(path.sep).join('/')]=readFileSync(f).toString('base64');}}walk('out');
 const precache=['/',...Object.keys(assets).filter(p=>p.startsWith('/_next/static/')||p.startsWith('/fonts/')&&!p.includes('/licenses/')||p.startsWith('/icons/')||p==='/logo-burger-house.jpg')];
 const fingerprint=createHash('sha256').update(Object.keys(assets).join('')).digest('hex').slice(0,12);
 const sw=Buffer.from(assets['/sw.js'],'base64').toString().replace("burger-house-shell-v1",'burger-house-shell-'+fingerprint).replace("c.addAll(['/','/icons/icon-192.png','/logo-burger-house.jpg'])",`c.addAll(${JSON.stringify(precache)})`);
 assets['/sw.js']=Buffer.from(sw).toString('base64');
 writeFileSync('worker/assets.generated.json',JSON.stringify(assets));rmSync('dist',{recursive:true,force:true});mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
 await build({entryPoints:['worker/index.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
 copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');console.log(`Application Next.js exportée : ${Object.keys(assets).length} ressources + API D1.`);
}finally{renameSync(hidden,api);}
