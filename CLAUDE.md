# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Brute-force search for Bitcoin private keys within the predefined "Bitcoin Puzzle" key-space ranges (puzzles 1–160). For each candidate private key in a range, derive the compressed P2PKH `hash160` and compare against a hardcoded target set. Found keys are written to `new_million.txt`.

Requires Node.js 20.x. Runtime deps: `secp256k1` (native bindings, ECC) and `bs58check` (base58check encode/decode). `bs58check` v4 is ESM-only — in CJS it must be required as `require('bs58check').default`.

## Commands

```bash
npm install          # install deps
node index.js        # single-threaded search, hardcoded to ranges[67]
node main.js         # interactive multi-threaded search (prompts for puzzle, mode, threads)
node time.js         # print time-to-exhaust estimates at various hash rates for ranges[67]
```

There are no tests, lint, or build steps. The `main` field in `package.json` points at `index.js` but the project is not published as a library — entry points are run directly with `node`.

`main.js` prompts on stdin for: puzzle number (1–160), search mode (`1` sequential / `2` random), thread count (capped at `os.cpus().length`).

## Architecture

Three independent entrypoints share two data modules in `utils/`:

- `utils/ranges.js` — array indexed by puzzle number. Each entry is `{ min, max, status, range }` with `min`/`max` as `BigInt` literals (`0x...n`). Index 0 and 1 are both puzzle 1 (the array is 1-indexed in practice — `ranges[67]` is puzzle 67). All key arithmetic across the project assumes BigInt; do not convert to Number except for display/percentage math.
- `utils/wallets.js` — at load time, decodes each base58check P2PKH address to its 20-byte `hash160` and exports a `Set<string>` of those (hex). The original base58 set is exposed as `module.exports.addresses`. The hot loop compares against `hash160`, never against the base58 form — `bs58check.encode` is too expensive to run per iteration.

### Hot-loop derivation pipeline

Both `index.js` and the worker in `main.js` use the same derivation:

1. `writeBigInt32BE(key, privBuf)` — write the BigInt private key into a pre-allocated 32-byte `Buffer` (no `toString(16)` / `Buffer.from(hex)` allocations).
2. `secp.publicKeyCreate(privBuf, true)` — compressed public key, 33 bytes (native libsecp256k1 binding).
3. `crypto.createHash('sha256').update(pub).digest()` → `crypto.createHash('ripemd160')...` — produces the 20-byte `hash160`.
4. `wallets.has(rip.toString('hex'))` — O(1) Set lookup. On hit, only then call `hash160ToAddress(rip)` (base58check encode of `0x00 || rip`) and `privToWIF(privBuf)` (base58check encode of `0x80 || priv || 0x01`).

The base58 form of the *current* key is computed only every 1000 iterations (for the progress log) and once on hit — never per iteration.

### `main.js` — multi-threaded worker pool (the real tool)

Uses Node's `worker_threads` with `isMainThread` to fork the same file:

- **Main thread**: reads CLI input, then dispatches per mode:
  - **Sequential (`mode === 1`)**: splits `[min, max]` into `numThreads` equal `BigInt` chunks (last chunk absorbs the remainder).
  - **Random (`mode === 2`)**: every thread receives the full `[min, max]` — collision is negligible at puzzle scale and aggregate coverage is better than partitioning.
  
  Spawns one `Worker` per slot with `{ start, end, threadId, mode }` via `workerData`. Maintains `threadLogs[]`; on each worker progress message it overwrites `threadLogs[threadId]` and reprints all rows in place via `process.stdout.write('\x1B[0;0H')` + `console.clear()`. On `found: true` it writes `new_million.txt` and `process.exit(0)`s the whole pool.

- **Worker thread**: holds the current public-key point `pub` (compressed, 33 bytes) across iterations and advances it differently per mode:
  - **Sequential**: `pub = secp.publicKeyTweakAdd(pub, ONE_BUF, true)` (EC point addition by `+G`) and `key += 1n`. Only re-derives via `publicKeyCreate` on range wrap (`key > end → key = start`). The `privBuf` is incremented in-place at the LSB; on byte overflow (`privBuf[31] === 0`) it is rewritten from `key`.
  - **Random**: a CSPRNG pool (`crypto.randomBytes(4096)`) is sliced into `rByteLen`-byte chunks, each masked at the top byte to the rangeSize bit-length and accepted if `< rangeSize` (rejection sampling — uniform in `[0, rangeSize)`). The full `publicKeyCreate(privBuf, true)` runs every iteration since the key jumps arbitrarily.
  
  Posts a progress log every 1000 iterations (terminal I/O throttle). Posts `{ found, threadId, privKey, wif, publicAddr }` and `break`s on a hit.

### `index.js` — single-threaded reference implementation

Sequential scan from `min` to `max` of `ranges[67]`, using the same derivation pipeline as the worker but **without** the `tweakAdd` optimization (every iteration calls `publicKeyCreate`). It also calls `console.clear()` + `console.log` on every iteration, which is the dominant cost. Useful as a readable spec for what the worker version does.

### `time.js` — utility, not part of the search

Stand-alone calculator: prints how long it would take to exhaust `ranges[67]` at hash rates from kH/s to YH/s. No interaction with the worker pool.

## Conventions to preserve

- **BigInt everywhere for keys.** `min`, `max`, `key`, `rangeSize` are all BigInt. Only convert to `Number` for percentage display or random-byte chunk size — never carry the full key range through `Number`.
- **Compare by `hash160`, not by base58 address.** The wallet Set holds hash160 hex; the hot loop must too. `bs58check.encode` only runs at log time (1/1000) and on hit. Do not regress this by reintroducing base58 comparisons.
- **`pub` is stateful in the sequential worker.** It is initialized once via `publicKeyCreate` and advanced per iteration via `publicKeyTweakAdd`. Any code path that mutates `key` non-incrementally (random mode, range wrap) must also re-derive `pub` via `publicKeyCreate` to resync.
- **`privBuf` is a single pre-allocated 32-byte Buffer.** Reuse it; do not allocate new buffers in the loop. The LSB-increment + byte-overflow recompute pattern in sequential mode is intentional.
- **`main.js` is both main and worker** in one file — guarded by `isMainThread`. New top-level code runs in *both* contexts; put main-only logic inside the `if (isMainThread)` branch and worker-only logic inside the `else`.
- **Progress logging is throttled** in workers (`cont % 1000 === 0`). Do not log on every iteration — `index.js` demonstrates how much that costs.
- **Random mode must use the CSPRNG pool + rejection sampling**, not `Math.random()`. The previous step-based scheme biased toward the start of the range and was correlated like an LCG.
- **Found-key output** goes to `new_million.txt` at the repo root via `fs.writeFileSync`. Verify before changing the filename — `.gitignore` references it.
- All user-facing strings (prompts, logs) are in **Portuguese**. Match that tone when adding new ones.
