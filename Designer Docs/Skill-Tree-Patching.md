# Skill Tree Defs Patching

Use the patch script to apply editor exports into `src/defs/gamepieces/skill-tree-defs.js`.

## Command

```bash
npm run skill:apply-export -- --input <path-to-export.json> [options]
```

## Default behavior

- Dry-run only (no file writes).
- `basic` stage.
- Existing node `onUnlock`/`onLock` hooks are preserved.
- Legacy `effects` payload fields are auto-migrated to `onUnlock`.

## Common options

- `--write`  
  Persist changes to defs file.
- `--stage basic|robust`  
  `basic` updates existing nodes only.  
  `robust` supports extra controls below.
- `--tree-id <id>`  
  Force target tree id.
- `--allow-create`  
  (`robust`) allow creating missing nodes.
- `--delete-missing`  
  (`robust`) delete target-tree nodes not present in incoming payload.
- `--rename-map <json-file>`  
  (`robust`) map old id -> new id.
- `--no-backup`  
  disable timestamped `.bak` backup when writing.

## Input formats supported

- Layout export  
  `{ treeId, nodes: { [nodeId]: { uiPos, uiNodeRadius? } } }`
- Runtime export wrapper  
  `{ runtimeDefs: { skillTrees, skillNodes } }`
- Runtime defs  
  `{ skillTrees, skillNodes }`
- Editor export  
  `{ treeId, tree, nodes: [...], edges: [...] }`

## Examples

Layout-only apply:

```bash
npm run skill:apply-export -- --input .\exports\layout.json --stage basic --write
```

Robust apply with create + rename:

```bash
npm run skill:apply-export -- --input .\exports\runtime.json --stage robust --allow-create --rename-map .\exports\rename-map.json --write
```

Robust apply with create + rename:

```bash
npm run skill:apply-export -- --input .\exports\runtime.json --stage robust --allow-create --delete-missing --write
```

