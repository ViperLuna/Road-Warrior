# Road Warrior - Design Doc (living spec)

A Mini Motorways-style source/destination road-building game. Vanilla JS + Canvas, no build step, deployed to GitHub Pages via Actions.

## Core loop
- Fixed-size grid map with randomly generated water (river / pond / lake). Land must stay connected (flood-fill check); start area is open land.
- Houses (1 tile) and destinations (2x2: 2 building tiles + 2 parking tiles, entrance on the lot) come in matching colors. Buildings can be **rotated, never moved**. One exit side each; a road touching the exit auto-connects.
- Player drags to build roads (left-click / create button), right-click / destroy button to demolish. Drag-build any time.
- Each house owns **1 car** of its color. Car picks a random same-color destination, drives there, returns. A full round trip = **1 trip**.
- Destination holds max **4** cars (2 lot tiles x 2 bays, any gate reaches any bay). House reserves a slot on departure; if none free, the car waits in the house queue. Marker per inbound car shown on the destination.
- Spawn logic must keep houses:destinations balanced (about 4 houses per destination).

## Controls
- **Mouse:** left = current tool (Build/Demolish/Move), right = demolish, middle-drag or Space+left-drag = pan, wheel = zoom at cursor. Keys: B / D / M switch tool.
- **Touch:** toolbar toggles Build / Demolish / Move; one finger uses the lit tool, two fingers always pan + pinch-zoom.
- Drags are walked tile-by-tile (4-connected), so fast swipes never leave gaps. Seed is in the URL (`#seed=123`) so a map can be replayed/shared.

## Tuning (config/tuning.json)
All gameplay numbers live in `config/tuning.json`, read at startup (defaults in `js/tuning.js`): lane speeds (**`twoLane` / `fourLane` separate**, tiles/s) with turn/driveway/lot factors, **traffic light** green/yellow/all-red seconds, car accel/braking/min gap, parked time, trip reward, home cooldown. Colors live in `config/colors.json`.

## Simulation model
- Every movement is a Bezier "piece" (road tile in-side -> out-side, driveway, lot in/out) offset into the right-hand lane (`js/lanes.js`). Pathfinding is A* over (tile, entry side) with small turn penalties and no U-turns (`js/pathfind.js`).
- A car's route is a list of pieces. A piece the map no longer supports (demolished road, rotated building) is drawn as a faded **ghost** until the car is done with it; no extra bookkeeping.
- Dev hotkeys: **R** rotate hovered building, **P** spawn an extra pair (temporary, until real spawning in M4). Click/tap a building to rotate it.

## Specials in play (M5)
- **Placing:** tap a special's pill in the top bar (Roundabout / Traffic light), then tap an intersection (a road tile with 3+ connections). Demolishing the tile returns the special. Both are rewards and also sold in the Shop.
- **Stop signs:** plain 4-ways and the stem of a T make every car come to a full stop (`junctions.stopSeconds`, default 1.2 s) before going by right of way. Through traffic on a T doesn't stop. This is what makes busy plain junctions a bottleneck, so the specials matter.
- **Roundabout:** cars circulate counter-clockwise (US) around a central island; entrants yield to circulating cars. Best throughput under load; in an overloaded crossroads it keeps the same trips as a plain junction with far shorter worst waits as traffic climbs.
- **Traffic light:** fixed timer from `trafficLight.*` in tuning.json, two phases by axis (N/S then E/W), all lights on one shared clock. Right turn on red is allowed when nothing conflicts. Lights can't sit on neighbouring tiles (no room to queue between them), and a car won't enter a plain junction if the light just beyond it isn't green (so nobody parks inside an intersection waiting for the next light). Lights are a stability tool: under heavy load a plain junction can collapse into long stalls while a lit one stays steady, but throughput is lower than a roundabout.
- **One-way streets:** a permanent unlock (reward or $120 in the Shop) that adds a toolbar toggle (key **O**). With it on, dragging along roads makes each street one-way in the direction you drag (white lane dashes + chevrons); with it off, dragging along roads makes them two-way again. Stored per edge as blocked exits; pathfinding refuses to drive against an arrow and rebuilding a tile clears stale flags.
- **Hills + tunnels:** about 70% of maps have rocky hills. Roads and buildings can't go on hills; a **tunnel** (reward or $60) is dragged from a road straight through a hill to the far side exactly like a bridge: one item covers any length, hill tiles cost no road pieces, demolishing any tile removes the tunnel and refunds it. Cars vanish inside and reappear at the far mouth. Tunnels are only offered on maps that have hills, and across-water spawning also considers hill crossings.
- **Smarter spawning across water:** houses/pairs only spawn on the far bank when the player could connect them: an unused bridge in hand or already built over that gap, and enough roads for both land stretches plus a reserve. More spare bridges = more separation.

## Highways (M6)
- **A reward (10 pieces) or $90 in the Shop.** Tap the Highway pill to switch the Build tool to 4-lane road; dragging over a street widens it in place (one highway piece in, one street piece refunded). Demolishing returns the right kind of piece. Bridges and tunnels inherit the lane count of the road you're dragging.
- **Lanes:** two per direction (inner/outer, 0.11/0.33 from the median). Each car picks a lane per trip, so there is no mid-road lane changing. Speeds are separate in tuning.json (`speed.twoLane` 2.4, `speed.fourLane` 3.6).
- **Joining streets and highways:** every tile edge has a lane count = the smaller of its two neighbours (2 where it meets a driveway or gate). A highway tile next to a street tapers inside itself, drawn as a flare; where two lanes merge into one the tile acts as a junction and the usual conflict logic does the merging. A side street onto a highway is just a normal T.
- **Slowing for junctions:** everyone eases to `speed.junctionApproach` (2.2) when approaching a junction, so a fast road never outruns its stopping distance. This one change removed ~96% of highway collisions.
- **Roundabouts only fit on regular streets.** Traffic lights work on either.
- **Overpass (placeable special, $80):** put it on a 4-way where a highway crosses a street and nothing else joins. The tile becomes two independent layers: the street runs underneath, the highway passes over, no turns, no interaction. In the crossing test it moves ~12% more trips than the same crossing at ground level, with shorter waits. Cars are drawn under the deck, then the deck, then everyone else. Only offered as a reward once you own highways.
- **Ramps:** side streets joining a highway at ground level serve as on/off ramps (each is just a normal street piece).
- **Known rough edge:** in dense layouts with many highway/street mixes, car bodies can briefly graze (about 1 second per 2.7 hours of simulated driving in stress tests).

## Roads
- Tile holds either 2-lane or 4-lane road (one-way is a build toggle). Edges stay visually clear except where road ends / driveways meet.
- US right-hand traffic.
- Initial inventory: 20 two-lane pieces + 1 bridge (unused until the city grows toward water). First pair is spawned on open land within range of the piece count.
- **Demolish always refunds the piece immediately.** A demolished road in use by a car persists as a **ghost road** until its cars finish, even if rebuilt over; new cars use the new path. Rotating a connected building leaves a ghost connector the same way.

## Intersections (implemented in `js/junction.js` + `js/cars.js`)
- **Conflicts are geometric:** two movements conflict if their lane curves come within a car width (`cars.conflictDistance`). Crossings, merges and left turns fall out of the geometry; a right turn into your own lane conflicts only with traffic merging into that same lane.
- **T-junction:** through road beats the stem; left turns yield to oncoming straight. **4-way:** first-come-first-served, ties yield to the car on the right. A car already past its stop line always finishes.
- **Never wait inside a junction:** a car won't enter unless the whole chain of junction/lot pieces ahead is free and there is room beyond the last one (no box-blocking). Cars inside a junction outrank cars outside it.
- **Parking lots are one connected space** (2 tiles x 2 bays): a car entering by either gate can park in any of the 4 bays, so a single road to one gate is enough (connecting both is optional). It leaves by whichever connected gate is cheapest. The lot is one mover-at-a-time zone with a wider safety margin; a car about to leave yields to anyone who has claimed it.
- **Deadlock breaking:** every hold records who it waits on. A closed loop of stopped cars gets a short priority override on one member (soft rule holds only; never through a committed car or a physically blocked path).
- **Gridlock:** a car stopped for `gridlock.warnAfterSeconds` gets a gold shine that builds up; at `gameOverAfterSeconds` it's game over (screen arrives in M4). Roundabouts / traffic lights arrive in M5 using the same framework.
- Headless stress test results: 8 houses sharing roads, 60 maps x 240 s: 1,145 junction tiles, 6,000+ trips, 0 car overlaps, worst stall 3.5 s. A deliberately absurd 11-house tangle still showed a rare brief overlap.

## Water
- Bridge: drag a road across water; it auto-builds, straight line only, any length, consumes one bridge item. Inherits 2- or 4-lane from the road being dragged. Bought with money.

## Flow, maps and game over
- Splash ("Tap to Start", unlocks audio) -> main menu (pick a map) -> play. **Esc** / Menu button pauses (resume, new map, main menu).
- Maps live in `config/maps.json` (name + size + unlock rule). Bigger maps unlock by reaching N trips on the previous one; bests are saved in `localStorage`. Terrain features scale with map size.
- **Game over = gridlock:** any car stopped for `gridlock.gameOverAfterSeconds` ends the run (gold shine warns first). Screen shows trips, time survived, cash and best, with Play again / Main menu.

## Progression (config/progression.json)
- **Pacing scales with traffic:** next goal/spawn = trips now + max(min, houses x `tripsPerHouse`), so the rhythm stays steady as houses (and trips/second) grow instead of snowballing. Goals ~every 8 trips per house, spawns ~every 2.5.
- **Spawns** are trip-triggered (`firstAtTrips`, then as above). The first `sameColorSpawns` reuse the starting colour; then every `newColorEverySpawns`-th spawn introduces a new colour as a destination + house pair. Otherwise a colour gets extra houses until it has `maxHousesPerDestination` per destination, then a new destination + house. New buildings land near existing ones, reachable over land within `roadsNeeded` road tiles, never on roads/buildings (an exit may touch an existing road and auto-connect). They pop in with a ring.
- **Goals** every N trips (growing). The reward menu offers `roadsPlain` (30) roads OR `roadsWithSpecial` (20) roads + one random *enabled* special. Specials not built yet are listed with `"enabled": false` and flip on when finished.
- **Cash** (slim, per trip) buys specials that have a `cost` in the Shop (bridge $40).

## Bridges
- Drag from a shore road straight across water to the far bank: one bridge item covers any length (even one tile), water tiles cost no road pieces, only the far-bank tile does. Straight line only; inherits 2-lane for now. Demolishing any span tile removes the whole bridge and refunds the item; cars on it keep going on a ghost.

## Progression (older notes)
- Every X total trips: a **goal** is hit -> reward choice: 20 plain pieces + one special, OR 30 plain pieces. Always offered at least 20 pieces.
- Spawns after thresholds. First couple of spawns reuse the starting color; then new colors (new color always spawns with a matching house).
- Every completed round trip pays a **slim** amount of money (game is slightly greedy). Money buys specials not offered by goals (e.g. bridges).
- Colors: 4 at first, colorblind-safe (Okabe-Ito) + shape glyphs. Defined in `config/colors.json`.

## Specials
Highway (10 four-lane pieces, still to build), roundabout, traffic light, tunnel (through raised land), one-way (toggle), ramps (count as 1 plain piece each; exit perpendicular or straight ahead as overpass). Overpass needs two layers in a tile - the only exception to one-type-per-tile; scrap it if too costly.

## Game over
- If **any car** sits stuck too long (generous timer), the game ends. Warning: stuck car / area pulses with a gold shine that intensifies. Then: restart or main menu.
- Maps: fixed size per map; bigger maps at higher levels. A map is played until loss, quit or no room left (TBD).

## Audio
- Splash screen ("Tap to Start") unlocks the Web Audio context. `js/audio.js` exposes `unlock()`, `play(name)`, mute. Register sounds in its `SOUNDS` map; files go in `assets/sounds/`.

## Future ideas (parking lot)
- Harder difficulty: more than 1 car per house.
- More colors, day/night, sound.

## Milestones
1. (DONE)  Foundation: grid, terrain gen, drag build/demolish, mobile toggles, inventory.
2. (DONE) Cars: lane graph, right-hand traffic, pathfinding, round trips, ghost roads.
3. (DONE) Intersection rules + deadlock detection.
4. (DONE) Progression: spawns, colors, goals, reward menu, game over, menu/maps, bridges + shop.
5. (DONE) Specials: roundabout, traffic light, one-way streets, hills + tunnels (bridge done in M4).
6. (DONE) Highways: 4-lane, taper, side-street ramps, overpass.

## Fix round after M6 (playtest feedback)
- **Shop** is a bottom sheet above the toolbar (never covers Shop/Menu buttons) with its own Close button; border-box sized so it fits narrow phones.
- **Green-light queues**: the no-box-blocking rule ignores a leader that is rolling (v > 1 and gap > 0.22); only a (nearly) stopped leader counts as spillback, so a platoon flows through a green.
- **Roundabouts** yield only to cars already circulating or about to enter (within 0.3 of the line), never to cars merely approaching; a car whose merge point the ring car has cleared falls in behind it.
- **Spawn budget**: `buildCost()` (0-1 BFS, existing roads free) makes new houses/pairs spawn only where the player's held road inventory can connect them. Still TODO: houses do not yet get impatient when unconnected.

## Driveways (house legs) - rules agreed in RT
- A house's connection (and a destination gate, same rule) never counts toward the junction type: house + road + house across the street is a plain through road, not a 4-way. Cars leaving a house always yield to street traffic and don't stop first (`houseSides` in `junctionAt`).
- Not yet built (future, user-approved shape): a **driveway toggle** piece. Costs a road piece, serves only the one house it starts at, cannot connect to a destination, and the moment it touches a road it stops being a driveway. Drawing a road across a driveway is blocked with a toast. Houses that get angry from long waits are fixed by rotating the house - some things are meant to suck.
- Destination gates now yield like driveways. Reason (playtest): a destination has 2 adjacent exits and lights can't be adjacent, so a light on one exit was moot. Alternative if yield isn't enough: give destinations a single exit.
- **Destinations now have ONE exit** (lot tile 0 only; the second lot tile is parking). Combined with gate-yield this removes the "two adjacent exits make a light moot" problem. `LOT_GATES` in `js/buildings.js`; spawn checks, planBack and drawing follow it.
- **Fallback if single-exit lots bottleneck (user idea, not built):** let cars phase through each other while on the destination's property (lot pieces only); street and gate rules unchanged.

## Economy change: roads cost cash (playtest: 133 spare roads, plenty of cash)
- Goals no longer give roads. A goal offers **special + $20** or **just $80** (`goals.cashWithSpecial` / `cashPlain`); if no special is available it auto-grants the cash.
- A 2-lane road piece costs `economy.roadCost` ($2) once the spare stock runs out. Spare stock = the 20 starting pieces + anything refunded by demolishing (refunds still instant, still go to stock). 4-lane pieces still come from Highway grants.
- The road pill shows `roadsAvailable` = stock + floor(cash / cost). Spawn budgets use the same number.
- Cash is still plentiful ($5/trip); raise `roadCost` or lower `rewardPerTrip` if road never feels like a decision.

## Known issues (open)
- **Car parked in a bay and never leaving** (user screenshot, full map, all houses connected, not game-ending). Not reproduced as an isolated case. In bot runs every long-parked car had a local traffic deadlock next to its lot (cycles among `outranked` / `chain-inside` / `chain-earlier` / `box` / `stop` waits that `breakDeadlocks` does not resolve, e.g. a car held at `stop` that never reaches the line because of a stopped leader). That deadlock class already existed at M6 (bot: 6-8 of 10 games ended in gridlock at 25 min). Parked cars never count as "stuck", so they never glow or end the game.
- Ideas if it shows again: make a parked car that has waited too long for its lot to clear flash gold like a stuck car; extend `breakDeadlocks` to treat `box` / `stop` waits as part of a cycle.

## App icon / install
- Icon art from the user (blue car on a T-junction), generated into `assets/icons/` (favicon 32/48, apple-touch 180, icon 192/512, maskable 192/512 with extra padding). `manifest.webmanifest` + head tags let Android "Add to Home screen" use it (fullscreen, dark theme colour).

## Splash title
- `assets/title.jpg` (2400 px wide, from the user's banner) replaces the text title on the splash. Background is the banner's green (`#84a077`), image edges are feathered with a CSS mask, and on narrow phones the image is shown 900 px wide and centre-cropped so the title stays big. The `<h1>` keeps the alt text "Road Warrior".

## Rotating a destination with cars heading in / parked (playtest bug, fixed)
- Rotating a destination used to leave its cars on the old lot geometry; once the old exit road was changed they could never leave. Now: parked cars are re-seated in their bay on the new layout immediately (`reseatCarsOf`), and cars still driving in finish their route (ghost rule) and are re-seated on arrival. A re-seated car leaves through the new gate and waits in its bay if the new gate has no road yet.

## Gridlock patience ladder (playtest: "nobody moves at the green light", snowballing backups)
- Reproduced with a lit grid: a handful of cars end up inside two neighbouring junctions each waiting for the other's tile (or for room beyond), and the jam grows until the map locks. Roundabouts and plain grids showed it too.
- A car that has been stuck > 0.8 x `gridlock.warnAfterSeconds` while waiting on **other cars** (chain-inside / chain-earlier / box / outranked / chain-light) now stops deferring to those rules (`force`); after 1.3 x it also ignores every car inside the box (`ignoreAll`). Red lights and stop-sign timers are never skipped. A brief overlap in a jam is accepted over a permanent deadlock.
- Not fixed (by design): a genuinely full ring of roads with no free space anywhere is still a gridlock; that is what the stuck-car game over is for.
- Sim results: lit 4x4 grids, 20-60 houses: before, most runs had cars stuck for 500-1500 s; after, 14 of 15 runs clear (worst wait 20-33 s). Bot (full progression): games over 6-8 of 10 -> 0 of 10, three runs.
