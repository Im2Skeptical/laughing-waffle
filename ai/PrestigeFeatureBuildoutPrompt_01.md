You are a coding agent working in an existing deterministic single-player JS game (PixiJS renderer, pure-JS authoritative model) with full deterministic replay + time travel. You MUST preserve determinism, serialization, and replay invariants. You MUST make coherent, large-file rewrites where helpful, and remove/replace older bespoke logic rather than adding shims. Provide changes as full-file replacements where practical.

GOAL
Implement a v1 “Prestige + Followers + Granary Deposit Store” system consistent with the existing data-driven/tag-based architecture.

HIGH-LEVEL BEHAVIOR (LOCKED)
1) Two pawn roles: leaderPawn and followerPawn.
2) A hubStructure “Granary” supports a DEPOSIT affordance:
   - If a leader or one of its attached followers is occupying the granary’s hub footprint and carries grain (tagged), then on the next per-second hub tick, grain is consumed from the pawn inventory and converted into a granary store (system values) rather than remaining as inventory items.
   - Deposit requires occupancy of the granary footprint (no range checks for deposit).
3) Granary store is PER ITEM TYPE AND TIER, and supports tiered prestige gains:
   - Items have a `tier` field (already used by stacking rules). Use that.
   - Store tracks quantities by (itemKind, itemTier).
   - Deposits award prestige-cap increases using diminishing returns curves per tier:
     prestigeCapFromTier = floor(A_tier * sqrt(totalDepositedAmountByTier)).
   - Total prestigeCapBase is the sum of prestige from all tiers (and applicable grain kinds).
   - Prestige is awarded from deposit DELTAS (consuming items into store), not from inventory presence.
   - No withdrawals exist in v1.
   - `totalDepositedAmountByTier` is tracked per leader pawn and includes deposits performed by attached followers.
4) Followers cost reserved prestige:
   - Each follower costs `prestigeCostPerFollower` (default 10; defined in defs).
   - Hovering a leader shows a UI panel section where the player can increase/decrease follower count.
   - This is a timeline action (recorded/replayed).
   - Reserved prestige = followerCount * prestigeCostPerFollower.
   - Followers spawn on the leader’s hub footprint.
5) Hunger penalty as prestige cap damage with exposure time:
   - Followers can apply permanent (no recovery in v1) prestigeCapDebt to their leader if hungry.
   - Penalties do NOT tick while paused.
   - A follower must remain below hungerThreshold for N consecutive seconds before penalties apply.
   - Once exposure is met, each hungry follower applies
     `prestigeDebtPerHungryFollower` every `prestigeDebtCadenceSec`.
   - Leader has:
     - prestigeCapBase (from deposits),
     - prestigeCapDebt (accumulated),
     - prestigeCapEffective = max(0, prestigeCapBase - min(prestigeCapDebt, prestigeCapBase)).
   - UI should be able to attribute debt to hungry followers.
6) Forced despawn when reserved exceeds effective cap:
   - If prestigeCapEffective < reservedPrestige, despawn followers until valid.
   - Deterministic order: last-added-first using followerCreationOrderIndex.
   - Forced despawn transfers as many items as possible follower→leader, deleting overflow.
7) Manual minus behavior (player-initiated despawn):
   - Attempt to transfer items follower→leader using inventory grid order.
   - Partial transfers are COMMITTED even if despawn is blocked.
   - If not all items could be transferred, block despawn and show follower inventory with red warning feedback.
8) No withdrawals from granary store in v1.
   - Do not implement eating-from-store in v1 unless trivial. If included:
     - Withdrawals require adjacency to granary span.
     - Deposits still require footprint occupancy.

IMPLEMENTATION REQUIREMENTS
- Determinism:
  - No nondeterministic iteration.
  - No wall-clock time, randomness, or UI state influencing sim results.
- Replay/time travel:
  - Plus/minus follower changes are timeline actions.
  - Hub and pawn per-second ticks must replay identically in live and projection.
- Serialization:
  - New fields must be plain JSON.
  - Rebuild any derived indices on deserialize.
- Data-driven:
  - Defs must include:
    - prestigeCostPerFollower
    - hungerThreshold
    - secondsBelowHungerThreshold (N)
    - prestigeDebtCadenceSec
    - prestigeDebtPerHungryFollower
    - per-tier A values for prestige curves
  - Grain identified by tag “grain” and itemKind + itemTier.
- Cleanup:
  - Remove or refactor any older bespoke logic replaced by this system.
  - Maintain one clear location for:
    (a) granary deposit conversion
    (b) prestige math
    (c) hunger debt accumulation
    (d) follower spawn/despawn

WHERE THINGS SHOULD LIVE (GUIDANCE)
- Character state:
  - leader: role="leader", followerIds (or derived), prestigeCapBase fields, prestigeCapDebt
  - follower: role="follower", leaderId, followerCreationOrderIndex
- Granary store:
  - Structure systemState stores quantities by (itemKind,itemTier)
- Deposit logic:
  - Implemented in hub per-second execution
- Actions:
  - New action kind to increase/decrease follower target count
- UI:
  - Extend existing pawn hover panel
  - Dispatch actions via runner/timeline only

STEP-BY-STEP TASK PLAN

1. **Recon & contracts**

   * Identify existing defs/files for hub tags/structures, pawn systems, item defs (tier + grain tag), hover UI entry point, inventory transfer APIs.
   * Confirm determinism/replay constraints for any new logic.

2. **Defs**

   * Add Granary deposit affordance/tag.
   * Add prestige tuning fields: `prestigeCostPerFollower`, `hungerThreshold`, `secondsBelowHungerThreshold`, `prestigeDebtCadenceSec`, `prestigeDebtPerHungryFollower`, per-tier `prestigeCurveAByTier`.

3. **State + linkage**

   * Add leader/follower role fields and linkage (`leaderId`, follower ordering).
   * Add leader prestige fields: `totalDepositedAmountByTier`, `prestigeCapDebt`.
   * Add state counter `nextFollowerCreationOrderIndex` (monotonic int) for deterministic last-added-first.

4. **Granary deposit → store → prestige**

   * Hub per-second: detect pawns on granary footprint.
   * Consume grain from pawn inventory deterministically.
   * Increment granary store quantities by (itemKind,itemTier).
   * Increment leader `totalDepositedAmountByTier` and recompute `prestigeCapBase` (sum over tiers of floor(A*sqrt(totalDeposited))).

5. **Follower spawn/despawn**

   * New timeline action for +/− follower count.
   * Spawn on leader footprint; deterministic ordering index.
   * Despawn rules:

     * manual: partial transfer then block removal if items remain
     * forced: partial transfer then delete overflow
   * Enforce forced despawn when reserved > `prestigeCapEffective` using last-added-first.

6. **Hunger exposure → debt**

   * Per-second pawn tick: track consecutive seconds below hunger threshold in follower systemState.
   * Once exposure met, apply debt every cadence while hungry.
   * Cap debt against base cap, compute effective cap.

7. **UI**

   * Leader hover panel shows: `prestigeCapEffective / prestigeCapBase`, reserved, follower count with +/−.
   * Show hungry follower attribution summary.
   * On blocked manual minus: show follower inventory + red warning feedback.

8. **Smoke tests**

   * Deposit once increases cap; move/scrub/replay matches.
   * Hunger exposure then cadence applies debt; debt capped.
   * Forced despawn triggers deterministically; manual minus blocks with partial transfers committed.
   * No withdrawals implemented.