## ADDED Requirements

### Requirement: Pearl Pay rails
The system SHALL define service interfaces for payment links, invoice status, confirmation tracking, merchant callbacks, and hosted checkout flows using PRL transfers.

#### Scenario: Buyer pays invoice
- **WHEN** PRL is received at the invoice address with required confirmations
- **THEN** the payment service marks the invoice paid and emits the configured merchant callback once

### Requirement: OTC market data rails
The system SHALL ingest and normalize public Pearl OTC market data such as offers, trades, volume, active liquidity, and price levels without requiring custody or trade execution in the first phase.

#### Scenario: User views PRL market
- **WHEN** the market app loads
- **THEN** it shows normalized active buy/sell offers, recent trade stats, and liquidity levels with source timestamps

### Requirement: Pearl OTC settlement desk
The system SHALL define a quote-based PRL/USDC settlement desk that coordinates Pearl Taproot escrow with Base USDC escrow before any full order-book marketplace is implemented.

#### Scenario: Buyer accepts a firm PRL quote
- **WHEN** a buyer accepts an unexpired quote
- **THEN** the system creates a trade with fixed PRL amount, USDC amount, fee, expiry, Pearl escrow requirements, and Base USDC escrow requirements

#### Scenario: Both settlement legs are funded
- **WHEN** Pearl escrow and Base USDC escrow both reach the configured confirmation threshold
- **THEN** the settlement worker is authorized to release PRL and USDC according to the trade terms exactly once

### Requirement: Escrow proof indexer
The system SHALL define indexer data models and APIs that allow a public proof page to reconstruct trade state from Pearl and Base observations.

#### Scenario: User opens trade proof page
- **WHEN** a user opens the public proof page for a trade
- **THEN** the page shows quote terms, Pearl escrow outpoint, USDC escrow transaction, release or refund transaction, confirmation counts, and source timestamps

### Requirement: Escrow flow research boundary
The system SHALL document Pearl-compatible escrow and multisig possibilities separately from production implementation.

#### Scenario: Escrow feature is proposed
- **WHEN** a developer starts an escrow implementation task
- **THEN** the task references verified Pearl script/wallet capabilities and includes a security review gate before mainnet use

### Requirement: AI compute marketplace interfaces
The system SHALL define interfaces for model catalog, GPU operator registration, health checks, inference routing, usage metering, billing, and PRL reward reporting without requiring immediate production marketplace launch.

#### Scenario: GPU operator connects
- **WHEN** an operator registers a Pearl-certified model endpoint
- **THEN** the control plane can track endpoint health, model identity, wallet address, capacity, and usage metrics separately from user billing
