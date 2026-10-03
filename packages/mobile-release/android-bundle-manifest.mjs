import assert from 'node:assert/strict';

const ANDROID = 'http://schemas.android.com/apk/res/android';

function fields(bytes) {
  let cursor = 0;
  const result = [];
  function varint() {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      assert(cursor < bytes.length, 'Truncated bundle manifest varint');
      const byte = bytes[cursor++];
      value |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return value;
    }
    throw new Error('Invalid bundle manifest varint');
  }
  while (cursor < bytes.length) {
    const key = Number(varint()), number = Math.floor(key / 8), wire = key % 8;
    assert(number > 0 && Number.isSafeInteger(key), 'Invalid bundle manifest field');
    if (wire === 0) result.push({ number, wire, value: varint() });
    else if (wire === 2) {
      const length = Number(varint());
      assert(Number.isSafeInteger(length) && length >= 0 && cursor + length <= bytes.length, 'Invalid bundle manifest length');
      result.push({ number, wire, value: bytes.subarray(cursor, cursor + length) });
      cursor += length;
    } else if (wire === 1 || wire === 5) {
      const length = wire === 1 ? 8 : 4;
      assert(cursor + length <= bytes.length, 'Truncated bundle manifest field');
      cursor += length;
    } else throw new Error('Unsupported bundle manifest wire type');
  }
  return result;
}

const value = (message, number) => fields(message).filter(field => field.number === number && field.wire === 2).map(field => field.value);
const string = (message, number) => value(message, number)[0]?.toString('utf8') ?? '';

function element(node, depth = 0) {
  assert(depth < 32, 'Bundle manifest nesting is too deep');
  const body = value(node, 1);
  assert(body.length === 1, 'Bundle manifest node has no single element');
  const attributes = new Map();
  for (const raw of value(body[0], 4)) {
    const name = string(raw, 2), namespace = string(raw, 1), entry = `${namespace}|${name}`;
    assert(name && !attributes.has(entry), 'Duplicate or unnamed bundle manifest attribute');
    attributes.set(entry, string(raw, 3));
  }
  return {
    name: string(body[0], 3),
    attributes,
    children: value(body[0], 5).filter(child => value(child, 1).length).map(child => element(child, depth + 1)),
  };
}

/** Read the base module's protobuf AndroidManifest.xml without treating it as APK binary XML. */
export function readAndroidBundleManifest(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length < 5_000_000, 'Invalid bundle manifest size');
  const manifest = element(bytes);
  assert(manifest.name === 'manifest', 'Bundle manifest root is missing');
  const attribute = (node, name, namespace = ANDROID) => node.attributes.get(`${namespace}|${name}`) ?? null;
  const applications = manifest.children.filter(child => child.name === 'application');
  assert(applications.length === 1, 'Expected one bundle application');
  const application = applications[0];
  const permissions = manifest.children.filter(child => ['uses-permission', 'uses-permission-sdk-23', 'uses-permission-sdk-m'].includes(child.name))
    .map(child => attribute(child, 'name'));
  assert(permissions.every(Boolean), 'Unnamed bundle permission');
  const sdk = manifest.children.find(child => child.name === 'uses-sdk');
  return {
    applicationId: attribute(manifest, 'package', ''),
    versionCode: Number(attribute(manifest, 'versionCode')),
    versionName: attribute(manifest, 'versionName'),
    minSdkVersion: sdk ? Number(attribute(sdk, 'minSdkVersion')) : null,
    targetSdkVersion: sdk ? Number(attribute(sdk, 'targetSdkVersion')) : null,
    allowBackup: attribute(application, 'allowBackup'),
    usesCleartextTraffic: attribute(application, 'usesCleartextTraffic'),
    debuggable: attribute(application, 'debuggable') === 'true',
    permissions,
  };
}
