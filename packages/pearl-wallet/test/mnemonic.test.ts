import assert from 'node:assert/strict';
import test from 'node:test';

import {
  _entropyToMnemonic,
  _mnemonicToEntropy,
  generatePearlMnemonic,
  getPearlWalletWordlist,
  isValidPearlMnemonic,
  PEARL_WALLET_WORD_COUNT,
  pearlMnemonicToSeed,
} from '../dist/index.js';

// BIP39 official test vectors for 128-bit entropy (12-word mnemonics).
// Source: https://github.com/trezor/python-mnemonic/blob/master/vectors.json
//
// Each row: [entropy hex, expected mnemonic, expected seed hex (passphrase=TREZOR)].
const BIP39_VECTORS_128: ReadonlyArray<readonly [string, string, string]> = [
  [
    '00000000000000000000000000000000',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
  ],
  [
    '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    'legal winner thank year wave sausage worth useful legal winner thank yellow',
    '2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607',
  ],
  [
    '80808080808080808080808080808080',
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    'd71de856f81a8acc65e6fc851a38d4d7ec216fd0796d0a6827a3ad6ed5511a30fa280f12eb2e47ed2ac03b5c462a0358d18d69fe4f985ec81778c1b370b652a8',
  ],
  [
    'ffffffffffffffffffffffffffffffff',
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    'ac27495480225222079d7be181583751e86f571027b0497b5b5d11218e0a8a13332572917f0f8e5a589620c6f15b11c61dee327651a14c34e18231052e48c069',
  ],
];

test('PEARL_WALLET_WORD_COUNT is 12 — locks in the W0 spec', () => {
  assert.equal(PEARL_WALLET_WORD_COUNT, 12);
});

test('generatePearlMnemonic produces exactly 12 words, all from the BIP39 English wordlist', () => {
  const wordlist = new Set(getPearlWalletWordlist());
  for (let i = 0; i < 8; i += 1) {
    const mnemonic = generatePearlMnemonic();
    const words = mnemonic.split(' ');
    assert.equal(words.length, 12);
    for (const w of words) assert.ok(wordlist.has(w), `unexpected word: ${w}`);
  }
});

test('generatePearlMnemonic produces distinct values across calls (entropy is real)', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 8; i += 1) seen.add(generatePearlMnemonic());
  assert.equal(seen.size, 8);
});

test('generated mnemonics round-trip through isValidPearlMnemonic', () => {
  for (let i = 0; i < 8; i += 1) {
    assert.ok(isValidPearlMnemonic(generatePearlMnemonic()));
  }
});

test('isValidPearlMnemonic rejects wrong word count, unknown words, bad checksums', () => {
  // 11 words (too few).
  assert.equal(isValidPearlMnemonic('abandon '.repeat(11).trim()), false);
  // 13 words (too many — even if 12 are valid we still reject).
  assert.equal(isValidPearlMnemonic('abandon '.repeat(13).trim()), false);
  // 24 words is a valid BIP39 length but explicitly not what pearl-wallet uses.
  assert.equal(isValidPearlMnemonic('abandon '.repeat(24).trim()), false);
  // Word that isn't in the BIP39 English wordlist.
  assert.equal(isValidPearlMnemonic('not_in_wordlist abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'), false);
  // 12 wordlist words but checksum byte mismatch.
  assert.equal(isValidPearlMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'), false);
  // Non-string inputs.
  assert.equal(isValidPearlMnemonic(undefined as unknown as string), false);
  assert.equal(isValidPearlMnemonic(123 as unknown as string), false);
});

test('isValidPearlMnemonic tolerates extra whitespace from copy-paste', () => {
  const m = '  abandon\tabandon  abandon abandon abandon abandon abandon abandon abandon abandon abandon about  ';
  assert.equal(isValidPearlMnemonic(m), true);
});

test('BIP39 reference vectors round-trip through our entropy ↔ mnemonic helpers', () => {
  for (const [entropyHex, expectedMnemonic] of BIP39_VECTORS_128) {
    const entropy = hexToBytes(entropyHex);
    const mnemonic = _entropyToMnemonic(entropy);
    assert.equal(mnemonic, expectedMnemonic);
    const decoded = _mnemonicToEntropy(expectedMnemonic);
    assert.equal(bytesToHex(decoded), entropyHex);
  }
});

test('pearlMnemonicToSeed produces the BIP39 reference seed (passphrase=TREZOR)', () => {
  for (const [, mnemonic, expectedSeedHex] of BIP39_VECTORS_128) {
    const seed = pearlMnemonicToSeed(mnemonic, 'TREZOR');
    assert.equal(bytesToHex(seed), expectedSeedHex);
  }
});

test('pearlMnemonicToSeed rejects invalid mnemonics rather than returning garbage', () => {
  assert.throws(() => pearlMnemonicToSeed('not a real mnemonic'), /invalid pearl-wallet mnemonic/);
});

test('_entropyToMnemonic rejects non-128-bit entropy', () => {
  assert.throws(() => _entropyToMnemonic(new Uint8Array(15)), /must encode 128 bits/);
  assert.throws(() => _entropyToMnemonic(new Uint8Array(17)), /must encode 128 bits/);
});

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
