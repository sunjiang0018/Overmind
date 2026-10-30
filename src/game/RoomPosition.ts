import {isStructureWalkable} from './Structures';
import {Cartographer} from '../utilities/Cartographer';
import {minBy, mod} from '../utilities/utils';

export function getRoomPositionPrint(position: RoomPosition): string {
	return '<a href="#!/room/' + Game.shard.name + '/' + position.roomName + '">[' + position.roomName + ', ' + position.x +
		   ', ' + position.y + ']</a>';
}

export function getRoomPositionPrintPlain(position: RoomPosition): string {
	return `[${position.roomName}, ${position.x}, ${position.y}]`;
}

export function getRoomPositionRoom(position: RoomPosition): Room | undefined {
	return Game.rooms[position.roomName];
}

export function roomPositionToCoord(position: RoomPosition): Coord {
	return {x: position.x, y: position.y};
}

export function getRoomPositionReadableName(position: RoomPosition): string {
	return position.roomName + ':' + position.x + ':' + position.y;
}

export function roomPositionLookForStructure(
	position: RoomPosition,
	structureType: StructureConstant
): Structure | undefined {
	return position.lookFor(LOOK_STRUCTURES).find((s: Structure) => s.structureType === structureType);
}

export function roomPositionGetOffsetPos(position: RoomPosition, dx: number, dy: number): RoomPosition {
	let roomName = position.roomName;
	let x = position.x + dx;
	if (x < 0 || x > 49) {
		const dxRoom = Math.floor(x / 50);
		x = mod(x, 50);
		roomName = Cartographer.findRelativeRoomName(roomName, dxRoom, 0);
	}
	let y = position.y + dy;
	if (y < 0 || y > 49) {
		const dyRoom = Math.floor(y / 50);
		y = mod(y, 50);
		roomName = Cartographer.findRelativeRoomName(roomName, 0, dyRoom);
	}
	return new RoomPosition(x, y, roomName);
}

export function isPositionOnEdge(position: RoomPosition): boolean {
	return position.x === 0 || position.x === 49 || position.y === 0 || position.y === 49;
}

export function isPositionVisible(position: RoomPosition): boolean {
	return Game.rooms[position.roomName] != undefined;
}

export function getRoomPositionRangeToEdge(position: RoomPosition): number {
	return Math.min(position.x, 49 - position.x, position.y, 49 - position.y);
}

export function getRoomPositionRoomCoords(position: RoomPosition): Coord {
	PERMACACHE.roomCoords = PERMACACHE.roomCoords || {};
	const cached = PERMACACHE.roomCoords[position.roomName];
	if (cached) {
		return {x: cached.x, y: cached.y} as Coord;
	}
	const parsed = /^([WE])([0-9]+)([NS])([0-9]+)$/.exec(position.roomName);
	const coords: Coord = parsed
		? {
			x: (parsed[1] === 'W' ? -1 : 1) * parseInt(parsed[2], 10),
			y: (parsed[3] === 'N' ? -1 : 1) * parseInt(parsed[4], 10),
		}
		: {x: 0, y: 0}; // non-standard room names (arena/sim) must not crash the caller
	PERMACACHE.roomCoords[position.roomName] = coords;
	return {x: coords.x, y: coords.y};
}

export function getRoomPositionNeighbors(position: RoomPosition): RoomPosition[] {
	const adjPos: RoomPosition[] = [];
	for (const dx of [-1, 0, 1]) {
		for (const dy of [-1, 0, 1]) {
			if (!(dx == 0 && dy == 0)) {
				const x = position.x + dx;
				const y = position.y + dy;
				if (0 < x && x < 49 && 0 < y && y < 49) {
					adjPos.push(new RoomPosition(x, y, position.roomName));
				}
			}
		}
	}
	return adjPos;
}

export function roomPositionInRangeToPos(position: RoomPosition, pos: RoomPosition, range: number): boolean {
	return position.roomName === pos.roomName &&
		   ((pos.x - position.x) < 0 ? (position.x - pos.x) : (pos.x - position.x)) <= range &&
		   ((pos.y - position.y) < 0 ? (position.y - pos.y) : (pos.y - position.y)) <= range;
}

export function roomPositionInRangeToXY(position: RoomPosition, x: number, y: number, range: number): boolean {
	return ((x - position.x) < 0 ? (position.x - x) : (x - position.x)) <= range
		   && ((y - position.y) < 0 ? (position.y - y) : (y - position.y)) <= range;
}

export function roomPositionGetRangeToXY(position: RoomPosition, x: number, y: number): number {
	return Math.max((x - position.x) < 0 ? (position.x - x) : (x - position.x), ((y - position.y) < 0 ? (position.y - y) : (y - position.y)));
}

export function roomPositionGetPositionsInRange(
	position: RoomPosition,
	range: number,
	includeWalls = false,
	includeEdges = false
): RoomPosition[] {
	const terrain = Game.map.getRoomTerrain(position.roomName);

	const adjPos: RoomPosition[] = [];
	const [xmin, xmax] = includeEdges ? [0, 49] : [1, 48];
	const [ymin, ymax] = includeEdges ? [0, 49] : [1, 48];
	for (let dx = -1 * range; dx <= range; dx++) {
		for (let dy = -1 * range; dy <= range; dy++) {
			const x = position.x + dx;
			const y = position.y + dy;
			if (xmin <= x && x <= xmax && ymin <= y && y <= ymax) {
				if (includeWalls || terrain.get(x, y) !== TERRAIN_MASK_WALL) {
					adjPos.push(new RoomPosition(x, y, position.roomName));
				}
			}
		}
	}
	return adjPos;
}

export function roomPositionGetPositionsAtRange(
	position: RoomPosition,
	range: number,
	includeWalls = false,
	includeEdges = false
): RoomPosition[] {
	const terrain = Game.map.getRoomTerrain(position.roomName);
	const adjPos: RoomPosition[] = [];
	const [xmin, xmax] = includeEdges ? [0, 49] : [1, 48];
	const [ymin, ymax] = includeEdges ? [0, 49] : [1, 48];
	for (let dx = -1 * range; dx <= range; dx++) {
		for (let dy = -1 * range; dy <= range; dy++) {
			if (Math.max(Math.abs(dx), Math.abs(dy)) < range) {
				continue;
			}
			const x = position.x + dx;
			const y = position.y + dy;
			if (xmin <= x && x <= xmax && ymin <= y && y <= ymax) {
				if (includeWalls || terrain.get(x, y) !== TERRAIN_MASK_WALL) {
					adjPos.push(new RoomPosition(x, y, position.roomName));
				}
			}
		}
	}
	return adjPos;
}

export function roomPositionIsWalkable(position: RoomPosition, ignoreCreeps = false): boolean {
	// Terrain walls are never walkable in Screeps; roads cannot be constructed on them.
	if (Game.map.getRoomTerrain(position.roomName).get(position.x, position.y) == TERRAIN_MASK_WALL) return false;
	if (isPositionVisible(position)) {
		// Are there creeps?
		if (ignoreCreeps == false && position.lookFor(LOOK_CREEPS).length > 0) return false;
		// Are there structures?
		if (position.lookFor(LOOK_STRUCTURES).filter((s: Structure) => !isStructureWalkable(s)).length > 0) return false;
	}
	return true;
}

export function roomPositionAvailableNeighbors(position: RoomPosition, ignoreCreeps = false): RoomPosition[] {
	const room = Game.rooms[position.roomName];
	// Fall back to the per-tile path for invisible rooms or environments without lookForAtArea.
	if (!room || typeof (room as any).lookForAtArea !== 'function') {
		return getRoomPositionNeighbors(position).filter((pos: RoomPosition) => roomPositionIsWalkable(pos, ignoreCreeps));
	}
	const terrain = Game.map.getRoomTerrain(position.roomName);
	const top = Math.max(0, position.y - 1), left = Math.max(0, position.x - 1);
	const bottom = Math.min(49, position.y + 1), right = Math.min(49, position.x + 1);
	const blocked = new Set<number>();
	for (const {x, y, structure} of room.lookForAtArea(LOOK_STRUCTURES, top, left, bottom, right, true)) {
		if (!isStructureWalkable(structure)) blocked.add(y * 50 + x);
	}
	if (!ignoreCreeps) {
		for (const {x, y} of room.lookForAtArea(LOOK_CREEPS, top, left, bottom, right, true)) {
			blocked.add(y * 50 + x);
		}
	}
	const result: RoomPosition[] = [];
	for (const dx of [-1, 0, 1]) {
		for (const dy of [-1, 0, 1]) {
			if (dx == 0 && dy == 0) continue;
			const x = position.x + dx, y = position.y + dy;
			if (x < 1 || x > 48 || y < 1 || y > 48) continue; // keep the original edge behavior
			if (blocked.has(y * 50 + x)) continue;
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
			result.push(new RoomPosition(x, y, position.roomName));
		}
	}
	return result;
}

export function roomPositionGetPositionAtDirection(
	position: RoomPosition,
	direction: DirectionConstant,
	range = 1
): RoomPosition {
	let dx = 0;
	let dy = 0;
	switch (direction) {
		case 1:
			dy = -range;
			break;
		case 2:
			dy = -range;
			dx = range;
			break;
		case 3:
			dx = range;
			break;
		case 4:
			dx = range;
			dy = range;
			break;
		case 5:
			dy = range;
			break;
		case 6:
			dy = range;
			dx = -range;
			break;
		case 7:
			dx = -range;
			break;
		case 8:
			dx = -range;
			dy = -range;
			break;
	}
	return roomPositionGetOffsetPos(position, dx, dy);
}

// Get an estimate for the distance to another room position in a possibly different room
export function roomPositionGetMultiRoomRangeTo(position: RoomPosition, pos: RoomPosition): number {
	if (position.roomName == pos.roomName) {
		return position.getRangeTo(pos);
	} else {
		const from = getRoomPositionRoomCoords(position);
		const to = getRoomPositionRoomCoords(pos);
		const dx = Math.abs(50 * (to.x - from.x) + pos.x - position.x);
		const dy = Math.abs(50 * (to.y - from.y) + pos.y - position.y);
		return Math.max(dx, dy);
	}
}

export function roomPositionFindClosestByLimitedRange<T extends RoomPosition | _HasRoomPosition>(
	position: RoomPosition,
	objects: T[],
	rangeLimit: number,
	opts?: { filter: any | string; }
): T | undefined {
	const objectsInRange = position.findInRange(objects, rangeLimit, opts);
	// The filter already ran in findInRange; applying it again would only waste CPU.
	return position.findClosestByRange(objectsInRange) ?? undefined;
}

export function roomPositionFindClosestByMultiRoomRange<T extends _HasRoomPosition>(
	position: RoomPosition,
	objects: T[]
): T | undefined {
	return minBy(objects, (obj: T) => roomPositionGetMultiRoomRangeTo(position, obj.pos));
}

// This should only be used within a single room
export function roomPositionFindClosestByRangeThenPath<T extends _HasRoomPosition>(
	position: RoomPosition,
	objects: T[]
): T | undefined {
	let minDistance = Infinity;
	for (const obj of objects) {
		const distance = position.getRangeTo(obj);
		if (distance < minDistance) {
			minDistance = distance;
		}
	}
	if (minDistance > 4) {
		return position.findClosestByRange(objects) ?? undefined;
	} else {
		const closestObjects = objects.filter(obj => position.getRangeTo(obj) == minDistance);
		return position.findClosestByPath(closestObjects) ?? undefined; // don't clutter up pathing.distance cached values
	}
}
