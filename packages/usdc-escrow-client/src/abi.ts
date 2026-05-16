export const PRL_USDC_ESCROW_ABI = [
  'event TradeCreated(bytes32 indexed tradeId, address indexed buyer, address indexed seller, uint256 amount, uint256 fee, uint64 expiry)',
  'event Deposited(bytes32 indexed tradeId, address indexed payer, uint256 amount)',
  'event Released(bytes32 indexed tradeId, address indexed seller, uint256 sellerAmount, uint256 feeAmount)',
  'event Refunded(bytes32 indexed tradeId, address indexed buyer, uint256 amount)',
  'event Cancelled(bytes32 indexed tradeId)',
  'function createTrade(bytes32 tradeId, address buyer, address seller, uint256 amount, uint256 fee, uint64 expiry)',
  'function deposit(bytes32 tradeId)',
  'function release(bytes32 tradeId)',
  'function refund(bytes32 tradeId)',
  'function cancelExpired(bytes32 tradeId)',
] as const;
