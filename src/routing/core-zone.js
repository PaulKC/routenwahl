// The core zone ("Kernzone") of the avalanche bulletin: the aspects and elevations the danger
// level is given for. On all other slopes the SLF takes the danger as about one level lower,
// so cells outside it get their own max angle and whole-slope rule (settings.zone).
//
// settings.zone is null (the level holds everywhere) or
//   { aspects: ['N', 'NE', ...], minElevation: metres | null, outsideMaxAngle, outsideWholeSlope }.

export const ASPECTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const FLAT = 5; // degrees: gentler cells face nowhere in particular and count as in the zone

const cache = new WeakMap(); // grid -> { key, mask }

// 1 for each cell in the core zone, 0 elsewhere. A cell's aspect is the direction its own
// slope faces, rounded to one of the 8 of the bulletin.
export function coreZoneMask(grid, zone) {
  const key = `${zone.aspects.join()}/${zone.minElevation}`;
  const cached = cache.get(grid);
  if (cached?.key === key) return cached.mask;
  const { heights } = grid;
  const { dzdx, dzdy } = grid.gradients();
  const slopes = grid.slopes();
  const inAspect = ASPECTS.map((aspect) => zone.aspects.includes(aspect));
  const minElevation = zone.minElevation ?? -Infinity;
  const mask = new Uint8Array(heights.length);
  for (let i = 0; i < mask.length; i += 1) {
    if (!(heights[i] >= minElevation)) continue;
    // Downhill points east by -dzdx and north by +dzdy (dzdy is per metre southwards).
    const bearing = Math.atan2(-dzdx[i], dzdy[i]) * (180 / Math.PI);
    const sector = ((Math.round(bearing / 45) % 8) + 8) % 8;
    if (slopes[i] < FLAT || inAspect[sector]) mask[i] = 1;
  }
  cache.set(grid, { key, mask });
  return mask;
}
