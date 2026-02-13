# Timeline Module Layout

Timeline internals were split so `index.js` stays focused on orchestration.

## Files

- `index.js`
  - Public timeline API and rebuild/projection/checkpoint orchestration.
- `action-index.js`
  - Action-second indexing, sorted second caches, and index invalidation helpers.
- `memo-cache.js`
  - Memoized state-data cache sizing and nearest-state lookup helpers.
- `mutation-signature.js`
  - Mutation signature computation/comparison utilities.

## Compatibility

- `src/model/timeline.js` re-exports from `src/model/timeline/index.js` so
  existing imports keep working during migration.
