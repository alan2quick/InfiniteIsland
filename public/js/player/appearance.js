// Pure appearance metadata shared by the menu, backups and scene adapter.
export const HELD_PROPS = Object.freeze([
  { id: 'none', name: 'Empty hands', description: 'Keep the familiar look', color: '#83cda4' },
  { id: 'lantern', name: 'Firefly lantern', description: 'A little golden glow in a mint lantern', color: '#89cdb5' },
  { id: 'torch', name: 'Campfire torch', description: 'A soft, friendly flame for evening strolls', color: '#f4b65e' },
  { id: 'flower', name: 'Big daisy', description: 'A cheerful flower to carry around the island', color: '#f7d979' },
  { id: 'pinwheel', name: 'Rainbow pinwheel', description: 'Four bright petals turning lazily', color: '#c4a4e5' },
  { id: 'umbrella', name: 'Picnic umbrella', description: 'A tiny patchwork canopy for a sunny stroll', color: '#edaaaf' },
].map(Object.freeze));
export const normaliseHeldProp = id => HELD_PROPS.some(prop => prop.id === id) ? id : 'none';

export function normaliseAppearance(value) {
  const appearance = {};
  for (const key of ['shirt', 'pants', 'hat', 'cuff']) {
    const color = value?.[key];
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) appearance[key] = color;
  }
  if (HELD_PROPS.some(prop => prop.id === value?.heldProp)) appearance.heldProp = value.heldProp;
  return appearance;
}
