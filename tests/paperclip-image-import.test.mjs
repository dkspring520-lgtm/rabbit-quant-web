import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,cp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

test('bridge imports using only files copied into its image',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const stage=await mkdtemp(path.join(tmpdir(),'bridge-image-import-'));
  try{
    const dockerfile=await readFile(path.join(root,'deploy/paperclip/Dockerfile.bridge'),'utf8');
    for(const line of dockerfile.split(/\r?\n/).filter(line=>line.startsWith('COPY '))){
      const parts=line.trim().split(/\s+/).slice(1), destination=parts.pop();
      assert.ok(destination.startsWith('./'),'fixture only supports relative COPY destinations');
      const target=path.join(stage,destination);
      if(parts.length>1||destination.endsWith('/'))await mkdir(target,{recursive:true});
      for(const source of parts){
        const output=parts.length>1||destination.endsWith('/')?path.join(target,path.basename(source)):target;
        await mkdir(path.dirname(output),{recursive:true});
        await cp(path.join(root,source),output,{recursive:true});
      }
    }
    const entry=pathToFileURL(path.join(stage,'services/paperclip-bridge/server.mjs')).href;
    const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(entry)})`],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr||String(result.error));
  }finally{await rm(stage,{recursive:true,force:true});}
});


test('public source modes are normalized inside the image before switching user',async()=>{
  const dockerfile=await readFile(new URL('../deploy/paperclip/Dockerfile.bridge',import.meta.url),'utf8');
  const start=dockerfile.indexOf('RUN chmod 0755 /app');
  assert.ok(start>=0 && start<dockerfile.indexOf('\nUSER bridge'));
  assert.match(dockerfile,/find \/app\/lib \/app\/scripts \/app\/services -type d -exec chmod 0755 \{\} \+/);
  assert.match(dockerfile,/find \/app\/lib \/app\/scripts \/app\/services -type f -exec chmod 0644 \{\} \+/);
  assert.doesNotMatch(dockerfile,/chmod[^\n]*(?:\/config|\/srv|\/paperclip|\/datasets)/);
});
