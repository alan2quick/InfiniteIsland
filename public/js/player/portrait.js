// Small code-native portraits: fixed palette and geometry, no remote image requests.
export function characterPortrait(variant = 'original') {
  const palette = { original: ['#f6ce91', '#f0c95b'], rowan: ['#d9b58e', '#7e643c'], pip: ['#ef9a87', '#cf6d69'], marlow: ['#aaa5b0', '#767589'], clover: ['#f6d6b4', '#a9ce84'], sunny: ['#fff4db', '#f69b45'] };
  const [face, accent] = palette[variant] || palette.original;
  const hat = variant === 'original' ? `<path d="M10 21Q12 6 24 7Q37 6 39 21Z" fill="${accent}"/><path d="M24 8V3M24 5Q30 0 32 4Q29 8 24 5" fill="#8fbc60"/>` : `<path d="M11 18Q12 6 24 7Q36 6 38 18" fill="${accent}"/>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g stroke="#302742" stroke-width="2.2" stroke-linejoin="round"><path d="M10 20Q8 40 24 42Q40 40 38 20Z" fill="${face}"/>${hat}<ellipse cx="18" cy="27" rx="2.2" ry="3" fill="#302742"/><ellipse cx="30" cy="27" rx="2.2" ry="3" fill="#302742"/><path d="M20 34Q24 38 28 34" fill="none" stroke-linecap="round"/></g></svg>`;
}
