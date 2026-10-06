import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTECTED_PREVIEW_ALIAS, verifyAliasUnchanged, verifyDeploymentIdentity } from '../scripts/deployment-identity.mjs';

const commit = '76e47b9a2fbce068eb1ee59bcbd5ae1a1912a30f';
const inspection = () => ({ id: 'dpl_2v2fGBqhTxCrH6gNTZ2PDghsXFjF', name: 'concentration', target: 'production', readyState: 'READY', aliases: [PROTECTED_PREVIEW_ALIAS] });
const deployment = () => ({ id: inspection().id, projectId: 'prj_1qd5ppW1Tp9Npvw6PS9qWEBIeQD6', name: 'concentration', target: 'production', readyState: 'READY', source: 'git', gitSource: { type: 'github', ref: 'main', sha: commit }, meta: { githubCommitSha: commit, githubCommitRef: 'main', githubCommitOrg: 'brucesunxi', githubCommitRepo: 'concentration' } });

test('deployment identity accepts the protected alias only at the expected Git commit', () => {
  assert.deepEqual(verifyDeploymentIdentity(inspection(), deployment(), commit), { deploymentId: inspection().id, commit });
  verifyAliasUnchanged(inspection(), inspection().id);
});

test('deployment identity rejects stale, moved, or unrelated deployments before the synthetic family audit', () => {
  const stale = deployment(); stale.gitSource.sha = '0'.repeat(40);
  assert.throws(() => verifyDeploymentIdentity(inspection(), stale, commit), /COMMIT_MISMATCH/);
  const wrongProject = deployment(); wrongProject.projectId = 'prj_other';
  assert.throws(() => verifyDeploymentIdentity(inspection(), wrongProject, commit), /COMMIT_MISMATCH/);
  const unprotectedAlias = inspection(); unprotectedAlias.aliases = [];
  assert.throws(() => verifyDeploymentIdentity(unprotectedAlias, deployment(), commit), /ALIAS_NOT_READY/);
  const movedAlias = inspection(); movedAlias.id = 'dpl_new';
  assert.throws(() => verifyAliasUnchanged(movedAlias, inspection().id), /ALIAS_CHANGED/);
});
