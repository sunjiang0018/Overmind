import {roomPositionLookForStructure} from '../game/RoomPosition';
import {getRoomDangerousHostiles} from '../game/Room';
import type {Colony} from '../Colony';
import {packCoordList} from '../utilities/packrat';
import {PEACETIME_BARRIER_HITS} from '../~settings';
import {E58S42_PLAN} from './layouts/E58S42';
import type {RoomPlannerMemory} from './RoomPlanner';

const VERSION = 'E58S42-terrain-v4';
export const OVERRIDE_TUNNEL_RCL = 6;
export const RCL6_RUSH = {
	barrierHits: 10000,
	criticalBarrierHits: 2500,
	energyBuffer: 2000,
	upgradePower: 9,
	maxWorkers: 3,
};

export function hasRoomOverride(roomName: string): boolean {
	return Game.shard.name == 'shard3' && roomName == 'E58S42';
}

export function prioritizesRCL6(roomName: string, level: number): boolean {
	return hasRoomOverride(roomName) && level >= 3 && level < 6;
}

/** Cap peaceful upkeep, including tasks saved before the policy changed. */
export function earlyBarrierLimit(pos: ProtoPos): number | undefined {
	const room = Game.rooms[pos.roomName];
	if (PEACETIME_BARRIER_HITS != undefined && room && room.controller && room.controller.my
		&& getRoomDangerousHostiles(room).length == 0 && room.find(FIND_NUKES).length == 0) {
		return PEACETIME_BARRIER_HITS;
	}
	if (room && room.controller && prioritizesRCL6(pos.roomName, room.controller.level)
		&& getRoomDangerousHostiles(room).length == 0 && room.find(FIND_NUKES).length == 0) {
		return RCL6_RUSH.barrierHits;
	}
}

/** Install once, before Colony selects its hatchery/manager implementation. */
export function installRoomOverride(colony: Colony, memory: RoomPlannerMemory): void {
	if (!hasRoomOverride(colony.name) || !colony.controller.my || memory.customLayout == VERSION) return;
	const terrain = Game.map.getRoomTerrain(colony.name);
	const buildings: {[type: string]: Coord[]} = E58S42_PLAN.buildings;
	for (const type in buildings) {
		for (const pos of buildings[type]) {
			if (type != STRUCTURE_ROAD && type != STRUCTURE_EXTRACTOR &&
				terrain.get(pos.x, pos.y) == TERRAIN_MASK_WALL) {
				throw new Error(`Invalid ${VERSION}: ${type} at ${pos.x},${pos.y}`);
			}
		}
	}
	// Reject a stale profile instead of relocating buildings added since this survey.
	for (const structure of colony.room.find(FIND_MY_STRUCTURES)) {
		const type = structure.structureType;
		if (type == STRUCTURE_RAMPART || type == STRUCTURE_CONTROLLER || type == STRUCTURE_LINK) continue;
		if (!(buildings[type] || []).some(p => p.x == structure.pos.x && p.y == structure.pos.y)) {
			throw new Error(`${VERSION} needs review: existing ${type} at ${structure.pos}`);
		}
	}
	memory.mapsByLevel = {};
	for (let level = 1; level <= 8; level++) {
		const map: {[type: string]: ProtoPos[]} = {};
		for (const type in buildings) {
			const limit = CONTROLLER_STRUCTURES[type as BuildableStructureConstant][level];
			map[type] = buildings[type].slice(0, limit).map(p => ({...p, roomName: colony.name}));
		}
		memory.mapsByLevel[level] = map;
	}
	delete memory.bunkerData;
	memory.active = false;
	memory.savedFlags = [];
	memory.relocating = false;
	memory.misplacedStructures = false;
	memory.lastGenerated = Game.time;
	memory.recheckStructuresAt = Game.time + 1;
	memory.customLayout = VERSION;
	Object.assign(colony.memory, {
		barrierPlanner: {barrierCoordsPacked: packCoordList(E58S42_PLAN.barriers)},
		roadPlanner: {
			roadCoordsPacked: {[colony.name]: packCoordList(E58S42_PLAN.buildings.road)},
			roadCoverage: 0,
			roadCoverages: {},
		},
	});
	console.log(`Installed ${VERSION}: compact roads and perimeter; critical shields follow completed buildings.`);
}

/** Reserve tunnel sites once the colony can afford them at RCL6. */
export function buildOverrideTunnel(colony: Colony): void {
	if (!hasRoomOverride(colony.name) || colony.level < OVERRIDE_TUNNEL_RCL || Game.time % 10 != 0) return;
	let slots = Math.max(0, 10 - colony.room.find(FIND_MY_CONSTRUCTION_SITES).length);
	for (const coord of E58S42_PLAN.tunnel) {
		if (slots == 0) break;
		const pos = new RoomPosition(coord.x, coord.y, colony.name);
		if (!roomPositionLookForStructure(pos, STRUCTURE_ROAD) && pos.lookFor(LOOK_CONSTRUCTION_SITES).length == 0) {
			if (pos.createConstructionSite(STRUCTURE_ROAD) == OK) slots--;
		}
	}
}

export function isOverrideTunnel(roomName: string, x: number, y: number): boolean {
	return hasRoomOverride(roomName) && E58S42_PLAN.tunnel.some(p => p.x == x && p.y == y);
}

/** Keep existing sites and their progress, but defer all construction until RCL6. */
export function isDeferredTunnel(pos: ProtoPos): boolean {
	if (!isOverrideTunnel(pos.roomName, pos.x, pos.y)) return false;
	const room = Game.rooms[pos.roomName];
	return !room || !room.controller || room.controller.level < OVERRIDE_TUNNEL_RCL;
}
