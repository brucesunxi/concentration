import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import type { ContentVerifier } from './index.ts';

/** Signature verification only; private signing keys never enter a client. */
export const nativeVerifier: ContentVerifier = {
  async sha256(bytes) { return bytesToHex(sha256(bytes)); },
  async verifyP256(bytes, signature, jwk) {
    try {
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d || !jwk.x || !jwk.y) return false;
      const x = base64urlnopad.decode(jwk.x), y = base64urlnopad.decode(jwk.y);
      if (x.length !== 32 || y.length !== 32 || signature.length !== 64) return false;
      const publicKey = new Uint8Array(65); publicKey[0] = 4; publicKey.set(x, 1); publicKey.set(y, 33);
      // WebCrypto accepts both S representations. No signing operation occurs here.
      return p256.verify(signature, bytes, publicKey, { prehash: true, lowS: false, format: 'compact' });
    } catch { return false; }
  },
};
