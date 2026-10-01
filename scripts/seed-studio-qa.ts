import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {openDatabase,migrate} from '../apps/api/database.ts';
import {fileStudioVault,provisionStudioUser} from '../apps/api/studio-auth.ts';
const output=process.argv[2];if(!output)throw new Error('Provide a private output manifest path. A new temporary database is always created; the main family database is never seeded.');
const dataDir=await mkdtemp(join(tmpdir(),'focus-studio-qa-')),db=await openDatabase(resolve(dataDir,'postgres'));
const users=[];
try{await migrate(db);for(const role of ['editor','method-reviewer','language-reviewer','publisher'] as const)users.push(await provisionStudioUser(db,fileStudioVault(dataDir),{login:'qa-'+role,name:'验收专用 · '+role,role,password:'Studio-QA-2026!'}));}
finally{await db.close();}
await writeFile(resolve(output),JSON.stringify({dataDir,password:'Studio-QA-2026!',syntheticOnly:true,users},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({dataDir,identities:users.map(({login,role})=>({login,role})),manifestSaved:true}));
