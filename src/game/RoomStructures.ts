import {getCacheExpiration, onPublicServer} from '../utilities/utils';
import {compact} from '../utilities/native';
import {createTickCache} from './cache';
import {getRoomDroppedEnergy, getRoomRuins, getRoomStructures, getRoomTombstones} from './Room';
import {isStructureWalkable} from './Structures';

// Cache structure IDs across ticks; resolve live objects into an external cache each tick.

const roomStructureIDs: { [roomName: string]: { [structureType: string]: string[] } } = {};
const roomStructuresExpiration: { [roomName: string]: number } = {};
const multipleList = [
	STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_ROAD, STRUCTURE_WALL,
	STRUCTURE_RAMPART, STRUCTURE_KEEPER_LAIR, STRUCTURE_PORTAL, STRUCTURE_LINK,
	STRUCTURE_TOWER, STRUCTURE_LAB, STRUCTURE_CONTAINER, STRUCTURE_POWER_BANK,
];
const singleList = [
	STRUCTURE_OBSERVER, STRUCTURE_POWER_SPAWN, STRUCTURE_EXTRACTOR,
	STRUCTURE_NUKER, STRUCTURE_FACTORY, STRUCTURE_INVADER_CORE,
];
const notRepairable: string[] = [STRUCTURE_KEEPER_LAIR, STRUCTURE_PORTAL, STRUCTURE_POWER_BANK, STRUCTURE_INVADER_CORE];
const STRUCTURE_TIMEOUT = onPublicServer() ? 50 : 10;

export function refreshRoomStructureCache(room: Room): void {
	if (!roomStructuresExpiration[room.name] || !roomStructureIDs[room.name]
		|| Game.time > roomStructuresExpiration[room.name]) {
		roomStructuresExpiration[room.name] = getCacheExpiration(STRUCTURE_TIMEOUT);
		const ids: { [structureType: string]: string[] } = {};
		for (const structure of room.find(FIND_STRUCTURES)) {
			const type = structure.structureType;
			if (Object.hasOwn(ids, type)) ids[type].push(structure.id);
			else ids[type] = [structure.id];
		}
		roomStructureIDs[room.name] = ids;
	}
}

function multiple<T extends Structure>(type: StructureConstant): (room: Room) => T[] {
	return createTickCache((room: Room): T[] => {
		refreshRoomStructureCache(room);
		const ids = roomStructureIDs[room.name][type];
		return ids ? compact(ids.map(Game.getObjectById)) as T[] : [];
	});
}

function single<T extends Structure>(type: StructureConstant): (room: Room) => T | undefined {
	return createTickCache((room: Room): T | undefined => {
		refreshRoomStructureCache(room);
		const ids = roomStructureIDs[room.name][type];
		return ids ? (Game.getObjectById(ids[0]) as T | null) ?? undefined : undefined;
	});
}

export const getRoomSpawns = multiple<StructureSpawn>(STRUCTURE_SPAWN);
export const getRoomExtensions = multiple<StructureExtension>(STRUCTURE_EXTENSION);
export const getRoomRoads = multiple<StructureRoad>(STRUCTURE_ROAD);
export const getRoomConstructedWalls = multiple<StructureWall>(STRUCTURE_WALL);
export const getRoomRamparts = multiple<StructureRampart>(STRUCTURE_RAMPART);
export const getRoomKeeperLairs = multiple<StructureKeeperLair>(STRUCTURE_KEEPER_LAIR);
export const getRoomPortals = multiple<StructurePortal>(STRUCTURE_PORTAL);
export const getRoomLinks = multiple<StructureLink>(STRUCTURE_LINK);
export const getRoomTowers = multiple<StructureTower>(STRUCTURE_TOWER);
export const getRoomLabs = multiple<StructureLab>(STRUCTURE_LAB);
export const getRoomContainers = multiple<StructureContainer>(STRUCTURE_CONTAINER);
export const getRoomPowerBanks = multiple<StructurePowerBank>(STRUCTURE_POWER_BANK);
export const getRoomObserver = single<StructureObserver>(STRUCTURE_OBSERVER);
export const getRoomPowerSpawn = single<StructurePowerSpawn>(STRUCTURE_POWER_SPAWN);
export const getRoomExtractor = single<StructureExtractor>(STRUCTURE_EXTRACTOR);
export const getRoomNuker = single<StructureNuker>(STRUCTURE_NUKER);
export const getRoomFactory = single<StructureFactory>(STRUCTURE_FACTORY);
export const getRoomInvaderCore = single<StructureInvaderCore>(STRUCTURE_INVADER_CORE);
export const getRoomWalls = getRoomConstructedWalls;

const multipleGetters: { [type: string]: (room: Room) => Structure[] } = {
	[STRUCTURE_SPAWN]: getRoomSpawns, [STRUCTURE_EXTENSION]: getRoomExtensions,
	[STRUCTURE_ROAD]: getRoomRoads, [STRUCTURE_WALL]: getRoomConstructedWalls,
	[STRUCTURE_RAMPART]: getRoomRamparts, [STRUCTURE_KEEPER_LAIR]: getRoomKeeperLairs,
	[STRUCTURE_PORTAL]: getRoomPortals, [STRUCTURE_LINK]: getRoomLinks,
	[STRUCTURE_TOWER]: getRoomTowers, [STRUCTURE_LAB]: getRoomLabs,
	[STRUCTURE_CONTAINER]: getRoomContainers, [STRUCTURE_POWER_BANK]: getRoomPowerBanks,
};
const singleGetters: { [type: string]: (room: Room) => Structure | undefined } = {
	[STRUCTURE_OBSERVER]: getRoomObserver, [STRUCTURE_POWER_SPAWN]: getRoomPowerSpawn,
	[STRUCTURE_EXTRACTOR]: getRoomExtractor, [STRUCTURE_NUKER]: getRoomNuker,
	[STRUCTURE_FACTORY]: getRoomFactory, [STRUCTURE_INVADER_CORE]: getRoomInvaderCore,
};

export const getRoomStorageUnits = createTickCache((room: Room): StorageUnit[] =>
	[...compact([room.storage, room.terminal]), ...getRoomContainers(room)]);
export const getRoomSources = createTickCache((room: Room): Source[] => room.find(FIND_SOURCES));
export const getRoomMineral = createTickCache((room: Room): Mineral | undefined => room.find(FIND_MINERALS)[0]);

export const getRoomRepairables = createTickCache((room: Room): Structure[] => {
	refreshRoomStructureCache(room);
	const cached = roomStructureIDs[room.name].repairables;
	if (cached) return compact(cached.map(Game.getObjectById)) as Structure[];
	let repairables: Structure[] = [];
	for (const type of singleList) {
		if (!notRepairable.includes(type)) {
			const structure = singleGetters[type](room);
			if (structure) repairables.push(structure);
		}
	}
	for (const type of multipleList) {
		if (type !== STRUCTURE_WALL && type !== STRUCTURE_RAMPART && type !== STRUCTURE_ROAD
			&& !notRepairable.includes(type)) repairables = repairables.concat(multipleGetters[type](room));
	}
	roomStructureIDs[room.name].repairables = repairables.map(s => s.id);
	return repairables;
});

export const getRoomWalkableRamparts = createTickCache((room: Room): StructureRampart[] => {
	refreshRoomStructureCache(room);
	const cached = roomStructureIDs[room.name].walkableRamparts;
	if (cached) return compact(cached.map(id => Game.getObjectById(id))) as StructureRampart[];
	const terrain = Game.map.getRoomTerrain(room.name);
	const blocked = new Set<number>();
	for (const structure of getRoomStructures(room)) {
		if (!isStructureWalkable(structure)) blocked.add(structure.pos.y * 50 + structure.pos.x);
	}
	const ramparts = getRoomRamparts(room).filter(rampart => isStructureWalkable(rampart)
		&& terrain.get(rampart.pos.x, rampart.pos.y) !== TERRAIN_MASK_WALL
		&& !blocked.has(rampart.pos.y * 50 + rampart.pos.x));
	roomStructureIDs[room.name].walkableRamparts = ramparts.map(r => r.id);
	return ramparts;
});

export const getRoomRechargeables = createTickCache((room: Room): rechargeObjectType[] => [
	...getRoomStorageUnits(room), ...getRoomDroppedEnergy(room), ...getRoomTombstones(room), ...getRoomRuins(room),
]);
export const getRoomBarriers = createTickCache((room: Room): (StructureWall | StructureRampart)[] =>
	[...getRoomRamparts(room), ...getRoomConstructedWalls(room)]);
