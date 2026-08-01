/**
 * The single place the frontend describes the on-chain surface.
 *
 * Transcribed from the COMPILED artifacts of the deployed implementations
 * (`packages/contracts/artifacts/contracts/*.sol/*.json`), not from the
 * coordination interfaces — the implementations are a strict superset
 * (`isActive`, `payroll()`, `VaultUnfunded`, `lastAccrualAt`, `payoutAsset`
 * exist on-chain but not on the `I*` interfaces) and the superset is what the
 * UI actually has to talk to.
 *
 * They are written out `as const` rather than imported from the JSON so viem
 * can infer argument and return types; a widened JSON import would make every
 * call site a cast.
 *
 * `euint256` / `externalEuint256` are Solidity user-defined value types over
 * `bytes32`, so they appear here as `bytes32`. That is precisely what a handle
 * is: 32 bytes of pointer, carrying no value.
 *
 * If the contracts change, change them HERE and nowhere else.
 */

export const payrollRegistryAbi = [
  {
    type: "function",
    name: "setAllocation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "employee", type: "address" },
      { name: "encryptedRate", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [{ name: "rate", type: "bytes32" }],
  },
  {
    type: "function",
    name: "setAllocations",
    stateMutability: "nonpayable",
    inputs: [
      { name: "employees", type: "address[]" },
      { name: "encryptedRates", type: "bytes32[]" },
      { name: "inputProofs", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeAllocation",
    stateMutability: "nonpayable",
    inputs: [{ name: "employee", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setPayroll",
    stateMutability: "nonpayable",
    inputs: [{ name: "payroll_", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "ratePerSecondOf",
    stateMutability: "view",
    inputs: [{ name: "employee", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [{ name: "employee", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    /** Registered AND not revoked — i.e. still accruing. */
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "employee", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "employeeCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "employeeAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "employer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    /** The payroll contract wired to this registry. Zero until setPayroll. */
    type: "function",
    name: "payroll",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "AllocationSet",
    inputs: [
      { name: "employee", type: "address", indexed: true },
      { name: "ratePerSecond", type: "bytes32", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "AllocationRevoked",
    inputs: [{ name: "employee", type: "address", indexed: true }],
    anonymous: false,
  },
  {
    type: "event",
    name: "PayrollSet",
    inputs: [{ name: "payroll", type: "address", indexed: true }],
    anonymous: false,
  },
  { type: "error", name: "NotEmployer", inputs: [] },
  { type: "error", name: "EmployeeIsZeroAddress", inputs: [] },
  { type: "error", name: "AlreadyRegistered", inputs: [] },
  { type: "error", name: "NotRegistered", inputs: [] },
  { type: "error", name: "ArrayLengthMismatch", inputs: [] },
  { type: "error", name: "IndexOutOfBounds", inputs: [] },
  { type: "error", name: "PayrollIsZeroAddress", inputs: [] },
] as const;

export const streamPayrollAbi = [
  {
    type: "function",
    name: "start",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "claimed", type: "bytes32" }],
  },
  {
    type: "function",
    name: "harvest",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "publicAmount", type: "uint256" }],
  },
  {
    /** Permissionless: rolls one employee's accrual forward to `now`. */
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "employee", type: "address" }],
    outputs: [{ name: "accrued", type: "bytes32" }],
  },
  {
    type: "function",
    name: "confidentialAccruedOf",
    stateMutability: "view",
    inputs: [{ name: "employee", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "confidentialClaimedOf",
    stateMutability: "view",
    inputs: [{ name: "employee", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    /** Public: when this employee's accrual was last rolled forward. */
    type: "function",
    name: "lastAccrualAt",
    stateMutability: "view",
    inputs: [{ name: "employee", type: "address" }],
    outputs: [{ name: "at", type: "uint64" }],
  },
  {
    type: "function",
    name: "confidentialToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "payoutAsset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "registry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "streamAdapter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "startedAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "event",
    name: "ConfidentialClaim",
    inputs: [
      { name: "employee", type: "address", indexed: true },
      { name: "amount", type: "bytes32", indexed: true },
      { name: "epoch", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Harvested",
    inputs: [
      { name: "publicAmount", type: "uint256", indexed: false },
      { name: "epoch", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PayrollStarted",
    inputs: [{ name: "startedAt", type: "uint64", indexed: false }],
    anonymous: false,
  },
  { type: "error", name: "NotRegistered", inputs: [] },
  { type: "error", name: "NotEmployer", inputs: [] },
  { type: "error", name: "PayrollNotStarted", inputs: [] },
  { type: "error", name: "AlreadyStarted", inputs: [] },
  { type: "error", name: "NothingToHarvest", inputs: [] },
  { type: "error", name: "VaultUnfunded", inputs: [] },
  { type: "error", name: "AssetMismatch", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [{ name: "token", type: "address" }],
  },
] as const;

export const streamAdapterAbi = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "fundStream",
    stateMutability: "nonpayable",
    inputs: [
      { name: "totalAmount", type: "uint256" },
      { name: "duration", type: "uint40" },
    ],
    outputs: [{ name: "streamId", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawableAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "harvest",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "streamId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "protocolTag",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    /**
     * Sablier v3.0+ charges a native-token fee per withdrawal, so the adapter
     * keeps an ETH tank. `harvest()` reverts when it runs dry.
     */
    type: "function",
    name: "feeTankBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    /** Exact wei Sablier will charge for the next withdrawal. */
    type: "function",
    name: "minHarvestFeeWei",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "LOCKUP",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "VAULT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "TREASURY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "FeeTankFunded",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "StreamFunded",
    inputs: [
      { name: "streamId", type: "uint256", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "duration", type: "uint40", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "StreamHarvested",
    inputs: [
      { name: "streamId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "NotTreasury", inputs: [] },
  { type: "error", name: "StreamAlreadyOpen", inputs: [] },
  { type: "error", name: "NoStream", inputs: [] },
  { type: "error", name: "ZeroDuration", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "EthTransferFailed", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  {
    type: "error",
    name: "InsufficientFeeTank",
    inputs: [
      { name: "required", type: "uint256" },
      { name: "available", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "AmountTooLarge",
    inputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "error",
    name: "UnauthorizedDestination",
    inputs: [{ name: "to", type: "address" }],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [{ name: "token", type: "address" }],
  },
] as const;

/**
 * The testnet payout asset is MockUSDC — a public faucet-style ERC-20 with an
 * open `mint`. Real USDC drops into the same slot unchanged (the adapter takes
 * its asset as a constructor argument), so the UI probes for `mint` rather than
 * assuming it: the affordance only appears where it genuinely exists.
 */
export const mintableErc20Abi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** The public payout asset (USDC-like). Only what this app actually calls. */
export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/**
 * ERC-7984 confidential payout token (cUSDC). `confidentialBalanceOf` returns
 * a handle — the employee's wallet balance is itself ciphertext.
 */
export const erc7984Abi = [
  {
    type: "function",
    name: "confidentialBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "confidentialTotalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    /** Public upper bound on supply — deliberately NOT the real total. */
    type: "function",
    name: "inferredTotalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "underlying",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "event",
    name: "ConfidentialTransfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "bytes32", indexed: true },
    ],
    anonymous: false,
  },
] as const;

/**
 * NoxCompute's ACL introspection. Reading this is how the UI knows whether the
 * padlock on a row is open or shut BEFORE asking the user for a signature —
 * the lock state is on-chain fact, not a guess.
 */
export const noxComputeAclAbi = [
  {
    type: "function",
    name: "isViewer",
    stateMutability: "view",
    inputs: [
      { name: "handle", type: "bytes32" },
      { name: "viewer", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isPubliclyDecryptable",
    stateMutability: "view",
    inputs: [{ name: "handle", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
