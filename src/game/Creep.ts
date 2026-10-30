import {roomPositionLookForStructure} from './RoomPosition';
import {createTickCache} from './cache';
import {getBodyBoosts} from '../utilities/creepUtils';
import {countBy, defaults} from '../utilities/native';

class CreepCache {
	boosts: ResourceConstant[] | undefined = undefined;
	boostCounts: { [boostType: string]: number } | undefined = undefined;
	moveSpeed: number | undefined = undefined;
}

const getCreepCache = createTickCache<Creep, CreepCache>(() => new CreepCache());

// Creep properties ====================================================================================================

// Boosting logic ------------------------------------------------------------------------------------------------------

export function getCreepBoosts(creep: Creep): ResourceConstant[] {
	const cache = getCreepCache(creep);
	if (!cache.boosts) {
		cache.boosts = getBodyBoosts(creep.body);
	}
	return cache.boosts;
}

export function getCreepBoostCounts(creep: Creep): { [boostType: string]: number } {
	const cache = getCreepCache(creep);
	if (!cache.boostCounts) {
		cache.boostCounts = countBy(creep.body as BodyPartDefinition[], bodyPart => bodyPart.boost);
	}
	return cache.boostCounts;
}

export function getCreepApproxMoveSpeed(creep: Creep): number {
	const cache = getCreepCache(creep);
	if (cache.moveSpeed == undefined) {
		let movePower = 0;
		let nonMoveParts = 0;
		// Keep Lodash 3's reverse summation order while combining the two body scans.
		for (let i = creep.body.length - 1; i >= 0; i--) {
			const part: BodyPartDefinition = creep.body[i];
			if (part.type == MOVE) {
				if (part.boost) {
					movePower += +BOOSTS.move[<'ZO' | 'ZHO2' | 'XZHO2'>part.boost].fatigue || 0;
				}
			} else {
				nonMoveParts++;
			}
		}
		cache.moveSpeed = Math.max(movePower / nonMoveParts, 1); // if nonMoveParts == 0, this will be Infinity -> 1
	}
	return cache.moveSpeed;
}

export function isCreepInRampart(creep: Creep | PowerCreep): boolean {
	return !!roomPositionLookForStructure(creep.pos, STRUCTURE_RAMPART); // this assumes hostile creeps can't stand in my ramparts
}

// Body layout is immutable for an existing creep ID.
export function getCreepBodypartCounts(creep: Creep): { [bodypart in BodyPartConstant]: number } {
	PERMACACHE.bodypartCounts = PERMACACHE.bodypartCounts || {};
	if (PERMACACHE.bodypartCounts[creep.id] === undefined) {
		PERMACACHE.bodypartCounts[creep.id] = countBy(creep.body, (part: BodyPartDefinition) => part.type);
		defaults(PERMACACHE.bodypartCounts[creep.id], {
			[MOVE]         : 0,
			[WORK]         : 0,
			[CARRY]        : 0,
			[ATTACK]       : 0,
			[RANGED_ATTACK]: 0,
			[TOUGH]        : 0,
			[HEAL]         : 0,
			[CLAIM]        : 0,
		});
	}
	return PERMACACHE.bodypartCounts[creep.id];
}

export function isPlayerCreep(creep: Creep): boolean {
	const username = creep.owner.username;
	return username != 'Invader' && username != 'Source Keeper' && username != 'Screeps';
}
