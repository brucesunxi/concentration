// Local preview confirmation is an explicit development permission. It is not
// verified parental consent and must never be accepted by a production gate.
export const LOCAL_CONFIRMATION_PURPOSE = 'local-development-only-not-vpc';
export const LOCAL_CONFIRMATION_VERSION = 'local-1';

export function activeLocalConfirmationSql(childAlias: string, atParameter: number) {
  if (!/^[a-z][a-z0-9_]*$/i.test(childAlias) || !Number.isInteger(atParameter) || atParameter < 1) throw new Error('Invalid SQL identifier or parameter');
  return `EXISTS (SELECT 1 FROM local_confirmations lc WHERE lc.family_id=${childAlias}.family_id AND lc.child_id=${childAlias}.id
    AND lc.purpose='${LOCAL_CONFIRMATION_PURPOSE}' AND lc.version='${LOCAL_CONFIRMATION_VERSION}'
    AND lc.withdrawn_at IS NULL AND lc.acknowledged_at<=$${atParameter}::timestamptz)`;
}

export function localCollectionActive(profileEnabled: boolean, confirmationActive: boolean) {
  return profileEnabled && confirmationActive;
}

// The approved release path requires a separate, time-limited proof record.
// A development checkbox can never satisfy this predicate.
export function activeVerifiedConsentSql(childAlias: string, atParameter: number, identityParameter: number) {
  if (!/^[a-z][a-z0-9_]*$/i.test(childAlias) || !Number.isInteger(atParameter) || atParameter < 1 ||
    !Number.isInteger(identityParameter) || identityParameter < 1 || identityParameter === atParameter) throw new Error('Invalid SQL identifier or parameter');
  return `EXISTS (SELECT 1 FROM guardian_consents gc WHERE gc.family_id=${childAlias}.family_id AND gc.child_id=${childAlias}.id
    AND gc.country=(SELECT residence_country FROM families f WHERE f.id=${childAlias}.family_id)
    AND gc.age_band=${childAlias}.age_band AND gc.locale=${childAlias}.locale
    AND gc.purpose='family-practice' AND gc.release_scope_identity=$${identityParameter}
    AND gc.withdrawn_at IS NULL AND gc.verified_at<=$${atParameter}::timestamptz
    AND gc.granted_at<=$${atParameter}::timestamptz AND gc.expires_at>$${atParameter}::timestamptz)`;
}
