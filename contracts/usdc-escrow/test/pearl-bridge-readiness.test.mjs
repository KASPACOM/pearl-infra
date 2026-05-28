import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validatePearlBridgeDeploymentReadiness } from '../scripts/pearl-bridge-readiness.mjs';

const CONTRACT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ADDRESSES = {
  setupOwner: '0x0000000000000000000000000000000000000001',
  finalOwner: '0x0000000000000000000000000000000000000002',
  relayer: '0x0000000000000000000000000000000000000003',
  operator: '0x0000000000000000000000000000000000000004',
};

test('allows non-mainnet local deployments to use collapsed setup roles', () => {
  assert.doesNotThrow(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'local', mainnet: false },
    roles: {
      owner: ADDRESSES.setupOwner,
      finalOwner: undefined,
      relayer: ADDRESSES.setupOwner,
      operator: ADDRESSES.setupOwner,
    },
    caps: validCaps(),
  }));
});

test('requires explicit mainnet approval and readiness checklist', () => {
  assert.throws(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'igra-mainnet', mainnet: true },
    roles: validRoles(),
    caps: validCaps(),
    mainnetApproved: '0',
    mainnetReadyChecklist: '1',
  }), /PEARL_BRIDGE_MAINNET_APPROVED=1/);

  assert.throws(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'igra-mainnet', mainnet: true },
    roles: validRoles(),
    caps: validCaps(),
    mainnetApproved: '1',
    mainnetReadyChecklist: undefined,
  }), /PEARL_BRIDGE_MAINNET_READY_CHECKLIST=1/);
});

test('rejects mainnet role collapse across owner, final owner, relayer, and operator', () => {
  assert.throws(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'igra-mainnet', mainnet: true },
    roles: {
      ...validRoles(),
      finalOwner: ADDRESSES.relayer,
    },
    caps: validCaps(),
    mainnetApproved: '1',
    mainnetReadyChecklist: '1',
    readinessManifest: validReadinessManifest(),
  }), /relayer must be separate from final owner/);

  assert.throws(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'igra-mainnet', mainnet: true },
    roles: {
      ...validRoles(),
      operator: ADDRESSES.setupOwner,
    },
    caps: validCaps(),
    mainnetApproved: '1',
    mainnetReadyChecklist: '1',
    readinessManifest: validReadinessManifest(),
  }), /operator must be separate from setup owner/);
});

test('rejects invalid cap input before any deployment transaction is sent', () => {
  assert.throws(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'galleon', mainnet: false },
    roles: validRoles(),
    caps: {
      ...validCaps(),
      minDepositGrains: 0n,
    },
  }), /PEARL_BRIDGE_MIN_DEPOSIT_GRAINS must be greater than zero/);

  assert.throws(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'galleon', mainnet: false },
    roles: validRoles(),
    caps: {
      ...validCaps(),
      maxDepositGrains: 10n,
      maxExitGrains: 10n,
      rollingWindowMintCapGrains: 2_000n,
      pilotSupplyCapGrains: 1_000n,
    },
  }), /PEARL_BRIDGE_ROLLING_WINDOW_MINT_CAP_GRAINS must be <= PEARL_BRIDGE_PILOT_SUPPLY_CAP_GRAINS/);
});

test('accepts separated mainnet roles and valid guarded pilot caps', () => {
  assert.doesNotThrow(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'igra-mainnet', chainId: 38833n, mainnet: true },
    roles: validRoles(),
    caps: validCaps(),
    mainnetApproved: '1',
    mainnetReadyChecklist: '1',
    readinessManifest: validReadinessManifest(),
  }));
});

test('requires readiness manifest to match the exact mainnet deployment roles', () => {
  assert.throws(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'igra-mainnet', chainId: 38833n, mainnet: true },
    roles: validRoles(),
    caps: validCaps(),
    mainnetApproved: '1',
    mainnetReadyChecklist: '1',
    readinessManifest: {
      ...validReadinessManifest(),
      relayer: ADDRESSES.operator,
    },
  }), /relayer address must match deployment environment/);

  assert.throws(() => validatePearlBridgeDeploymentReadiness({
    network: { name: 'igra-mainnet', chainId: 38833n, mainnet: true },
    roles: validRoles(),
    caps: validCaps(),
    mainnetApproved: '1',
    mainnetReadyChecklist: '1',
    readinessManifest: {
      ...validReadinessManifest(),
      poolSeedingApproved: true,
    },
  }), /must not approve pool seeding/);
});

test('mainnet deploy script refuses approval gaps before requiring RPC or signer setup', () => {
  const env = {
    ...process.env,
    PEARL_BRIDGE_DEPLOY_NETWORK: 'igra-mainnet',
  };
  for (const key of [
    'PEARL_BRIDGE_MAINNET_APPROVED',
    'PEARL_BRIDGE_MAINNET_READY_CHECKLIST',
    'PEARL_BRIDGE_RPC_URL',
    'IGRA_RPC_URL',
    'PEARL_BRIDGE_DEPLOYER_PRIVATE_KEY',
    'IGRA_DEPLOYER_KEY',
  ]) {
    delete env[key];
  }

  const result = spawnSync(process.execPath, ['scripts/deploy-pearl-bridge.mjs'], {
    cwd: CONTRACT_ROOT,
    env,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /PEARL_BRIDGE_MAINNET_APPROVED=1/);
  assert.doesNotMatch(output, /Missing PEARL_BRIDGE_RPC_URL|Missing PEARL_BRIDGE_DEPLOYER_PRIVATE_KEY/);
});

test('mainnet deploy script requires readiness manifest before requiring RPC or signer setup', () => {
  const env = {
    ...process.env,
    PEARL_BRIDGE_DEPLOY_NETWORK: 'igra-mainnet',
    PEARL_BRIDGE_MAINNET_APPROVED: '1',
    PEARL_BRIDGE_MAINNET_READY_CHECKLIST: '1',
    PEARL_BRIDGE_FINAL_OWNER: ADDRESSES.finalOwner,
    PEARL_BRIDGE_RELAYER: ADDRESSES.relayer,
    PEARL_BRIDGE_OPERATOR: ADDRESSES.operator,
  };
  for (const key of [
    'PEARL_BRIDGE_MAINNET_READY_FILE',
    'PEARL_BRIDGE_RPC_URL',
    'IGRA_RPC_URL',
    'PEARL_BRIDGE_DEPLOYER_PRIVATE_KEY',
    'IGRA_DEPLOYER_KEY',
  ]) {
    delete env[key];
  }

  const result = spawnSync(process.execPath, ['scripts/deploy-pearl-bridge.mjs'], {
    cwd: CONTRACT_ROOT,
    env,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /PEARL_BRIDGE_MAINNET_READY_FILE/);
  assert.doesNotMatch(output, /Missing PEARL_BRIDGE_RPC_URL|Missing PEARL_BRIDGE_DEPLOYER_PRIVATE_KEY/);
});

function validRoles() {
  return {
    owner: ADDRESSES.setupOwner,
    finalOwner: ADDRESSES.finalOwner,
    relayer: ADDRESSES.relayer,
    operator: ADDRESSES.operator,
  };
}

function validCaps() {
  return {
    minDepositGrains: 1n,
    maxDepositGrains: 100_000_000n,
    minExitGrains: 1n,
    maxExitGrains: 100_000_000n,
    rollingWindowSeconds: 86_400n,
    rollingWindowMintCapGrains: 100_000_000n,
    pilotSupplyCapGrains: 100_000_000n,
  };
}

function validReadinessManifest() {
  return {
    network: 'igra-mainnet',
    chainId: '38833',
    mainnetApproved: true,
    readinessChecklistComplete: true,
    approvedBy: 'sione',
    approvedAt: '2026-05-19T00:00:00.000Z',
    finalOwner: ADDRESSES.finalOwner,
    finalOwnerKind: 'approved_multisig',
    relayer: ADDRESSES.relayer,
    operator: ADDRESSES.operator,
    adminPolicyApproved: true,
    signerSeparationApproved: true,
    reservePolicyApproved: true,
    lowCapPilotApproved: true,
    poolSeedingApproved: false,
  };
}
