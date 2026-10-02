export interface IosSigningEvidence {
  bundleId: string;
  expectedBundleId: string;
  teamIdentifier: string | null;
  supportedPlatforms: string[];
  entitlements: Record<string, unknown>;
  signatureValid: boolean;
}

export function assessIosKeychainSigning(evidence: IosSigningEvidence): string[] {
  const failures: string[] = [];
  if (!evidence.signatureValid) failures.push('INVALID_CODE_SIGNATURE');
  if (evidence.bundleId !== evidence.expectedBundleId) failures.push('UNEXPECTED_BUNDLE_ID');
  if (!evidence.supportedPlatforms.some(platform => platform === 'iPhoneOS' || platform === 'iPhoneSimulator')) failures.push('UNEXPECTED_PLATFORM');
  const team = evidence.teamIdentifier;
  if (!team || !/^[A-Z0-9]{10}$/.test(team)) failures.push('MISSING_SIGNING_TEAM');
  const expectedApplicationId = team && `${team}.${evidence.expectedBundleId}`;
  if (!expectedApplicationId || evidence.entitlements['application-identifier'] !== expectedApplicationId) failures.push('MISSING_APPLICATION_IDENTIFIER');
  const groups = evidence.entitlements['keychain-access-groups'];
  if (!expectedApplicationId || !Array.isArray(groups) || !groups.includes(expectedApplicationId)) failures.push('MISSING_KEYCHAIN_ACCESS_GROUP');
  const entitlementTeam = evidence.entitlements['com.apple.developer.team-identifier'];
  if (entitlementTeam !== undefined && entitlementTeam !== team) failures.push('MISMATCHED_ENTITLEMENT_TEAM');
  return failures;
}
