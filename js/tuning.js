// Runtime tuning values. Defaults here mirror config/tuning.json, which overrides them at startup.
export const tuning = {
  speed: { twoLane: 2.4, fourLane: 3.6, rightTurnFactor: 0.8, leftTurnFactor: 0.65, roundaboutFactor: 0.7, taperFactor: 0.75, junctionApproach: 2.2, drivewayFactor: 0.6, parkingLotFactor: 0.55 },
  trafficLight: { minGreenSeconds: 2, maxGreenSeconds: 10, yellowSeconds: 1.5, allRedSeconds: 1 },
  cars: { acceleration: 5, braking: 11, minGapTiles: 0.1, conflictDistance: 0.205 },
  junctions: { stopSeconds: 1.0 },
  gridlock: { warnAfterSeconds: 12, gameOverAfterSeconds: 40, honkSlowSeconds: 5, honkFastSeconds: 1.2 },
  accidents: { durationSeconds: 20, firstDelaySeconds: 90, minGapSeconds: 150, maxGapSeconds: 300, rampTrips: 4000, rampShrink: 0.5, minSpeed: 0.5, closeTiles: 0.8 },
  stadium: { capacity: 40, gates: 2, gateTiles: [-1, 2, 0, 1], stayMinSeconds: 20, stayMaxSeconds: 45, houseChance: 0.08, gateQueuePenalty: 1.5 },
  outside: { startIntervalSeconds: 30, minIntervalSeconds: 3, decayPerMinute: 0.95, maxVisitors: 40, rewardPerTrip: 2, horde: { firstAfterMinutes: 5, everyMinutes: [5, 10], sizeStart: 12, sizeGrowth: 3, sizeMax: 32, spacingSeconds: 0.9, giveUpSeconds: 40 } },
  deadlines: { house: { graceSeconds: 60, warnSeconds: 60 }, stadium: { graceSeconds: 60, warnSeconds: 60 }, gates: { graceSeconds: 60, warnSeconds: 60 }, requiredPercent: 0, settleSeconds: 3, quietSeconds: 0.4 },
  jams: { radiusTiles: 4, forgetSeconds: 15, relogSeconds: 60 },
  trips: { parkedSeconds: 1.6, rewardPerTrip: 5, homeCooldownMinSeconds: 1.5, homeCooldownMaxSeconds: 3.5 },
};

// Merge a parsed tuning.json over the defaults (unknown/underscore keys ignored).
export function setTuning(obj) {
  for (const group of Object.keys(tuning)) {
    if (obj && typeof obj[group] === 'object') Object.assign(tuning[group], obj[group]);
  }
}
