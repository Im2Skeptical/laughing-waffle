Stage-1 usage notes:
These schemas are to be populated with mostly no-op or debug gamepieces.
Correct shape and ID stability matter more than meaningful gameplay effects.
onTick exists for future use; Stage-1 events may omit it or use no-op effects.
Prefer { ref:"self" } targeting in Stage-1 defs unless cross-tile behavior is explicitly desired.

## v1 Schemas

Below are the **schemas for all relevant types** plus **one canonical example each**.

---

# 0) Shared primitives

### Tier

```js
type Tier = "bronze" | "silver" | "gold" | "diamond";
```

### Layer

```js
type Layer = "tile" | "event" | "permanent";
```

### TargetSpec

```js
type TargetSpec =
  | { at: { layer: Layer, col: number } }
  | { ref: "self", layer: Layer };
```

Span policy:

* `ref:"self"` resolves across the source piece’s occupied columns; de-dup by instanceId.

---

# 1) EnvTagDef (tag registry)

### Schema

```js
type EnvTagDef = {
  id: string;              // stable key: "farmable"
  kind: "envTag";

  ui?: {
    name?: string;
    description?: string;
    icon?: string;
    color?: number;
  };

  // Optional: declare what high-level systems this tag enables
  // show systems on expand (UI)
  systems?: string[];      // e.g. ["fertility", "agriculture"]

  // Optional: action/UI gating flags (pure data)
  // enables verbs (UI gating)
  affordances?: string[];  // e.g. ["canFarm", "canBuildFarms"]

  intents?: TagIntentDef[]; // ordered within the tag; tag order still matters globally
};
```
#### TagIntentDef (v1 minimal)

```ts
type TagIntentDef = {
  id: string;                    // stable within the tag, e.g. "farm"
  verb: string;                  // "farm" | "fish" | "forage" ...
  requires?: RequireSpec;        // optional gating
  effect?: EffectSpec;           // what happens if chosen
};
```

#### RequireSpec (keep tiny; no query language)

```ts
type RequireSpec = {
  season?: string[];             // ["spring","summer"]
  hasPawn?: boolean;             // true => only if pawn present on tile
  hasTag?: string[];             // tile must have these tags
  hasEquipment?: string[];       // pawn equipment tags/ids (later)
};
```

#### EnvSystemDef (this is where tiers live)

This replaces “player-facing numeric props”. Systems define:

* the tier ladder
* How tiers map to internal numbers
* (optionally) UI copy/tooltips later

```js
type EnvSystemDef = {
  id: string;          // "fertility" | "hydration" | "fishDensity" ...
  kind: "envSystem";

  ui?: {
    name?: string;
    description?: string;
  };

  defaultTier: Tier;   // default everything to bronze
  tierMap: { bronze: number; silver: number; gold: number; diamond: number };

};

```
### Example

```js
{
  id: "farmable",
  kind: "envTag",
  ui: { name: "Farm", description: "Grow crops and harvest crops" },
  systems: ["fertility", "hydration", "growth"],
  affordances: ["canFarm","canBuildFarms"]
  intents: [
    {
      id: "farm",
      verb: "farm",
      requires: { season: ["spring","summer"], hasPawn: true },
      effect: { op: "AddResource", resource: "food", amount: 1 } // Final effects for farming more likely to be complex systems
    }
  ]
}
```

---

# 2) EnvTileDef (persistent terrain)

### Schema

```js
type WeightedTableEntry = {
  defId: string;
  weight: number;
};

type EnvTileDef = {
  id: string;              // "tile_floodplains"
  kind: "envTile";
  name: string;

  ui?: {
    shortName?: string;
    description?: string;
    icon?: string;
    color?: number;
  };

  // Base tags present on this tile at worldgen/init.
  // ordered, unique list, top->bottom priority
  baseTags?: string[];

  seasonTables?: {
    [seasonKey: string]: WeightedTableEntry[];
  };
};
```

### Example

```js
{
  id: "tile_floodplains",
  kind: "envTile",
  name: "Floodplains",
  ui: { description: "Lowlands shaped by seasonal overflow." },

  baseTags: ["forageable", "farmable", "fishable"], 

  seasonTables: {
    spring: [{ defId: "event_rain", weight: 4 }, { defId: "event_storm", weight: 1 }],
    summer: [{ defId: "event_heatwave", weight: 3 } , { defId: "event_duststorm", weight: 1 }],
    autumn: [{ defId: "event_flooding", weight: 2 }],
    winter: [{ defId: "event_frost", weight: 3 }]
  }
}
```

---

# 3) EnvEventDef (transient event/animal)

### Schema

```js
type EffectSpec = EffectOp | EffectOp[];

type EnvEventDef = {
  id: string;              // "event_rain"
  kind: "envEvent";
  name: string;

  ui?: {
    shortName?: string;
    description?: string;
    icon?: string;
    color?: number;
  };

  class?: "effect" | "animal";

  defaultSpan?: number;    // >= 1
  durationSec?: number;    // expiresSec = createdSec + durationSec
  expiresOnSeasonChange?: boolean;

  onEnter?: EffectSpec;
  onTick?: EffectSpec;     // once per second while unpaused
  onExit?: EffectSpec;
};
```

### Example (tag add/remove)

```js
{
  id: "event_flooding",
  kind: "envEvent",
  name: "Flooding",
  ui: { description: "Overflow spreads across the lowlands." },
  durationSec: 6,

  onEnter: { op: "AddTag", target: { ref: "self", layer: "tile" }, tag: "flooded" },
  onExit:  { op: "RemoveTag", target: { ref: "self", layer: "tile" }, tag: "flooded" }
}
```

### Absolute-time expiry (v1, required)
- On spawn at simulation time `tSec`:
  - `createdSec = tSec`
  - if `durationSec` is defined: `expiresSec = tSec + durationSec`
- `expiresSec` is stored on the instance and never “counts down”.
- An event is expired when `tSec >= expiresSec`.


---

# 4) EffectOps

### Schema (ops)

```js
type EffectOp =
  | { op: "AddResource"; resource: string; amount: number }

  | { op: "AddTag"; target: TargetSpec; tag: string }
  | { op: "RemoveTag"; target: TargetSpec; tag: string }

  | { op: "SetSystemTier"; target: TargetSpec; system: string; tier: Tier }
  | { op: "UpgradeSystemTier"; target: TargetSpec; system: string; delta: number }

  | { op: "RemoveEvent"; target: TargetSpec }
  | { op: "TransformEvent"; target: TargetSpec; defId: string };


```

### Example (multi-span storm affecting permanents)

```js
{
  id: "event_storm",
  kind: "envEvent",
  name: "Storm",
  defaultSpan: 3,
  durationSec: 6,
  onTick: [
    { op: "RemoveTag", target: { ref: "self", layer: "tile" }, tag: "farmable" }
  ]
}
```

On gaining a tag, if it enables a system and systemTiers[system] is missing, set it to that system’s defaultTier (Bronze).

---

# 5) Instance shapes (created by model)

### EnvTileInstance

```js
type EnvTileInstance = {
  instanceId: number;
  defId: string;
  col: number;
  span: number;

  tags: string[];                         // boolean tags
  systemTiers: Record<string, Tier>;      // fertility/hydration/etc (player-facing)
};

type EnvEventInstance = {
  instanceId: number;
  defId: string;
  col: number;
  span: number;

  createdSec: number;
  expiresSec?: number;                    // absolute time; event is expired when tSec >= expiresSec
};

```

CmdSetTileTagOrder { envCol: number, tagIds: string[] }

