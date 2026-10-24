// Position-hashed cosmetic proportions. Never consume a placement RNG or change where a tuft is planted.
function unit(x, z, salt) {
  let hash = Math.imul(Math.round(x * 1000) ^ salt, 374761393) ^ Math.imul(Math.round(z * 1000), 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
export function grassShapeAt(x, z) {
  return { width: 0.82 + unit(x, z, 11) * 0.36, depth: 0.82 + unit(x, z, 29) * 0.36, height: 0.9 + unit(x, z, 47) * 0.22 };
}
