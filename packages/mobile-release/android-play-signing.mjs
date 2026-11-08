const DEBUG_BUILD_TYPE = `        debug {
            signingConfig signingConfigs.debug
        }`;

const LOCAL_SIGNING_CONFIGS_END = `            keyPassword 'android'
        }
    }
    buildTypes {`;

const LOCAL_RELEASE_SIGNING = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const PLAY_INTERNAL_SIGNING_CONFIGS_END = `            keyPassword 'android'
        }
        playInternal {
            def uploadStore = System.getenv('FOCUS_UPLOAD_STORE_FILE')
            def uploadStorePassword = System.getenv('FOCUS_PLAY_UPLOAD_STORE_PASSWORD')
            def uploadAlias = System.getenv('FOCUS_PLAY_UPLOAD_KEY_ALIAS')
            def uploadKeyPassword = System.getenv('FOCUS_PLAY_UPLOAD_KEY_PASSWORD')
            if (!uploadStore || !uploadStorePassword || !uploadAlias || !uploadKeyPassword) {
                throw new GradleException('PLAY_INTERNAL_SIGNING_CONFIG_MISSING')
            }
            storeFile file(uploadStore)
            storePassword uploadStorePassword
            keyAlias uploadAlias
            keyPassword uploadKeyPassword
        }
    }
    buildTypes {`;

const PLAY_INTERNAL_RELEASE_SIGNING = `        release {
            // Play internal upload key only. Incomplete material fails the build
            // instead of falling back to the Android debug certificate.
            signingConfig signingConfigs.playInternal`;

function releaseUsesDebugSigning(source) {
  return /release \{[^}]*signingConfig signingConfigs\.debug/.test(source);
}

/** Point the generated release build at an env-supplied upload key. Never embed secret values. */
export function applyPlayInternalReleaseSigning(source) {
  if (typeof source !== 'string' || source.length === 0 || source.length > 1_000_000) throw new Error('PLAY_INTERNAL_GRADLE_TEMPLATE_UNEXPECTED');
  if (source.includes('signingConfigs.playInternal')) {
    if (!source.includes(PLAY_INTERNAL_RELEASE_SIGNING) || !source.includes(DEBUG_BUILD_TYPE) || releaseUsesDebugSigning(source)) {
      throw new Error('PLAY_INTERNAL_GRADLE_TEMPLATE_UNEXPECTED');
    }
    return source;
  }
  if (source.split(LOCAL_SIGNING_CONFIGS_END).length !== 2 || source.split(LOCAL_RELEASE_SIGNING).length !== 2 || !source.includes(DEBUG_BUILD_TYPE)) {
    throw new Error('PLAY_INTERNAL_GRADLE_TEMPLATE_UNEXPECTED');
  }
  const patched = source.replace(LOCAL_SIGNING_CONFIGS_END, PLAY_INTERNAL_SIGNING_CONFIGS_END).replace(LOCAL_RELEASE_SIGNING, PLAY_INTERNAL_RELEASE_SIGNING);
  if (patched === source || releaseUsesDebugSigning(patched) || !patched.includes(DEBUG_BUILD_TYPE) || !patched.includes("throw new GradleException('PLAY_INTERNAL_SIGNING_CONFIG_MISSING')")) {
    throw new Error('PLAY_INTERNAL_GRADLE_TEMPLATE_UNEXPECTED');
  }
  return patched;
}
