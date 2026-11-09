const { getDefaultConfig } = require('expo/metro-config');
const { metroModuleName } = require('../../packages/mobile-release/metro-play-internal.cjs');
const config = getDefaultConfig(__dirname);
// The web app uses a newer React patch. Every native dependency must resolve
// the React version matched to the native renderer, including hoisted modules.
config.resolver.resolveRequest = (context, name, platform) => {
  const reactName = name === 'react' || name.startsWith('react/') ? require.resolve(name, { paths: [__dirname] }) : name;
  const moduleName = metroModuleName(reactName, process.env.FOCUS_ANDROID_DISTRIBUTION);
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
