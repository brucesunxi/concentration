import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessIosKeychainSigning, type IosSigningEvidence } from '../../packages/mobile-release/ios-signing.ts';

const valid: IosSigningEvidence = {
  bundleId: 'dev.focusisland.family', expectedBundleId: 'dev.focusisland.family',
  teamIdentifier: 'ABCDE12345', supportedPlatforms: ['iPhoneOS'], signatureValid: true,
  entitlements: {
    'application-identifier': 'ABCDE12345.dev.focusisland.family',
    'keychain-access-groups': ['ABCDE12345.dev.focusisland.family'],
    'com.apple.developer.team-identifier': 'ABCDE12345',
  },
};

test('matching signed application and Keychain group pass the release preflight', () => {
  assert.deepEqual(assessIosKeychainSigning(valid), []);
});

test('local ad-hoc signature cannot be mistaken for usable Keychain signing', () => {
  assert.deepEqual(assessIosKeychainSigning({ ...valid, teamIdentifier: null, entitlements: {} }), [
    'MISSING_SIGNING_TEAM', 'MISSING_APPLICATION_IDENTIFIER', 'MISSING_KEYCHAIN_ACCESS_GROUP',
  ]);
});

test('signature, bundle and access group must agree', () => {
  const failures = assessIosKeychainSigning({ ...valid, signatureValid: false, bundleId: 'dev.other.app', entitlements: {
    ...valid.entitlements, 'keychain-access-groups': ['ABCDE12345.dev.other.app'],
    'com.apple.developer.team-identifier': 'OTHERT1234',
  } });
  assert.deepEqual(failures, ['INVALID_CODE_SIGNATURE', 'UNEXPECTED_BUNDLE_ID', 'MISSING_KEYCHAIN_ACCESS_GROUP', 'MISMATCHED_ENTITLEMENT_TEAM']);
});

test('unexpanded provisioning placeholders are rejected', () => {
  assert.deepEqual(assessIosKeychainSigning({ ...valid, entitlements: {
    ...valid.entitlements,
    'keychain-access-groups': ['$(AppIdentifierPrefix)dev.focusisland.family'],
  } }), ['MISSING_KEYCHAIN_ACCESS_GROUP']);
});
