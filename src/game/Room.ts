import {getRoomKeeperLairs} from './RoomStructures';
import {isPlayerCreep} from './Creep';
import {isControllerReservedByMe, isControllerSignedByMe} from './Structures';
import {createTickCache} from './cache';
import {isAlly} from '../utilities/utils';
import {groupBy} from '../utilities/native';

class RoomCache {
	creeps: Creep[] | undefined = undefined;
	hostiles: Creep[] | undefined = undefined;
	friendlies: Creep[] | undefined = undefined;
	invaders: Creep[] | undefined = undefined;
	sourceKeepers: Creep[] | undefined = undefined;
	playerHostiles: Creep[] | undefined = undefined;
	dangerousHostiles: Creep[] | undefined = undefined;
	dangerousPlayerHostiles: Creep[] | undefined = undefined;
	fleeDefaults: HasPos[] | undefined = undefined;
	allStructures: Structure[] | undefined = undefined;
	hostileStructures: Structure[] | undefined = undefined;
	flags: Flag[] | undefined = undefined;
	constructionSites: ConstructionSite[] | undefined = undefined;
	allConstructionSites: ConstructionSite[] | undefined = undefined;
	hostileConstructionSites: ConstructionSite[] | undefined = undefined;
	tombstones: Tombstone[] | undefined = undefined;
	ruins: Ruin[] | undefined = undefined;
	drops: { [resourceType: string]: Resource[] } | undefined = undefined;
}

const getRoomCache = createTickCache<Room, RoomCache>(() => new RoomCache());

// Commonly used room queries; cached results never add fields to engine rooms.

/**
 * Matches the engine's getActiveBodyparts semantics: damaged parts at the end of the body are
 * ignored, and the scan stops at the first zero-hits part. One pass replaces up to three native
 * getActiveBodyparts calls per creep.
 */
function hasActiveDangerousParts(creep: Creep, includeWork: boolean): boolean {
	const body = creep.body;
	for (let i = body.length - 1; i >= 0; i--) {
		const part = body[i];
		if (part.hits <= 0) {
			break;
		}
		if (part.type == ATTACK || part.type == RANGED_ATTACK || (includeWork && part.type == WORK)) {
			return true;
		}
	}
	return false;
}

// Logging =============================================================================================================
export function getRoomPrint(room: Room): string {
	return '<a href="#!/room/' + Game.shard.name + '/' + room.name + '">' + room.name + '</a>';
}

// Room properties =====================================================================================================

export function isRoomMine(room: Room): boolean {
	return !!(room.controller && room.controller.my);
}

export function isColonyRoom(room: Room): boolean {
	return Overmind.colonies[room.name] != undefined;
}

export function isOutpostRoom(room: Room): boolean {
	return Overmind.colonyMap[room.name] != undefined;
}

export function getRoomOwner(room: Room): string | undefined {
	return room.controller?.owner?.username;
}

export function getRoomReservedByMe(room: Room): boolean {
	return !!(room.controller && isControllerReservedByMe(room.controller));
}

export function getRoomSignedByMe(room: Room): boolean {
	return !!(room.controller && isControllerSignedByMe(room.controller));
}

// Room properties: creeps =============================================================================================

// Creeps physically in the room
export function getRoomCreeps(room: Room): Creep[] {
	const cache = getRoomCache(room);
	if (!cache.creeps) {
		cache.creeps = room.find(FIND_MY_CREEPS);
	}
	return cache.creeps;
}

// Room properties: hostiles ===========================================================================================

export function getRoomHostiles(room: Room): Creep[] {
	const cache = getRoomCache(room);
	if (!cache.hostiles) {
		cache.hostiles = room.find(FIND_HOSTILE_CREEPS, {filter: (creep: Creep) => !isAlly(creep.owner.username)});
	}
	return cache.hostiles;
}

export function getRoomFriendlies(room: Room): Creep[] {
	const cache = getRoomCache(room);
	if (!cache.friendlies) {
		cache.friendlies = room.find(FIND_HOSTILE_CREEPS, {filter: (creep: Creep) => isAlly(creep.owner.username)});
	}
	return cache.friendlies;
}

export function getRoomInvaders(room: Room): Creep[] {
	const cache = getRoomCache(room);
	if (!cache.invaders) {
		cache.invaders = getRoomHostiles(room).filter((creep: Creep) => creep.owner.username == 'Invader');
	}
	return cache.invaders;
}

export function getRoomSourceKeepers(room: Room): Creep[] {
	const cache = getRoomCache(room);
	if (!cache.sourceKeepers) {
		cache.sourceKeepers = getRoomHostiles(room).filter((creep: Creep) => creep.owner.username == 'Source Keeper');
	}
	return cache.sourceKeepers;
}

export function getRoomPlayerHostiles(room: Room): Creep[] {
	const cache = getRoomCache(room);
	if (!cache.playerHostiles) {
		cache.playerHostiles = getRoomHostiles(room).filter((creep: Creep) => isPlayerCreep(creep));
	}
	return cache.playerHostiles;
}

export function getRoomDangerousHostiles(room: Room): Creep[] {
	const cache = getRoomCache(room);
	if (!cache.dangerousHostiles) {
		const includeWork = !!isRoomMine(room);
		cache.dangerousHostiles = getRoomHostiles(room).filter((creep: Creep) =>
			hasActiveDangerousParts(creep, includeWork));
	}
	return cache.dangerousHostiles;
}

export function getRoomDangerousPlayerHostiles(room: Room): Creep[] {
	const cache = getRoomCache(room);
	if (!cache.dangerousPlayerHostiles) {
		cache.dangerousPlayerHostiles = getRoomDangerousHostiles(room).filter((creep: Creep) => isPlayerCreep(creep));
	}
	return cache.dangerousPlayerHostiles;
}

export function getRoomFleeDefaults(room: Room): HasPos[] {
	const cache = getRoomCache(room);
	if (!cache.fleeDefaults) {
		cache.fleeDefaults = [
			...getRoomDangerousHostiles(room),
			...getRoomKeeperLairs(room).filter((l: StructureKeeperLair) => (l.ticksToSpawn || Infinity) <= 10)
		];
	}
	return cache.fleeDefaults;
}

// All structures currently in the room
export function getRoomStructures(room: Room): Structure[] {
	const cache = getRoomCache(room);
	if (!cache.allStructures) {
		cache.allStructures = room.find(FIND_STRUCTURES);
	}
	return cache.allStructures;
}

// Hostile structures currently in the room
export function getRoomHostileStructures(room: Room): Structure[] {
	const cache = getRoomCache(room);
	if (!cache.hostileStructures) {
		cache.hostileStructures = room.find(FIND_HOSTILE_STRUCTURES, {
			filter: (s: Structure) => (s.hitsMax) && !isAlly((s as OwnedStructure).owner?.username ?? '')
		});
	}
	return cache.hostileStructures;
}

// Room properties: flags ==============================================================================================

// Flags physically in this room
export function getRoomFlags(room: Room): Flag[] {
	const cache = getRoomCache(room);
	if (!cache.flags) {
		cache.flags = room.find(FIND_FLAGS);
	}
	return cache.flags;
}

// Room properties: structures =========================================================================================

export function getRoomConstructionSites(room: Room): ConstructionSite[] {
	const cache = getRoomCache(room);
	if (!cache.constructionSites) {
		cache.constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
	}
	return cache.constructionSites;
}

export function getRoomAllConstructionSites(room: Room): ConstructionSite[] {
	const cache = getRoomCache(room);
	if (!cache.allConstructionSites) {
		cache.allConstructionSites = room.find(FIND_CONSTRUCTION_SITES);
	}
	return cache.allConstructionSites;
}

export function getRoomHostileConstructionSites(room: Room): ConstructionSite[] {
	const cache = getRoomCache(room);
	if (!cache.hostileConstructionSites) {
		cache.hostileConstructionSites = room.find(FIND_HOSTILE_CONSTRUCTION_SITES);
	}
	return cache.hostileConstructionSites;
}

export function getRoomTombstones(room: Room): Tombstone[] {
	const cache = getRoomCache(room);
	if (!cache.tombstones) {
		cache.tombstones = room.find(FIND_TOMBSTONES);
	}
	return cache.tombstones;
}

export function getRoomRuins(room: Room): Ruin[] {
	const cache = getRoomCache(room);
	if (!cache.ruins) {
		cache.ruins = room.find(FIND_RUINS);
	}
	return cache.ruins;
}

export function getRoomDrops(room: Room): { [resourceType: string]: Resource[] } {
	const cache = getRoomCache(room);
	if (!cache.drops) {
		cache.drops = groupBy(room.find(FIND_DROPPED_RESOURCES), (r: Resource) => r.resourceType);
	}
	return cache.drops;
}

export function getRoomDroppedEnergy(room: Room): Resource[] {
	return getRoomDrops(room)[RESOURCE_ENERGY] || [];
}

export function getRoomDroppedPower(room: Room): Resource[] {
	return getRoomDrops(room)[RESOURCE_POWER] || [];
}
