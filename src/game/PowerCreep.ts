import {roomPositionLookForStructure} from './RoomPosition';

export function isPowerCreepInRampart(creep: PowerCreep): boolean {
	return !!roomPositionLookForStructure(creep.pos, STRUCTURE_RAMPART); // this assumes hostile creeps can't stand in my ramparts
}
