# Road Warrior - Design Doc (living spec)

A Mini Motorways-style source/destination road-building game. Vanilla JS + Canvas, no build step, deployed to GitHub Pages via Actions.

## Core loop
- Fixed-size grid map with randomly generated water (river / pond / lake). Land must stay connected (flood-fill check); start area is open land.
- Houses (1 tile) and destinations (2x2: 2 building tiles + 2 parking tiles, entrance on the lot) come in matching colors. Buildings can be **rotated, never moved**. One exit side each; a road touching the exit auto-connects.
- Player drags to build roads (left-click / create button), right-click / destroy button to demolish. Drag-build any time.
- Each house owns **1 car** of its color. Car picks a random same-color destination, drives there, returns. A full round trip = **1 trip**.
- Destination holds max **4** cars (2 lots x 2). House reserves a slot on departure; if none free, the car waits in the house queue. Marker per inbound car shown on the destination.
- Spawn logic must keep houses:destinations balanced (about 4 houses per destination).

## Controls
- **Mouse:** left = current tool (Build/Demolish/Move), right = demolish, middle-drag or Space+left-drag = pan, wheel = zoom at cursor. Keys: B / D / M switch tool.
- **Touch:** toolbar toggles Build / Demolish / Move; one finger uses the lit tool, two fingers always pan + pinch-zoom.
- Drags are walked tile-by-tile (4-connected), so fast swipes never leave gaps. Seed is in the URL (`#seed=123`) so a map can be replayed/shared.

## Roads
- Tile holds either 2-lane or 4-lane road (one-way is a build toggle). Edges stay visually clear except where road ends / driveways meet.
- US right-hand traffic.
- Initial inventory: 20 two-lane pieces + 1 bridge (unused until the city grows toward water). First pair is spawned on open land within range of the piece count.
- **Demolish always refunds the piece immediately.** A demolished road in use by a car persists as a **ghost road** until its cars finish, even if rebuilt over; new cars use the new path. Rotating a connected building leaves a ghost connector the same way.

## Intersections
- T: stem yields to through traffic. Right turn into own lane never waits. 4-way: first-come-first-served. Roundabouts / traffic lights (fixed timer) improve flow. Must detect deadlock rings.

## Water
- Bridge: drag a road across water; it auto-builds, straight line only, any length, consumes one bridge item. Inherits 2- or 4-lane from the road being dragged. Bought with money.

## Progression
- Every X total trips: a **goal** is hit -> reward choice: 20 plain pieces + one special, OR 30 plain pieces. Always offered at least 20 pieces.
- Spawns after thresholds. First couple of spawns reuse the starting color; then new colors (new color always spawns with a matching house).
- Every completed round trip pays a **slim** amount of money (game is slightly greedy). Money buys specials not offered by goals (e.g. bridges).
- Colors: 4 at first, colorblind-safe (Okabe-Ito) + shape glyphs. Defined in `config/colors.json`.

## Specials
Highway (10 four-lane pieces), roundabout, traffic light, tunnel (through raised land), one-way (toggle), ramps (count as 1 plain piece each; exit perpendicular or straight ahead as overpass). Overpass needs two layers in a tile - the only exception to one-type-per-tile; scrap it if too costly.

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
2. Cars: lane graph, right-hand traffic, pathfinding, round trips, ghost roads.
3. Intersection rules + deadlock detection.
4. Progression: spawns, colors, goals, reward menu, game over.
5. Specials: roundabout, traffic light, bridge, tunnel, one-way.
6. Highways: 4-lane, taper, ramps, overpass.
