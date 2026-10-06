export const forbiddenExportFields = new Set(['password_hash', 'token_hash', 'accessToken', 'csrf', 'request_key', 'request_hash', 'device_id']);

export function assertExportSafe(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error('EXPORT_NESTING_TOO_DEEP');
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertExportSafe(item, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenExportFields.has(key)) throw new Error('EXPORT_CONTAINS_PRIVATE_CREDENTIALS');
    assertExportSafe(item, depth + 1);
  }
}
