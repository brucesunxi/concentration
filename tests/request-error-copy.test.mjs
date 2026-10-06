import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {requestErrorCopy} from '../packages/contracts/request-error-copy.ts';

test('every literal family API error has a specific English explanation',()=>{
  const directory=new URL('../apps/api/',import.meta.url);
  const codes=new Set();
  for(const filename of readdirSync(directory).filter(name=>name.endsWith('.ts'))){
    const source=readFileSync(new URL(filename,directory),'utf8');
    for(const match of source.matchAll(/\b(?:fail|familyFail|serviceFail)\(\s*\d+\s*,\s*['"]([A-Z][A-Z0-9_]+)['"]/g))codes.add(match[1]);
  }
  assert.ok(codes.size>=70,'Family API error inventory unexpectedly shrank');
  const generic=requestErrorCopy('UNRECOGNIZED_TEST_CODE',409,'en');
  const missing=[...codes].filter(code=>requestErrorCopy(code,409,'en')===generic);
  assert.deepEqual(missing,[]);
  for(const code of codes)assert.doesNotMatch(requestErrorCopy(code,409,'en'),/[\u3400-\u9fff]/u,code);
});

test('family-facing conflict and verification errors tell parents what to do',()=>{
  assert.match(requestErrorCopy('FAMILY_CONTENT_CHANGED',409,'en'),/Read the updated version/);
  assert.match(requestErrorCopy('GUARDIAN_VERIFICATION_UNAVAILABLE',503,'en'),/try again later/);
  assert.match(requestErrorCopy('REFLECTION_WITHDRAWN',409,'en'),/cannot restore/);
  assert.match(requestErrorCopy('SESSION_DEVICE_MISMATCH',403,'en'),/original device/);
});
