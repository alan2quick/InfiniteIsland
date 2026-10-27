// Fixed overworld item seeds shared by items and rack placement. DEFS order is the fixed item ID contract.
export const DEFS = [
  { kind: 'axe',        at: [4.5, 16.5],    roll: Math.PI },      // ~5u from spawn, visible from the first frame (the campfire plaza is east of the spawn)
  { kind: 'sword',      at: [29.1, 39.5] },                       // south-east beach
  { kind: 'hammer',     at: [-7.5, -21.1] },                      // top of the plateau
  { kind: 'axe',        at: [15, 14] },                        // by the pond
  { kind: 'hammer',     at: [-42.3, 8.4] },                    // west beach
  { kind: 'shovel',     at: [-26, -4] },                       // west meadow
  { kind: 'shovel',     at: [1.7, -3.3] },                       // by the stream
];
