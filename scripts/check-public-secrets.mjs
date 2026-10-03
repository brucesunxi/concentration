import { resolve } from 'node:path';
import { auditDirectory, auditTrackedFiles } from '../packages/release-safety/public-secret-scan.mjs';

const args = process.argv.slice(2);
const root = resolve(import.meta.dirname, '..');
try {
  const count = args.length === 1 && args[0] === '--tracked'
    ? await auditTrackedFiles(root)
    : args.length === 2 && args[0] === '--directory'
      ? await auditDirectory(resolve(args[1]))
      : (() => { throw new Error('Usage: check-public-secrets.mjs --tracked | --directory PATH'); })();
  console.log(JSON.stringify({ publicSecretAudit: 'passed', files: count }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PUBLIC_SECRET_AUDIT_FAILED');
  process.exitCode = 1;
}
