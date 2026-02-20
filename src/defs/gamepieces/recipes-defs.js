import {
  SCROLL_GRAPH_SUBJECT_DEFS,
  SCROLL_GRAPH_SUBJECT_IDS,
  SCROLL_GRAPH_TYPE_DEFS,
  SCROLL_GRAPH_TYPE_IDS,
  buildScrollTimegraphState,
  makeScrollItemKind,
  makeScrollRecipeId,
} from "./scroll-timegraph-defs.js";

const scrollRecipeDefs = {};
for (const typeId of SCROLL_GRAPH_TYPE_IDS) {
  const typeDef = SCROLL_GRAPH_TYPE_DEFS[typeId];
  if (!typeDef) continue;

  for (const subjectId of SCROLL_GRAPH_SUBJECT_IDS) {
    const subjectDef = SCROLL_GRAPH_SUBJECT_DEFS[subjectId];
    if (!subjectDef) continue;

    const recipeId = makeScrollRecipeId(typeId, subjectId);
    const itemKind = makeScrollItemKind(typeId, subjectId);
    const timegraph = buildScrollTimegraphState(typeId, subjectId);
    if (!timegraph) continue;

    scrollRecipeDefs[recipeId] = {
      id: recipeId,
      name: `Craft ${subjectDef.name} ${typeDef.name}`,
      kind: "craft",
      durationSec: 5,
      inputs: [{ kind: "reeds", qty: 1 }],
      outputs: [
        {
          kind: itemKind,
          qty: 1,
          itemState: {
            timegraph,
          },
        },
      ],
    };
  }
}

export const recipeDefs = {
  roastBarley: {
    id: "roastBarley",
    name: "Roast Barley",
    kind: "cook",
    durationSec: 1,
    inputs: [{ kind: "barley", qty: 1 }],
    toolRequirements: [{ kind: "stone", qty: 1 }],
    outputs: [{ kind: "roastedBarley", qty: 1 }],
  },

  roastSmallFish: {
    id: "roastSmallFish",
    name: "Roast Small Fish",
    kind: "cook",
    durationSec: 1, 
    inputs: [{ kind: "smallFish", qty: 1 }],
    outputs: [{ kind: "roastedSmallFish", qty: 2 }],
  },

  roastMediumFish: {
    id: "roastMediumFish",
    name: "Roast Medium Fish",
    kind: "cook",
    durationSec: 2, 
    inputs: [{ kind: "mediumFish", qty: 1 }],
    outputs: [{ kind: "roastedMediumFish", qty: 2 }],
  },

  roastLargeFish: {
    id: "roastLargeFish",
    name: "Roast Large Fish",
    kind: "cook",
    durationSec: 3, 
    inputs: [{ kind: "largeFish", qty: 1 }],
    outputs: [{ kind: "roastedLargeFish", qty: 1 }],
  },

  weaveBasket: {
    id: "weaveBasket",
    name: "Weave Basket",
    kind: "craft",
    durationSec: 5,
    inputs: [{ kind: "reeds", qty: 3 }],
    outputs: [{ kind: "basket", qty: 1 }],
  },

  ...scrollRecipeDefs,
};
