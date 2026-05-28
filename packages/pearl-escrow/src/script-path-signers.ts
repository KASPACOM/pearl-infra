import * as bip341 from 'bitcoinjs-lib/src/payments/bip341.js';
import * as ecc from 'tiny-secp256k1';

import type { PearlEscrowScriptPathSigner } from './script-path-signing.js';

export function createScriptPathSigner(privateKey: Buffer): PearlEscrowScriptPathSigner {
  return createSigner(privateKey, Buffer.from(ecc.pointFromScalar(privateKey, true)!));
}

export function createKeyPathSigner(privateKey: Buffer): PearlEscrowScriptPathSigner {
  const pubkey = Buffer.from(ecc.pointFromScalar(privateKey, true)!);
  const xOnly = pubkey.subarray(1);
  const evenPrivateKey = pubkey[0] === 0x03 ? Buffer.from(ecc.privateNegate(privateKey)) : privateKey;
  const tweakedPrivateKey = Buffer.from(ecc.privateAdd(evenPrivateKey, bip341.tapTweakHash(xOnly, undefined))!);
  const tweakedPublicKey = Buffer.from(ecc.pointFromScalar(tweakedPrivateKey, true)!);
  return createSigner(tweakedPrivateKey, tweakedPublicKey);
}

function createSigner(privateKey: Buffer, publicKey: Buffer): PearlEscrowScriptPathSigner {
  return {
    publicKey,
    sign(hash) {
      return Buffer.from(ecc.sign(hash, privateKey));
    },
    signSchnorr(hash) {
      return Buffer.from(ecc.signSchnorr(hash, privateKey));
    },
  };
}
