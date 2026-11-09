function metroModuleName(name, distribution) {
  if (distribution !== 'play-internal' || typeof name !== 'string') return name;
  if (name.endsWith('/mobile-api-origin.ts')) return `${name.slice(0, -'mobile-api-origin.ts'.length)}mobile-api-origin-play.ts`;
  if (name.endsWith('/mobile-api-origin')) return `${name}-play`;
  return name;
}

module.exports = { metroModuleName };
