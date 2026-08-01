/**
 * @noxstream/shared — the single source of truth shared by the contracts,
 * the deploy scripts, the tests and the frontend.
 *
 * Anything that must agree across those four places lives here: Nox network
 * parameters, the encrypted-payload shape, salary-rate maths, and the
 * deployment record the deploy script emits.
 */

export * from "./nox.js";
export * from "./types.js";
