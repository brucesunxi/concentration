export const PROTECTED_PREVIEW_ALIAS = 'concentration-two.vercel.app';
const PROJECT_ID = 'prj_1qd5ppW1Tp9Npvw6PS9qWEBIeQD6';

export function verifyDeploymentIdentity(inspection, deployment, expectedSha) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) throw new Error('DEPLOYMENT_EXPECTED_COMMIT_INVALID');
  if (!/^dpl_[A-Za-z0-9]+$/.test(inspection?.id ?? '') ||
      inspection.readyState !== 'READY' || inspection.target !== 'production' ||
      inspection.name !== 'concentration' ||
      !Array.isArray(inspection.aliases) || !inspection.aliases.includes(PROTECTED_PREVIEW_ALIAS)) {
    throw new Error('PROTECTED_PREVIEW_ALIAS_NOT_READY');
  }
  if (deployment?.id !== inspection.id || deployment.projectId !== PROJECT_ID ||
      deployment.readyState !== 'READY' || deployment.target !== 'production' ||
      deployment.name !== 'concentration' || deployment.source !== 'git' ||
      deployment.gitSource?.type !== 'github' || deployment.gitSource.ref !== 'main' ||
      deployment.gitSource.sha !== expectedSha ||
      deployment.meta?.githubCommitSha !== expectedSha ||
      deployment.meta.githubCommitRef !== 'main' ||
      deployment.meta.githubCommitOrg !== 'brucesunxi' ||
      deployment.meta.githubCommitRepo !== 'concentration') {
    throw new Error('PROTECTED_PREVIEW_DEPLOYMENT_COMMIT_MISMATCH');
  }
  return { deploymentId: inspection.id, commit: expectedSha };
}

export function verifyAliasUnchanged(inspection, deploymentId) {
  if (inspection?.id !== deploymentId || inspection.readyState !== 'READY' ||
      !Array.isArray(inspection.aliases) || !inspection.aliases.includes(PROTECTED_PREVIEW_ALIAS)) {
    throw new Error('PROTECTED_PREVIEW_ALIAS_CHANGED_DURING_AUDIT');
  }
}
