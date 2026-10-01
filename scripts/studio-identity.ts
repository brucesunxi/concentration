import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase,migrate } from '../apps/api/database.ts';
import { fileStudioVault,provisionStudioUser } from '../apps/api/studio-auth.ts';
import { verifyRuntimeRole } from '../apps/api/family-isolation.ts';
const [action,inputPath,outputPath]=process.argv.slice(2);
if(!['provision','disable'].includes(action??'')||!inputPath||(action==='provision'&&!outputPath))throw new Error('Usage: studio-identity.ts provision <private-input.json> <private-enrollment.json> OR disable <login>. Stop this data directory’s API before opening PGlite.');
if(process.env.APP_MODE==='production')throw new Error('Production identity provisioning requires the production identity provider.');
const dataDir=resolve(process.env.FOCUS_DATA_DIR??resolve(import.meta.dirname,'../.focus-data'));
if(process.env.DATABASE_URL && !process.env.FOCUS_STUDIO_DATABASE_URL) throw new Error('DATABASE_STUDIO_ROLE_REQUIRED');
const postgres = process.env.FOCUS_STUDIO_DATABASE_URL;
const db=await openDatabase(resolve(dataDir,'postgres'),postgres);
try{
  if(postgres) await verifyRuntimeRole(db,'studio'); else await migrate(db);
  if(action==='provision'){
    // Reserve output first: never create an identity whose enrollment overwrites another file.
    await writeFile(resolve(outputPath),'',{mode:0o600,flag:'wx'});
    const input=JSON.parse(await readFile(resolve(inputPath),'utf8'));
    const identity=await provisionStudioUser(db,fileStudioVault(dataDir),input);
    await writeFile(resolve(outputPath),JSON.stringify(identity,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({created:true,login:identity.login,role:identity.role,enrollmentSaved:true}));
  }else{
    await db.transaction(async tx=>{
      await tx.query('SELECT id FROM studio_write_guard WHERE id=1 FOR UPDATE');
      const target=(await tx.query<{id:string}>('UPDATE studio_users SET enabled=false WHERE login=$1 RETURNING id',[inputPath])).rows[0];if(!target)throw new Error('Studio identity not found');
      await tx.query('DELETE FROM studio_sessions WHERE user_id=$1',[target.id]);
      await tx.query('INSERT INTO studio_audit VALUES($1,NULL,$2,$3,$4,$5)',[randomUUID(),target.id,'identity-disabled',new Date().toISOString(),{source:'local-operator-command'}]);
    });console.log(JSON.stringify({disabled:true,login:inputPath}));
  }
}finally{await db.close();}
