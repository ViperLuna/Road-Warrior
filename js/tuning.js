// Runtime tuning values. Defaults here mirror config/tuning.json, which overrides them at startup.
export const tuning = {
  speed: { twoLane: 2.4, fourLane: 3.6, rightTurnFactor: 0.8, leftTurnFactor: 0.65, roundaboutFactor: 0.7, taperFactor: 0.75, junctionApproach: 2.2, drivewayFactor: 0.6, parkingLotFactor: 0.55 },
  trafficLight: { greenSeconds: 6, yellowSeconds: 1.5, allRedSeconds: 1 },
  cars: { acceleration: 5, braking: 11, minGapTiles: 0.1, conflictDistance: 0.205 },
  junctions: { stopSeconds: 1.0 },
  gridlock: { warnAfterSeconds: 12, gameOverAfterSeconds: 40, honkSlowSeconds: 5, honkFastSeconds: 1.2 },
  trips: { parkedSeconds: 1.6, rewardPerTrip: 5, homeCooldownMinSeconds: 1.5, homeCooldownMaxSeconds: 3.5 },
};

// Merge a parsed tuning.json over the defaults (unknown/underscore keys ignored).
export function setTuning(obj) {
  for (const group of Object.keys(tuning)) {
    if (obj && typeof obj[group] === 'object') Object.assign(tuning[group], obj[group]);
  }
}
