import {getRoomBarriers, getRoomRepairables, getRoomSpawns, getRoomTowers} from '../game/RoomStructures';
import {isCreepInRampart} from '../game/Creep';
import {
	getRoomPositionPrint,
	getRoomPositionRangeToEdge,
	roomPositionGetMultiRoomRangeTo,
	roomPositionInRangeToXY,
	roomPositionLookForStructure,
} from '../game/RoomPosition';
import {
	getRoomCreeps,
	getRoomHostileStructures,
	getRoomHostiles,
	getRoomPlayerHostiles,
	getRoomReservedByMe,
	getRoomStructures,
	isRoomMine,
} from '../game/Room';
import {log} from '../console/log';
import {CombatIntel} from '../intel/CombatIntel';
import {MatrixLib} from '../matrix/MatrixLib';
import {Pathing} from '../movement/Pathing';
import {AttackStructurePriorities, AttackStructureScores} from '../priorities/priorities_structures';
import {profile} from '../profiler/decorator';
import {maxBy} from '../utilities/utils';
import {Visualizer} from '../visuals/Visualizer';
import {Swarm} from '../zerg/Swarm';
import {Zerg} from '../zerg/Zerg';
import {MY_USERNAME} from '../~settings';
import {defaults, sortBy, last, max} from '../utilities/native';

@profile
export class CombatTargeting {

	/**
	 * Finds the best target within a given range that a zerg can currently attack
	 */
	static findBestCreepTargetInRange(zerg: Zerg, range: number, targets = getRoomHostiles(zerg.room)): Creep | undefined {
		const nearbyHostiles = targets.filter(c => roomPositionInRangeToXY(zerg.pos, c.pos.x, c.pos.y, range));
		return maxBy(nearbyHostiles, function(hostile) {
			if (hostile.hitsPredicted == undefined) hostile.hitsPredicted = hostile.hits;
			if (roomPositionLookForStructure(hostile.pos, STRUCTURE_RAMPART)) return false;
			return hostile.hitsMax - hostile.hitsPredicted + CombatIntel.getHealPotential(hostile); // compute score
		});
	}

	/**
	 * Finds the best target within a given range that a zerg can currently attack
	 */
	static findBestStructureTargetInRange(zerg: Zerg, range: number, allowUnowned = true): Structure | undefined {
		let nearbyStructures = getRoomHostileStructures(zerg.room).filter(
										s => roomPositionInRangeToXY(zerg.pos, s.pos.x, s.pos.y, range));
		// If no owned structures to attack and not in colony room or outpost, target unowned structures
		if (allowUnowned && nearbyStructures.length == 0 && !Overmind.colonyMap[zerg.room.name]) {
			nearbyStructures = getRoomStructures(zerg.room).filter(
										s => roomPositionInRangeToXY(zerg.pos, s.pos.x, s.pos.y, range));
		}
		return maxBy(nearbyStructures, function(structure) {
			let score = 10 * AttackStructureScores[structure.structureType];
			if (roomPositionLookForStructure(structure.pos, STRUCTURE_RAMPART)) score *= .1;
			return score;
		});
	}

	/**
	 * Standard target-finding logic
	 */
	static findTarget(zerg: Zerg, targets = getRoomHostiles(zerg.room)): Creep | undefined {
		return maxBy(targets, function(hostile) {
			if (hostile.hitsPredicted == undefined) hostile.hitsPredicted = hostile.hits;
			if (roomPositionLookForStructure(hostile.pos, STRUCTURE_RAMPART)) return false;
			return hostile.hitsMax - hostile.hitsPredicted + CombatIntel.getHealPotential(hostile)
				   - 10 * roomPositionGetMultiRoomRangeTo(zerg.pos, hostile.pos); // compute score
		});
	}

	/**
	 * Finds the best target within a given range that a zerg can currently attack
	 */
	static findBestCreepTargetForTowers(room: Room, targets = getRoomHostiles(room)): Creep | undefined {
		return maxBy(targets, function(hostile) {
			if (hostile.hitsPredicted == undefined) hostile.hitsPredicted = hostile.hits;
			if (roomPositionLookForStructure(hostile.pos, STRUCTURE_RAMPART)) return false;
			return hostile.hitsMax - hostile.hitsPredicted
				   + CombatIntel.getHealPotential(hostile) + (CombatIntel.towerDamageAtPos(hostile.pos) || 0);
		});
	}


	static findClosestHostile(zerg: Zerg, opts: {
		checkReachable: boolean,
		ignoreCreepsAtEdge: boolean,
		playerOnly: boolean,
		onlyUnramparted: boolean
	}): Creep | undefined {

		defaults(opts, {
			checkReachable    : false,
			ignoreCreepsAtEdge: true,
			playerOnly        : false,
			onlyUnramparted   : false
		});
		if (getRoomHostiles(zerg.room).length > 0) {
			let targets: Creep[];
			const potentialTargets = opts.playerOnly ? getRoomPlayerHostiles(zerg.room) : getRoomHostiles(zerg.room);
			if (opts.ignoreCreepsAtEdge) {
				targets = potentialTargets.filter(hostile => getRoomPositionRangeToEdge(hostile.pos) > 0);
			} else {
				targets = potentialTargets;
			}
			if (opts.onlyUnramparted) {
				targets = targets.filter(hostile => !isCreepInRampart(hostile));
			}
			if (opts.checkReachable) {
				const targetsByRange = sortBy(targets, target => zerg.pos.getRangeTo(target));
				return targetsByRange.find(target =>
					Pathing.isReachable(zerg.pos, target.pos, getRoomBarriers(zerg.room).filter(
						barrier => barrier.structureType == STRUCTURE_WALL
								   || (barrier.structureType == STRUCTURE_RAMPART
									   && (barrier.owner.username == MY_USERNAME || !barrier.isPublic)))));
			} else {
				return zerg.pos.findClosestByRange(targets) as Creep | undefined;
			}
		}
	}

	// This method is expensive
	static findClosestReachable(pos: RoomPosition, targets: (Creep | Structure)[]): Creep | Structure | undefined {
		const targetsByRange = sortBy(targets, target => pos.getRangeTo(target));
		return targetsByRange.find(target => Pathing.isReachable(pos, target.pos, getRoomBarriers(target.room)));
	}

	static findClosestHurtFriendly(healer: Zerg): Creep | null {
		return healer.pos.findClosestByRange(getRoomCreeps(healer.room).filter(creep => creep.hits < creep.hitsMax));
	}

	/**
	 * Finds the best (friendly) target in range that a zerg can currently heal
	 */
	static findBestHealingTargetInRange(healer: Zerg, range = 3, friendlies = getRoomCreeps(healer.room)): Creep | undefined {
		const tempHitsPredicted: { [id: string]: number } = {};
		return maxBy(friendlies.filter(f => healer.pos.getRangeTo(f) <= range), friend => {
			if (friend.hitsPredicted == undefined) friend.hitsPredicted = friend.hits;
			const attackProbability = 0.5;
			tempHitsPredicted[friend.id] = friend.hitsPredicted;
			for (const hostile of friend.pos.findInRange(getRoomHostiles(friend.room), 3)) {
				if (!isCreepInRampart(friend)) {
					if (hostile.pos.isNearTo(friend)) {
						tempHitsPredicted[friend.id] -= attackProbability * CombatIntel.getAttackDamage(hostile);
					} else {
						tempHitsPredicted[friend.id] -= attackProbability * CombatIntel.getRangedAttackDamage(hostile);
					}
				}
			}
			const missingHits = friend.hitsMax - tempHitsPredicted[friend.id];
			if (healer.pos.getRangeTo(friend) > 1) {
				return Math.min(missingHits, CombatIntel.getRangedHealAmount(healer.creep));
			} else {
				return Math.min(missingHits, CombatIntel.getHealAmount(healer.creep));
			}
		});
	}

	static findClosestPrioritizedStructure(zerg: Zerg, checkReachable = false): Structure | undefined {
		for (const structureType of AttackStructurePriorities) {
			const structures = getRoomHostileStructures(zerg.room).filter(s => s.structureType == structureType);
			if (structures.length == 0) continue;
			if (checkReachable) {
				const closestReachable = this.findClosestReachable(zerg.pos, structures) as Structure | undefined;
				if (closestReachable) return closestReachable;
			} else {
				return zerg.pos.findClosestByRange(structures) as Structure | undefined;
			}
		}
		const core = getRoomHostileStructures(zerg.room).filter(s => s.structureType.toString() == 'invaderCore');
		if (core.length != 0) {
			return core[0];
		}
	}

	static findBestStructureTarget(pos: RoomPosition): Structure | undefined {
		const room = Game.rooms[pos.roomName];
		// Don't accidentally destroy your own shit
		if (!room || isRoomMine(room) || getRoomReservedByMe(room)) {
			return;
		}
		// Look for any unprotected structures
		const unprotectedRepairables = getRoomRepairables(room).filter(s => {
			const rampart = roomPositionLookForStructure(s.pos, STRUCTURE_RAMPART);
			return !rampart || rampart.hits < 10000;
		});
		let approach = unprotectedRepairables.map(structure => {
			return {pos: structure.pos, range: 0};
		}) as PathFinderGoal[];
		if (getRoomBarriers(room).length == 0 && unprotectedRepairables.length == 0) return; // if there's nothing in the room

		// Try to find a reachable unprotected structure
		if (approach.length > 0) {
			const ret = PathFinder.search(pos, approach, {
				maxRooms    : 1,
				maxOps      : 2000,
				roomCallback: roomName => {
					if (roomName != room.name) return false;
					const matrix = new PathFinder.CostMatrix();
					for (const barrier of getRoomBarriers(room)) {
						matrix.set(barrier.pos.x, barrier.pos.y, 0xff);
					}
					return matrix;
				},
			});
			const targetPos = last(ret.path);
			if (!ret.incomplete && targetPos) {
				const targetStructure = targetPos.lookFor(LOOK_STRUCTURES).filter(s => {
					return s.structureType != STRUCTURE_ROAD && s.structureType != STRUCTURE_CONTAINER;
				})[0];
				if (targetStructure) {
					log.debug(`Found unprotected structure target @ ${getRoomPositionPrint(targetPos)}`);
					return targetStructure;
				}
			}
		}

		// Determine a "siege anchor" for what you eventually want to destroy
		let targets: Structure[] = getRoomSpawns(room);
		if (targets.length == 0) targets = getRoomRepairables(room);
		if (targets.length == 0) targets = getRoomBarriers(room);
		if (targets.length == 0) targets = getRoomStructures(room);
		if (targets.length == 0) return;

		// Recalculate approach targets
		approach = targets.map(s => {
			return {pos: s.pos, range: 0};
		});

		const maxWallHits = max(getRoomBarriers(room), b => b.hits) || 0;
		// Compute path with wall position costs weighted by fraction of highest wall
		const ret = PathFinder.search(pos, approach, {
			maxRooms    : 1,
			plainCost   : 1,
			swampCost   : 2,
			roomCallback: roomName => {
				if (roomName != pos.roomName) return false;
				const matrix = new PathFinder.CostMatrix();
				for (const barrier of getRoomBarriers(room)) {
					const cost = 100 + Math.round((barrier.hits / maxWallHits) * 100);
					matrix.set(barrier.pos.x, barrier.pos.y, cost);
				}
				return matrix;
			},
		});

		// Target the first non-road, non-container structure you find along the path
		for (const pos of ret.path) {
			const targetStructure = pos.lookFor(LOOK_STRUCTURES).filter(s => {
				return s.structureType != STRUCTURE_ROAD && s.structureType != STRUCTURE_CONTAINER;
			})[0];
			if (targetStructure) {
				log.debug(`Targeting structure @ ${getRoomPositionPrint(targetStructure.pos)}`);
				return targetStructure;
			}
		}
	}

	static findBestSwarmStructureTarget(swarm: Swarm, roomName: string,
										randomness = 0, displayCostMatrix = false): Structure | undefined {
		const room = Game.rooms[roomName];
		// Don't accidentally destroy your own shit
		if (!room || isRoomMine(room) || getRoomReservedByMe(room)) {
			return;
		}
		if (swarm.anchor.roomName != roomName) {
			log.warning(`Swarm is not in target room!`);
			return;
		}

		// // Look for any unprotected structures
		// let unprotectedRepairables = _.filter(room.repairables, s => {
		// 	let rampart = s.pos.lookForStructure(STRUCTURE_RAMPART);
		// 	return !rampart || rampart.hits < 10000;
		// });
		// let approach = _.map(unprotectedRepairables, structure => {
		// 	return {pos: structure.pos, range: 0};
		// }) as PathFinderGoal[];
		// if (room.barriers.length == 0 && unprotectedRepairables.length == 0) return; // if there's nothing in the room
		//
		// // Try to find a reachable unprotected structure
		// if (approach.length > 0) {
		// 	let ret = PathFinder.search(swarm.anchor, approach, {
		// 		maxRooms    : 1,
		// 		maxOps      : 2000,
		// 		roomCallback: roomName => {
		// 			if (roomName != room.name) return false;
		// 			let matrix = Pathing.getSwarmTerrainMatrix(roomName, swarm.width, swarm.height).clone();
		// 			for (let barrier of room.barriers) {
		// 				let setPositions = Pathing.getPosWindow(barrier.pos, -swarm.width, -swarm.height);
		// 				for (let pos of setPositions) {
		// 					matrix.set(pos.x, pos.y, 0xff);
		// 				}
		// 			}
		// 			return matrix;
		// 		},
		// 	});
		// 	let targetPos = _.last(ret.path);
		// 	if (!ret.incomplete && targetPos) {
		// 		let targetStructure = _.first(_.filter(targetPos.lookFor(LOOK_STRUCTURES), s => {
		// 			return s.structureType != STRUCTURE_ROAD && s.structureType != STRUCTURE_CONTAINER;
		// 		}));
		// 		if (targetStructure) {
		// 			log.debug(`Found unprotected structure target @ ${targetPos.print}`);
		// 			return targetStructure;
		// 		}
		// 	}
		// }

		// Determine a "siege anchor" for what you eventually want to destroy
		let targets: Structure[] = getRoomSpawns(room);
		if (targets.length == 0) targets = getRoomTowers(room);
		if (targets.length == 0) targets = getRoomRepairables(room);
		if (targets.length == 0) targets = getRoomBarriers(room);
		if (targets.length == 0) targets = getRoomStructures(room);
		if (targets.length == 0) return;

		// Recalculate approach targets
		const approach = targets.map(s => { // TODO: might need to Pathing.getPosWindow() this
			return {pos: s.pos, range: 0};
		});

		const maxWallHits = max(getRoomBarriers(room), b => b.hits) || 0;
		// Compute path with wall position costs weighted by fraction of highest wall
		const ret = PathFinder.search(swarm.anchor, approach, {
			maxRooms    : 1,
			plainCost   : 1,
			swampCost   : 2,
			roomCallback: rn => {
				if (rn != roomName) return false;

				const matrix = MatrixLib.getSwarmTerrainMatrix(roomName, {plainCost: 1, swampCost: 5},
															   swarm.width, swarm.height);
				for (const barrier of getRoomBarriers(room)) {
					const randomFactor = Math.min(Math.round(randomness * Math.random()), 100);
					const cost = 100 + Math.round((barrier.hits / maxWallHits) * 100) + randomFactor;
					MatrixLib.setToMaxCostAfterMaxPooling(matrix, [barrier], swarm.width, swarm.height, cost);
				}
				if (displayCostMatrix) {
					Visualizer.displayCostMatrix(matrix, roomName);
				}
				return matrix;
			},
		});

		// Target the first non-road, non-container structure you find along the path or neighboring positions
		for (const pos of ret.path) {
			log.debug(`Searching path ${getRoomPositionPrint(pos)}...`);
			const searchPositions = Pathing.getPosWindow(pos, swarm.width, swarm.height); // not -1*width
			for (const searchPos of searchPositions) {
				const targetStructure = searchPos.lookFor(LOOK_STRUCTURES).filter(s => {
					return s.structureType != STRUCTURE_ROAD && s.structureType != STRUCTURE_CONTAINER;
				})[0];
				if (targetStructure) {
					log.debug(`Targeting structure @ ${getRoomPositionPrint(targetStructure.pos)}`);
					return targetStructure;
				}
			}
		}
	}

}
