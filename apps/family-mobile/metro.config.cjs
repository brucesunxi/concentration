const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// The web app uses a newer React patch. Every native dependency must resolve
// the React version matched to the native renderer, including hoisted modules.
config.resolver.resolveRequest = (context, name, platform) => {
  const moduleName = name === 'react' || name.startsWith('react/') ? require.resolve(name, { paths: [__dirname] }) : name;
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
