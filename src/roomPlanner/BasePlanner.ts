import {getRoomMineral, getRoomSources} from '../game/RoomStructures';
import {distanceTransform} from '../algorithms/distanceTransform';
import {Colony} from '../Colony';
import {Pathing} from '../movement/Pathing';
import {profile} from '../profiler/decorator';
import {packCoord} from '../utilities/packrat';
import {minBy} from '../utilities/utils';
import {allBunkerCoords, BUNKER_RADIUS, bunkerCoordLookup, bunkerLayout} from './layouts/bunker';
import {sample, compact, range} from '../utilities/native';

const MAX_SAMPLE = 10;
const MAX_TOTAL_PATH_LENGTH = 25 * 3;

@profile
export class BasePlanner {

	static getBunkerLocation(room: Room, visualize = true): RoomPosition | undefined {
		const colony = Overmind.colonies[room.name] as Colony;
		if (colony && colony.bunker && colony.bunker.anchor) {
			return colony.bunker.anchor;
		}
		let allowableLocations = this.getAllowableBunkerLocations(room, visualize);
		if (allowableLocations.length > MAX_SAMPLE) {
			allowableLocations = sample(allowableLocations, MAX_SAMPLE);
		}
		const minimizePathLengthTo: RoomPosition[] = compact([...getRoomSources(room), room.controller]).map(
														   obj => obj!.pos);
		const totalPathLength = function(anchor: RoomPosition) {
			let totalDistance = 0;
			for (const pos of minimizePathLengthTo) {
				const ret = Pathing.findShortestPath(anchor, pos, {ignoreStructures: true});
				if (!ret.incomplete) {
					totalDistance += ret.path.length;
				} else {
					totalDistance += Infinity;
				}
			}
			return totalDistance;
		};
		const bestAnchor = minBy(allowableLocations, pos => totalPathLength(pos));
		if (bestAnchor && totalPathLength(bestAnchor) <= MAX_TOTAL_PATH_LENGTH) {
			return bestAnchor;
		}
	}

	private static getAllowableBunkerLocations(room: Room, visualize = true): RoomPosition[] {
		let allowableLocations = this.getNonIntersectingBunkerLocations(room.name, visualize);
		if (allowableLocations.length > MAX_SAMPLE) {
			allowableLocations = sample(allowableLocations, MAX_SAMPLE);
		}
		// Filter intersection with controller
		if (!room.controller) return [];
		allowableLocations = allowableLocations.filter(
									  anchor => !this.bunkerIntersectsWith(anchor, room.controller!.pos, 3));
		// Filter intersection with miningSites
		const sitesAndMineral: RoomPosition[] = compact([...getRoomSources(room), getRoomMineral(room)]).map(obj => obj!.pos);
		allowableLocations = allowableLocations.filter(
									  anchor => !sitesAndMineral.some(
													   pos => this.bunkerIntersectsWith(anchor, pos, 1)));
		if (visualize) {
			const vis = room.visual;
			for (const pos of allowableLocations) {
				vis.circle(pos.x, pos.y, {fill: 'purple'});
			}
		}
		return allowableLocations;
	}

	private static getNonIntersectingBunkerLocations(roomName: string, visualize = true): RoomPosition[] {
		const dt = distanceTransform(roomName);
		const coords: Coord[] = [];
		let x, y: number;
		for (y of range(BUNKER_RADIUS + 2, 50 - (BUNKER_RADIUS + 2))) {
			for (x of range(BUNKER_RADIUS + 2, 50 - (BUNKER_RADIUS + 2))) {
				if (dt.get(x, y) >= BUNKER_RADIUS + 1) {
					// If it fits, I sits
					coords.push({x, y});
				} else if (dt.get(x, y) >= (BUNKER_RADIUS - 1) && !this.terrainIntersectsWithBunker({x, y}, dt)) {
					// If it might not fits, check that it fits before I sits
					coords.push({x, y});
				}
			}
		}
		if (visualize) {
			const vis = new RoomVisual(roomName);
			for (const coord of coords) {
				vis.text(dt.get(coord.x, coord.y).toString(), coord.x, coord.y);
			}
		}
		return coords.map(coord => new RoomPosition(coord.x, coord.y, roomName));
	}

	private static terrainIntersectsWithBunker(anchor: Coord, distanceMatrix: CostMatrix): boolean {
		const dx = anchor.x - bunkerLayout.data.anchor.x;
		const dy = anchor.y - bunkerLayout.data.anchor.y;
		const bunkerCoordsAtAnchor = (allBunkerCoords[8] || []).map(function(coord) {
			return {x: coord.x + dx, y: coord.y + dy};
		});
		return bunkerCoordsAtAnchor.some(coord => distanceMatrix.get(coord.x, coord.y) == 0);
	}

	private static bunkerIntersectsWith(anchor: Coord | RoomPosition, obstacle: Coord | RoomPosition,
										padding = 1): boolean {
		const dx = bunkerLayout.data.anchor.x - anchor.x;
		const dy = bunkerLayout.data.anchor.y - anchor.y;
		let x, y: number;
		for (x of range(obstacle.x + dx - padding, obstacle.x + dx + padding + 1)) {
			for (y of range(obstacle.y + dy - padding, obstacle.y + dy + padding + 1)) {
				if (bunkerCoordLookup[8][packCoord({x, y})]) {
					return true;
				}
			}
		}
		return false;
	}

}
