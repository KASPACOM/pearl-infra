export function validatePearlBridgeDeploymentReadiness(input) {
  validateBridgeCaps(input.caps);
  if (!input.network.mainnet) return;

  if (input.mainnetApproved !== '1') {
    throw new Error('Igra mainnet deployment requires PEARL_BRIDGE_MAINNET_APPROVED=1');
  }
  if (input.mainnetReadyChecklist !== '1') {
    throw new Error('Igra mainnet deployment requires PEARL_BRIDGE_MAINNET_READY_CHECKLIST=1');
  }
  if (!input.roles.finalOwner) {
    throw new Error('Igra mainnet deployment requires PEARL_BRIDGE_FINAL_OWNER');
  }

  assertDistinctRoles([
    ['setup owner', input.roles.owner],
    ['final owner', input.roles.finalOwner],
    ['relayer', input.roles.relayer],
    ['operator', input.roles.operator],
  ]);
  validateReadinessManifest(input.readinessManifest, input);
}

export function validateBridgeCaps(caps) {
  requirePositive(caps.minDepositGrains, 'PEARL_BRIDGE_MIN_DEPOSIT_GRAINS');
  requireGte(caps.maxDepositGrains, caps.minDepositGrains, 'PEARL_BRIDGE_MAX_DEPOSIT_GRAINS must be >= PEARL_BRIDGE_MIN_DEPOSIT_GRAINS');
  requirePositive(caps.minExitGrains, 'PEARL_BRIDGE_MIN_EXIT_GRAINS');
  requireGte(caps.maxExitGrains, caps.minExitGrains, 'PEARL_BRIDGE_MAX_EXIT_GRAINS must be >= PEARL_BRIDGE_MIN_EXIT_GRAINS');
  requireGte(caps.pilotSupplyCapGrains, caps.maxDepositGrains, 'PEARL_BRIDGE_PILOT_SUPPLY_CAP_GRAINS must be >= PEARL_BRIDGE_MAX_DEPOSIT_GRAINS');
  requireGte(caps.pilotSupplyCapGrains, caps.maxExitGrains, 'PEARL_BRIDGE_PILOT_SUPPLY_CAP_GRAINS must be >= PEARL_BRIDGE_MAX_EXIT_GRAINS');

  if (caps.rollingWindowMintCapGrains > 0n) {
    requirePositive(caps.rollingWindowSeconds, 'PEARL_BRIDGE_ROLLING_WINDOW_SECONDS');
    requireGte(caps.rollingWindowMintCapGrains, caps.minDepositGrains, 'PEARL_BRIDGE_ROLLING_WINDOW_MINT_CAP_GRAINS must be >= PEARL_BRIDGE_MIN_DEPOSIT_GRAINS');
    requireGte(caps.pilotSupplyCapGrains, caps.rollingWindowMintCapGrains, 'PEARL_BRIDGE_ROLLING_WINDOW_MINT_CAP_GRAINS must be <= PEARL_BRIDGE_PILOT_SUPPLY_CAP_GRAINS');
  }
}

function validateReadinessManifest(manifest, input) {
  if (!isRecord(manifest)) throw new Error('Igra mainnet deployment requires a readiness manifest object');
  requireEqual(manifest.network, input.network.name, 'readiness manifest network mismatch');
  requireEqual(String(manifest.chainId), String(input.network.chainId), 'readiness manifest chainId mismatch');
  requireTrue(manifest.mainnetApproved, 'readiness manifest must approve mainnet deployment');
  requireTrue(manifest.readinessChecklistComplete, 'readiness manifest checklist must be complete');
  requireNonEmptyString(manifest.approvedBy, 'readiness manifest approvedBy required');
  requireNonEmptyString(manifest.approvedAt, 'readiness manifest approvedAt required');
  requireEnum(manifest.finalOwnerKind, ['approved_multisig', 'approved_testnet_owner'], 'readiness manifest finalOwnerKind invalid');
  requireAddressMatch(manifest.finalOwner, input.roles.finalOwner, 'final owner');
  requireAddressMatch(manifest.relayer, input.roles.relayer, 'relayer');
  requireAddressMatch(manifest.operator, input.roles.operator, 'operator');
  requireTrue(manifest.adminPolicyApproved, 'readiness manifest must approve bridge admin policy');
  requireTrue(manifest.signerSeparationApproved, 'readiness manifest must approve signer separation');
  requireTrue(manifest.reservePolicyApproved, 'readiness manifest must approve reserve policy');
  requireTrue(manifest.lowCapPilotApproved, 'readiness manifest must approve low-cap pilot');
  if (manifest.poolSeedingApproved === true) {
    throw new Error('readiness manifest must not approve pool seeding as part of bridge deployment');
  }
}

function assertDistinctRoles(entries) {
  const seen = new Map();
  for (const [label, address] of entries) {
    if (!address) continue;
    const normalized = address.toLowerCase();
    const prior = seen.get(normalized);
    if (prior) {
      throw new Error(`Igra mainnet ${label} must be separate from ${prior}`);
    }
    seen.set(normalized, label);
  }
}

function requirePositive(value, name) {
  if (value <= 0n) throw new Error(`${name} must be greater than zero`);
}

function requireGte(left, right, message) {
  if (left < right) throw new Error(message);
}

function requireAddressMatch(actual, expected, label) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`readiness manifest ${label} address must match deployment environment`);
  }
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message);
}

function requireTrue(value, message) {
  if (value !== true) throw new Error(message);
}

function requireNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message);
}

function requireEnum(value, allowed, message) {
  if (!allowed.includes(value)) throw new Error(message);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
