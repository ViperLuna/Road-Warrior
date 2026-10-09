// Progression + map config. Defaults mirror config/progression.json and config/maps.json.
export const prog = {
  goals: { firstAtTrips: 10, minIncrement: 10, tripsPerHouse: 8, roadsPlain: 30, roadsWithSpecial: 20 },
  spawns: { firstAtTrips: 4, minEveryTrips: 4, tripsPerHouse: 2.5, sameColorSpawns: 2, newColorEverySpawns: 3, housesPerSpawn: 2, maxHousesPerDestination: 3, roadsNeeded: [4, 14] },
  specials: [{ id: 'bridge', name: 'Bridge', enabled: true, weight: 1, cost: 40, description: 'Drag a road across water.' }],
};
export const maps = [{ id: 'riverbend', name: 'Riverbend', cols: 32, rows: 22, unlock: null }];

export function setProgression(obj) {
  for (const k of ['goals', 'spawns']) if (obj && obj[k]) Object.assign(prog[k], obj[k]);
  if (obj && Array.isArray(obj.specials)) prog.specials = obj.specials;
}
export function setMaps(obj) { if (obj && Array.isArray(obj.maps) && obj.maps.length) { maps.length = 0; maps.push(...obj.maps); } }
export const specialInfo = id => prog.specials.find(s => s.id === id);
