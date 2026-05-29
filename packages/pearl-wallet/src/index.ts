export {
  PEARL_WALLET_WORD_COUNT,
  _entropyToMnemonic,
  _mnemonicToEntropy,
  generatePearlMnemonic,
  getPearlWalletWordlist,
  isValidPearlMnemonic,
  pearlMnemonicToSeed,
} from './mnemonic.js';

export {
  deriveOrderKey,
  deriveOrderKeyFromMnemonic,
  formatPearlWalletDerivationPath,
  type PearlWalletDerivedKey,
} from './derivation.js';

export { pearlAddressFromXOnlyPubkey } from './address.js';

export {
  PEARL_WALLET_KDF_DEFAULTS,
  deriveVaultKey,
  generatePearlWalletKdfSalt,
  type PearlWalletKdfParams,
} from './kdf.js';

export { decryptVaultBlob, encryptVaultBlob } from './cipher.js';

export {
  InMemoryPearlWalletStorage,
  assertPasswordStrength,
  changePearlWalletPassword,
  createPearlWallet,
  recordDerivedKey,
  unlockPearlWallet,
  type CreatePearlWalletInput,
  type PearlWalletStorageAdapter,
  type PearlWalletStoredDerivedKey,
  type PearlWalletStoredVault,
} from './vault.js';

export {
  LockedVaultController,
  type LockedVaultControllerOptions,
  type LockedVaultState,
} from './auto-lock.js';

export {
  validateAndSignPearlPrefundPsbt,
  type PearlPrefundSigningInput,
  type PearlPrefundSigningResult,
  type PearlPrefundSpendContract,
} from './psbt-signing.js';

export {
  PEARL_WALLET_TOTP_DEFAULTS,
  buildTotpProvisioningUri,
  consumeBackupCode,
  generateTotpBackupCodes,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
  type PearlTotpParams,
} from './totp.js';
