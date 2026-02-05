export const recipeDefs = {
  roastBarley: {
    id: "roastBarley",
    name: "Roast Barley",
    kind: "cook",
    durationSec: 0, // instant
    inputs: [{ kind: "barley", qty: 1 }],
    toolRequirements: [{ kind: "stone", qty: 1 }], // not consumed
    outputs: [{ kind: "roastedBarley", qty: 1 }],
  },

  weaveBasket: {
    id: "weaveBasket",
    name: "Weave Basket",
    kind: "craft",
    durationSec: 5, // 5 tSec of work for 1 pawn
    inputs: [{ kind: "reeds", qty: 3 }],
    outputs: [{ kind: "basket", qty: 1 }],
  },
};
