import type { ExpoConfig } from 'expo/config';
import mobilePackage from './package.json';
import buildIdentity from './build-identity.json';

if (process.env.APP_MODE === 'production') throw new Error('Mobile production release requires approved identity, markets and content.');
const config: ExpoConfig = {
  name: 'Focus Island Dev', slug: 'focus-family-local', version: mobilePackage.version,
  orientation: 'portrait', userInterfaceStyle: 'light', scheme: 'focus-family-local',
  ios: {
    bundleIdentifier: 'dev.focusisland.family', supportsTablet: true, buildNumber: buildIdentity.iosBuildNumber,
    infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
    entitlements: { 'keychain-access-groups': ['$(AppIdentifierPrefix)dev.focusisland.family'] },
  },
  android: { package: 'dev.focusisland.family', versionCode: buildIdentity.androidVersionCode, allowBackup: false, blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.CAMERA', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'] },
  plugins: [
    ['expo-localization', { supportedLocales: { ios: ['en', 'zh-Hans'], android: ['en', 'zh-CN'] } }],
    ['expo-audio', { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false, enableBackgroundRecording: false }],
    ['expo-sqlite', { useSQLCipher: true, enableFTS: false }],
    ['expo-secure-store', { configureAndroidBackup: true, faceIDPermission: false }],
    ['expo-build-properties', { android: { usesCleartextTraffic: true }, ios: { deploymentTarget: '16.4' } }],
  ],
};
export default config;
