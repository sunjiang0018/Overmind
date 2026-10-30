import {getRoomKeeperLairs, getRoomWalkableRamparts} from '../game/RoomStructures';
import {getRoomCreeps, getRoomInvaders, getRoomSourceKeepers} from '../game/Room';
import {
	getRoomPositionNeighbors,
	getRoomPositionPrint,
	getRoomPositionRangeToEdge,
	isPositionOnEdge,
	roomPositionAvailableNeighbors,
	roomPositionGetPositionAtDirection,
	roomPositionInRangeToXY,
	roomPositionIsWalkable,
	roomPositionLookForStructure,
} from '../game/RoomPosition';
import {log} from '../console/log';
import {Roles} from '../creepSetups/setups';
import {isAnyZerg, isPowerZerg, isStandardZerg} from '../declarations/typeGuards';
import {MatrixLib, MatrixOptions} from '../matrix/MatrixLib';
import {profile} from '../profiler/decorator';
import {insideBunkerBounds} from '../roomPlanner/layouts/bunker';
import {rightArrow} from '../utilities/stringConstants';
import {minBy, stringToColorHash} from '../utilities/utils';
import {Visualizer} from '../visuals/Visualizer';
import {AnyZerg, normalizeAnyZerg} from '../zerg/AnyZerg';
import {Swarm} from '../zerg/Swarm';
import {Zerg} from '../zerg/Zerg';
import {getTerrainCosts, isExit, normalizePos, sameCoord} from './helpers';
import {Pathing, PathOptions} from './Pathing';
import {groupBy, defaultsDeep, unique, sortBy, defaults, last, flatten, compactMap} from '../utilities/native';


export const CROSSING_PORTAL = 21;
export const ERR_CANNOT_PUSH_CREEP = -30;

const REPORT_CPU_THRESHOLD = 750; 	// Report when creep uses more than this amount of CPU over lifetime
const REPORT_SWARM_CPU_THRESHOLD = 1500;

const DEFAULT_STUCK_VALUE = 2;		// Marked as stuck after this many ticks

const STATE_PREV_X = 0;
const STATE_PREV_Y = 1;
const STATE_STUCK = 2;
const STATE_CPU = 3;
const STATE_DEST_X = 4;
const STATE_DEST_Y = 5;
const STATE_DEST_ROOMNAME = 6;
const STATE_CURRENT_X = 7;
const STATE_CURRENT_Y = 8;

export const MovePriorities = {
	[Roles.manager]       : 0, // movement priority 0 means you will never get pushed
	[Roles.queen]         : 2,
	[Roles.bunkerDefender]: 3,
	[Roles.melee]         : 3,
	powerCreep            : 3,
	[Roles.dismantler]    : 4,
	[Roles.ranged]        : 4,
	[Roles.guardMelee]    : 5,
	// [Roles.ranged]: 6,
	[Roles.transport]     : 8,
	[Roles.worker]        : 9,
	default               : 10,
};

export interface MoveOptions {
	// terrainCosts?: {							// terrain costs, determined automatically for creep body if unspecified
	// 	plainCost: number,							// plain costs; typical: 2
	// 	swampCost: number							// swamp costs; typical: 10
	// };											//
	force?: boolean;							// whether to ignore Zerg.blockMovement
	// ignoreCreeps?: boolean;						// ignore pathing around creeps
	ignoreCreepsOnDestination?: boolean; 		// ignore creeps currently standing on the destination
	// ignoreStructures?: boolean;					// ignore pathing around structures
	// preferHighway?: boolean;					// prefer alley-type rooms
	// allowHostile?: boolean;						// allow to path through hostile rooms; origin/destination room excluded
	// avoidSK?: boolean;							// avoid walking within range 4 of source keepers
	range?: number;								// range to approach target
	fleeRange?: number;							// range to flee from targets
	// obstacles?: RoomPosition[];					// don't path through these room positions
	// maxRooms?: number;							// maximum number of rooms to path through
	// route?: Route;								// manually supply the map route to take
	// maxOps?: number;							// pathfinding times out after this many operations
	movingTarget?: boolean;						// appends a direction to path in case creep moves
	stuckValue?: number;						// creep is marked stuck after this many idle ticks
	repathChance?: number;							// probability of repathing on a given tick
	// ensurePath?: boolean;						// can be useful if route keeps being found as incomplete
	noPush?: boolean;							// whether to ignore pushing behavior
	// modifyRoomCallback?: (r: Room, m: CostMatrix) => CostMatrix; // modifications to default cost matrix calculations
	// allowPortals?: boolean;
	// waypoints?: RoomPosition[];					// list of waypoints to visit on the way to target
	pathOpts?: PathOptions;
}


export const getDefaultMoveOptions: () => MoveOptions = () => ({
	pathOpts: {},
});

export interface SwarmMoveOptions {
	range?: number;
	ensureSingleRoom?: boolean;
	ignoreStructures?: boolean;					// ignore pathing around structures
	blockCreeps?: boolean;						// ignore pathing around creeps
	maxOps?: number;							// pathfinding times out after this many operations
	stuckValue?: number;						// creep is marked stuck after this many idle ticks
	maxRooms?: number;							// maximum number of rooms to path through
	repathChance?: number;						// probability of repathing on a given tick
	displayCostMatrix?: boolean;
}

export interface CombatMoveOptions {
	allowExit?: boolean;
	avoidPenalty?: number;
	approachBonus?: number;
	preferRamparts?: boolean;
	requireRamparts?: boolean;
	displayCostMatrix?: boolean;
	displayAvoid?: boolean;
	blockMyCreeps?: boolean;
	blockHostileCreeps?: boolean;
	blockAlliedCreeps?: boolean;
}

export interface MoveState {
	stuckCount: number;
	lastCoord: Coord;
	destination: RoomPosition;
	cpu: number;
	currentXY?: Coord;
}


/**
 * This is the movement library for Overmind. It was originally based on BonzAI's Traveler library, but it has been
 * extensively modified to integrate more tightly with the Overmind framework and add additional functionality.
 */
@profile
export class Movement {

	// Core creep movement functions ===================================================================================

	/**
	 * Move a creep to a destination
	 */
	static goTo(creep: AnyZerg, destination: HasPos | RoomPosition, opts: MoveOptions = {}): number {

		if (creep.blockMovement && !opts.force) {
			return ERR_BUSY;
		}
		if (isStandardZerg(creep)) {
			if (creep.spawning) {
				return NO_ACTION;
			}
			if (creep.fatigue > 0) {
				Movement.circle(creep.pos, 'aqua', .3);
				return ERR_TIRED;
			}
		}

		if (opts.movingTarget) {
			opts.range = 0;
		}

		// Set default options
		defaultsDeep(opts, getDefaultMoveOptions());
		const pathOpts = opts.pathOpts as PathOptions; // modifications to pathOpts show up on opts.pathOpts

		// initialize data object
		if (!creep.memory._go) {
			creep.memory._go = {} as MoveData;
		}
		const moveData = creep.memory._go as MoveData;

		// set destination according to waypoint specifications; finalDestination is the true destination
		destination = normalizePos(destination);
		// const finalDestination = destination;

		// if (opts.waypoints) {
		// 	destination = this.getDestination(destination, opts.waypoints, moveData);
		// }

		Pathing.updateRoomStatus(creep.room);

		// Fixes bug that causes creeps to idle on the other side of a room
		if (opts.range != undefined && getRoomPositionRangeToEdge(destination) <= opts.range) {
			opts.range = Math.min(Math.abs(getRoomPositionRangeToEdge(destination) - 1), 0);
		}

		// Take care of properties which exist on both moveOpts and pathOpts: if they are specified on both moveOpts
		// and moveOpts.pathOpts then the value of range or fleeRange on moveOpts takes precedence.
		// -> This must be done after the last modification to opts.range and opts.fleeRange!
		if (opts.range != undefined) {
			pathOpts.range = opts.range;
		}
		if (opts.fleeRange != undefined) {
			pathOpts.fleeRange = opts.fleeRange;
		}

		// manage case where creep is nearby destination
		const rangeToDestination = creep.pos.getRangeTo(destination);
		if (opts.range != undefined && rangeToDestination <= opts.range) {
			// if (destination.isEqualTo(finalDestination)) {
			if (isPositionOnEdge(creep.pos)) { // move the creep off the edge tiles to prevent it bouncing
				return creep.moveOffExit(destination);
			} else {
				delete creep.memory._go;
				return NO_ACTION;
			}
			// } else {
			// 	// debug
			// 	console.log(`Destination ${destination} not equal to final destination ${finalDestination}!`);
			// 	if (!moveData.waypointsVisited) {
			// 		moveData.waypointsVisited = [];
			// 	}
			// 	moveData.waypointsVisited.push(destination.name);
			//
			// 	// call goTo again to path to the final destination
			// 	return this.goTo(creep, finalDestination, opts);
			// }
		} else if (rangeToDestination <= 1) {
			// move onto destination
			if (rangeToDestination == 1 && !opts.range) {
				const direction = creep.pos.getDirectionTo(destination);
				if (roomPositionIsWalkable(destination, opts.ignoreCreepsOnDestination)) {
					return creep.move(direction, !!opts.force);
				}
			} else { // at destination
				if (!moveData.fleeWait) {
					delete creep.memory._go;
				}
				return NO_ACTION;
			}
		}

		// // traverse through a portal waypoint or check that has just been traversed
		// if (opts.waypoints && !destination.isEqualTo(finalDestination) && (moveData.portaling == true
		// 																   || creep.pos.getRangeTo(destination) < 2)) {
		// 	const portalTraversed = this.traversePortalWaypoint(creep, destination);
		// 	if (portalTraversed) {
		// 		return this.goTo(creep, finalDestination, opts);
		// 	} else {
		// 		return CROSSING_PORTAL;
		// 	}
		// }

		// handle delay
		if (moveData.delay != undefined) {
			if (moveData.delay <= 0) {
				delete moveData.delay;
			} else {
				moveData.delay--;
				return OK;
			}
		}

		const state = this.deserializeState(moveData, destination);

		// // verify creep is in the location it thinks it should be in
		// if (state.currentXY) {
		// 	let {x, y} = state.currentXY;
		// 	if (!(creep.pos.x == x && creep.pos.y == y)) { // creep thought it would move last tick but didn't
		// 		log.debug(`${creep.print} has gotten off track; deleting path!`);
		// 		delete moveData.path;
		// 	}
		// }

		// uncomment to visualize destination
		// this.circle(destination, "orange");

		// check if creep is stuck
		if (this.isStuck(creep, state)) {
			state.stuckCount++;
			this.circle(creep.pos, 'magenta', state.stuckCount * .3);
			// pushedCreep = this.pushCreep(creep);
		} else {
			state.stuckCount = 0;
		}

		// handle case where creep is stuck
		if (!opts.stuckValue) {
			opts.stuckValue = DEFAULT_STUCK_VALUE;
		}
		if (state.stuckCount >= opts.stuckValue && Math.random() > .5) {
			pathOpts.blockCreeps = true;
			delete moveData.path;
		}

		// delete path cache if destination is different
		if (!destination.isEqualTo(state.destination)) {
			if (opts.movingTarget && state.destination.isNearTo(destination)) {
				if (moveData.path) {
					moveData.path += state.destination.getDirectionTo(destination);
				}
				state.destination = destination;
			} else {
				delete moveData.path;
			}
		}


		// randomly repath with specified probability
		if (opts.repathChance && Math.random() < opts.repathChance) {
			delete moveData.path;
		}

		// TODO: repath if you are not on expected next position


		// pathfinding
		let newPath = false;
		if (!moveData.path || moveData.path.length == 0) {
			newPath = true;
			if (isStandardZerg(creep) && creep.spawning) {
				return ERR_BUSY;
			}
			state.destination = destination;
			// Compute terrain costs
			if (isPowerZerg(creep)) {
				if (pathOpts.terrainCosts) {
					log.error(`${creep.print}: MoveOptions.terrainCosts not supported by PowerZerg`);
				}
				pathOpts.terrainCosts = {plainCost: 1, swampCost: 1};
			} else if (isStandardZerg(creep)) {
				if (!pathOpts.terrainCosts) {
					pathOpts.terrainCosts = getTerrainCosts(creep.creep);
				}
			} else {
				log.error(`${creep.print} is not Zerg or PowerZerg!`);
			}
			const cpu = Game.cpu.getUsed();

			// creep.debug(`Pathfinding from ${creep.pos} to ${destination} with opts ${JSON.stringify(pathOpts)}`);
			// Pathfinding call ------------------------------------------
			const ret = Pathing.findPath(creep.pos, destination, pathOpts);
			// -----------------------------------------------------------
			// creep.debug(`Pathfinding return: ${print(ret)}`);

			const cpuUsed = Game.cpu.getUsed() - cpu;
			state.cpu = Math.round(cpuUsed + state.cpu);
			if (Game.time % 10 == 0 && state.cpu > REPORT_CPU_THRESHOLD) {
				log.alert(`Movement: heavy cpu use: ${creep.name}, cpu: ${state.cpu}. ` +
						  `(${getRoomPositionPrint(creep.pos)} ${rightArrow} ${getRoomPositionPrint(destination)})`);
			}
			let color = 'orange';
			if (ret.incomplete) {
				// uncommenting this is a great way to diagnose creep behavior issues
				log.debug(`Movement: incomplete path for ${creep.print}! ` +
						  `(${getRoomPositionPrint(creep.pos)} ${rightArrow} ${getRoomPositionPrint(destination)})`);
				color = 'red';
			}
			this.circle(creep.pos, color);
			moveData.path = Pathing.serializePath(creep.pos, ret.path, color);

			const roomsVisited = unique(ret.path.map(pos => pos.roomName));
			if (!moveData.roomVisibility) {
				moveData.roomVisibility = {};
			}
			for (const roomName of roomsVisited) {
				moveData.roomVisibility[roomName] = !!Game.rooms[roomName];
			}
			state.stuckCount = 0;

		}

		if (!moveData.path || moveData.path.length == 0) {
			this.serializeState(creep, destination, state, moveData);
			return ERR_NO_PATH;
		}

		// push creeps out of the way if needed
		if (!opts.noPush) {
			const obstructingCreep = this.findBlockingCreep(creep);
			if (obstructingCreep && this.shouldPush(creep, obstructingCreep)) {
				const pushedCreep = this.pushCreep(creep, obstructingCreep);
				if (!pushedCreep) {
					this.serializeState(creep, destination, state, moveData);
					return ERR_CANNOT_PUSH_CREEP;
				}
			}
		}

		// consume path
		if (state.stuckCount == 0 && !newPath) {
			moveData.path = moveData.path.substr(1);
		}
		const nextDirection = parseInt(moveData.path[0], 10) as DirectionConstant;

		// predict next coordinate (for verification)
		const nextPos = roomPositionGetPositionAtDirection(creep.pos, nextDirection);

		this.serializeState(creep, destination, state, moveData, {x: nextPos.x, y: nextPos.y});

		return creep.move(nextDirection, !!opts.force);
	}

	static visualizeMemorizedPath(creep: AnyZerg, color: string = 'aqua'): void {
		// initialize data object
		if (creep.memory._go && creep.memory._go.path) {
			const directions = creep.memory._go.path.substr(1);
			let pos = creep.pos;
			const path: RoomPosition[] = [pos];
			for (const direction of directions) {
				const nextDirection = parseInt(direction, 10) as DirectionConstant;
				const nextPos = roomPositionGetPositionAtDirection(pos, nextDirection);
				path.push(nextPos);
				pos = nextPos;
			}
			const positionsGroupedByRoom = groupBy(path, pos => pos.roomName);
			for (const roomName in positionsGroupedByRoom) {
				new RoomVisual(roomName).poly(positionsGroupedByRoom[roomName], {stroke: color, lineStyle: 'dotted'});
			}
		}
	}

	// /**
	//  * Gets the effective destination based on the waypoints to travel over and the creep.memory._go object.
	//  * Finds the next waypoint which has not been marked as visited in moveData.
	//  */
	// private static getDestination(destination: RoomPosition, waypoints: RoomPosition[],
	// 							  moveData: MoveData): RoomPosition {
	//
	// 	const waypointsVisited = _.compact(_.map(moveData.waypointsVisited || [],
	// 											 posName => getPosFromString(posName))) as RoomPosition[];
	// 	const nextWaypoint = _.find(waypoints, waypoint => !_.any(waypointsVisited,
	// 															  visited => waypoint.isEqualTo(visited)));
	//
	// 	if (nextWaypoint) {
	// 		return nextWaypoint;
	// 	} else {
	// 		return destination;
	// 	}
	//
	// }

	// /**
	//  * Navigate a creep through a portal
	//  */
	// private static traversePortalWaypoint(creep: AnyZerg, portalPos: RoomPosition): boolean {
	// 	if (creep.pos.roomName == portalPos.roomName && creep.pos.getRangeTo(portalPos) > 1) {
	// 		log.error(`Movement.travelPortalWaypoint() should only be called in range 1 of portal!`);
	// 	}
	//
	// 	const moveData = creep.memory._go || {} as MoveData;
	//
	// 	if (portalPos.room && !portalPos.lookForStructure(STRUCTURE_PORTAL)) {
	// 		log.error(`Portal not found at ${portalPos.print}!`);
	// 		return false;
	// 	}
	//
	// 	moveData.portaling = true;
	// 	const crossed = this.crossPortal(creep, portalPos);
	//
	// 	if (crossed) {
	// 		moveData.portaling = false;
	// 		if (!moveData.waypointsVisited) {
	// 			moveData.waypointsVisited = [];
	// 		}
	// 		moveData.waypointsVisited.push(portalPos.name);
	//
	// 		return true; // done crossing portal
	// 	} else {
	// 		return false; // still trying to cross portal
	// 	}
	//
	// }

	// /**
	//  * Cross a portal that is within range 1 and then step off of the exit portal. Returns true when creep is on the
	//  * other side of the portal and no longer standing on a portal.
	//  */
	// private static crossPortal(creep: AnyZerg, portalPos: RoomPosition): boolean {
	// 	if (Game.map.getRoomLinearDistance(creep.pos.roomName, portalPos.roomName) > 5) {
	// 		// if you're on the other side of the portal
	// 		const creepOnPortal = !!creep.pos.lookForStructure(STRUCTURE_PORTAL);
	// 		if (!creepOnPortal) {
	// 			return true;
	// 		} else {
	// 			creep.moveOffCurrentPos();
	// 			return false;
	// 		}
	// 		// console.log(agent.name + " waiting on other side");
	// 	} else {
	// 		if (creep.pos.getRangeTo(portalPos) > 1) {
	// 			log.error(`Movement.crossPortal() should only be called in range 1 of portal!`);
	// 		} else {
	// 			const dir = creep.pos.getDirectionTo(portalPos);
	// 			creep.move(dir);
	// 		}
	// 		// console.log(agent.name + " traveling to waypoint");
	// 		return false;
	// 	}
	// }

	private static getPushPriority(creep: AnyCreep | AnyZerg): number {
		if (!creep.memory) return MovePriorities.default;
		if (creep.memory._go && creep.memory._go.priority) {
			return creep.memory._go.priority;
		} else {
			if (isPowerZerg(creep)) {
				return MovePriorities.powerCreep;
			} else {
				return MovePriorities[creep.memory.role] || MovePriorities.default;
			}
		}
	}

	private static shouldPush(pusher: AnyCreep | AnyZerg, pushee: AnyCreep | AnyZerg): boolean {
		if (this.getPushPriority(pusher) < this.getPushPriority(pushee)) {
			// pushee less important than pusher
			return true;
		} else if (this.getPushPriority(pushee) == 0) {
			return false;
		} else {
			pushee = normalizeAnyZerg(pushee);
			if (isAnyZerg(pushee)) {
				if (isStandardZerg(pushee)) {
					// pushee is equal or more important than pusher
					if (pushee.task && pushee.task.isWorking) {
						// If creep is doing a task, only push out of way if it can go somewhere else in range
						const targetPos = pushee.task.targetPos;
						const targetRange = pushee.task.settings.targetRange;
						return roomPositionAvailableNeighbors(pushee.pos).concat(pusher.pos).filter(
										pos => pos.getRangeTo(targetPos) <= targetRange).length > 0;
					} else if (!pushee.isMoving) {
						// push creeps out of the way if they're idling
						return true;
					}
				} else if (isPowerZerg(pushee)) {
					if (!pushee.isMoving) {
						// push creeps out of the way if they're idling
						return true;
					}
				}
			} else {
				return pushee.my;
			}
		}
		return false;
	}

	private static getPushDirection(pusher: AnyZerg | AnyCreep, pushee: AnyZerg | AnyCreep): DirectionConstant {
		const possiblePositions = roomPositionAvailableNeighbors(pushee.pos);
		pushee = normalizeAnyZerg(pushee);
		if (isStandardZerg(pushee)) {
			let preferredPositions: RoomPosition[] = [];
			if (pushee.task && pushee.task.isWorking) { // push creeps out of the way when they're doing task
				const targetPos = pushee.task.targetPos;
				const targetRange = pushee.task.settings.targetRange;
				preferredPositions = possiblePositions.filter(pos => pos.getRangeTo(targetPos) <= targetRange);
			}
			if (preferredPositions[0]) {
				return pushee.pos.getDirectionTo(preferredPositions[0]);
			}
		} else {
			log.debug(`${pushee.name}@${getRoomPositionPrint(pushee.pos)} is not Zerg! (Why?)`);
		}
		return pushee.pos.getDirectionTo(pusher);
	}

	private static findBlockingCreep(creep: AnyZerg): AnyCreep | undefined {
		const nextDir = Pathing.nextDirectionInPath(creep);
		if (nextDir == undefined) return;

		const nextPos = Pathing.positionAtDirection(creep.pos, nextDir);
		if (!nextPos) return;

		return nextPos.lookFor(LOOK_CREEPS)[0];
	}

	/* Push a blocking creep out of the way */
	static pushCreep(creep: AnyZerg, otherCreep: AnyCreep | AnyZerg): boolean {
		if (!otherCreep.memory) return false;
		otherCreep = normalizeAnyZerg(otherCreep);
		const pushDirection = this.getPushDirection(creep, otherCreep);
		const otherData = otherCreep.memory._go as MoveData | undefined;

		// Push the creep and update the state
		const outcome = otherCreep.move(pushDirection);
		const otherNextPos = roomPositionGetPositionAtDirection(otherCreep.pos, pushDirection);
		if (isStandardZerg(otherCreep)) {
			if (outcome == OK) {
				if (otherData && otherData.path && !otherCreep.blockMovement) { // don't add to path unless you moved
					otherData.path = Pathing.oppositeDirection(pushDirection) + otherData.path;
					this.updateStateNextCoord(otherData, otherNextPos);
				}
				otherCreep.blockMovement = true; // TODO: <-- movement bug? what if cmds are procesed in wrong order?
				return true;
			} else {
				return false;
			}
		} else {
			// Shouldn't reach here ideally
			log.warning(`${otherCreep.name}@${getRoomPositionPrint(otherCreep.pos)} is not Zerg! (Why?)`);
			if (outcome == OK) {
				if (otherData && otherData.path) {
					otherData.path = Pathing.oppositeDirection(pushDirection) + otherData.path;
					this.updateStateNextCoord(otherData, otherNextPos);
				}
				return true;
			} else {
				return false;
			}
		}
	}


	// TODO: this is bugged somewhere
	/**
	 * Recursively moves creeps out of the way of a position to make room for something, such as a spawning creep.
	 * If suicide is specified and there is no series of move commands that can move a block of creeps out of the way,
	 * the lead blocking creep will suicide. Returns whether the position has been vacated.
	 */
	static vacatePos(pos: RoomPosition, suicide = false): boolean {
		// prevent creeps from moving onto pos
		const nearbyCreeps = compactMap(pos.findInRange(FIND_MY_CREEPS, 2), creep => Overmind.zerg[creep.name]) as Zerg[];
		nearbyCreeps.forEach(creep => creep.blockMovement = true);
		// recurively move creeps off of the position
		const creep = pos.lookFor(LOOK_CREEPS)[0];
		if (!creep) return true;
		const blockingCreep = Overmind.zerg[creep.name];
		if (!blockingCreep) return true;
		const moved = !!this.recursivePush(blockingCreep);
		if (moved) {
			log.debug(`Moved creep ${blockingCreep.name} off of ${getRoomPositionPrint(blockingCreep.pos)}.`);
			return true;
		} else {
			if (suicide) {
				log.debug(`Could not move creep ${blockingCreep.name} off of ${getRoomPositionPrint(blockingCreep.pos)}! ` +
						  `Suiciding creep! (RIP)`);
				blockingCreep.suicide();
				return true;
			} else {
				log.debug(`Could not move creep ${blockingCreep.name} off of ${getRoomPositionPrint(blockingCreep.pos)}!`);
				return false;
			}
		}
	}

	/**
	 * Recursively pushes creeps out of the way of a root position.
	 */
	static recursivePush(creep: Zerg, excludePos: RoomPosition[] = []): RoomPosition | undefined {
		const creepPos = creep.pos;
		let movePos: RoomPosition | undefined = roomPositionAvailableNeighbors(creepPos).find(
													   neighbor => !excludePos.some(pos => pos.isEqualTo(neighbor)));
		if (movePos) {
			log.debug(`Moving ${creep.name} to ${JSON.stringify(movePos)}`);
			this.goTo(creep, movePos, {force: true});
			creep.blockMovement = true;
			return creepPos;
		} else { // Every position is occupied by a creep
			const availablePositions = roomPositionAvailableNeighbors(creepPos, true).filter(
												neighbor => !excludePos.some(pos => pos.isEqualTo(neighbor)));
			for (const otherPos of availablePositions) {
				const otherCreep = otherPos.lookFor(LOOK_CREEPS)[0];
				if (!otherCreep) continue;
				const otherZerg = Overmind.zerg[otherCreep.name];
				if (!otherZerg) continue;
				movePos = this.recursivePush(otherZerg, excludePos.concat(creepPos));
				if (movePos) {
					this.goTo(creep, movePos, {range: 0, force: true});
					creep.blockMovement = true;
					return creepPos;
				}
			}
		}
	}

	/**
	 * Travel to a room
	 */
	static goToRoom(creep: AnyZerg, roomName: string, options: MoveOptions = {}): number {
		options.range = 20;
		return this.goTo(creep, new RoomPosition(25, 25, roomName), options);
	}

	/**
	 * Travel to a room
	 */
	static goToRoom_swarm(swarm: Swarm, roomName: string, options: SwarmMoveOptions = {}): number {
		options.range = 24 - Math.max(swarm.width, swarm.height);
		return this.swarmMove(swarm, new RoomPosition(25, 25, roomName), options);
	}

	/**
	 * Park a creep off-roads
	 */
	static park(creep: AnyZerg, pos: RoomPosition = creep.pos, maintainDistance = false): number {
		const road = roomPositionLookForStructure(creep.pos, STRUCTURE_ROAD);
		if (!road) return OK;

		// Move out of the bunker if you're in it
		if (!maintainDistance && creep.colony && creep.colony.bunker && insideBunkerBounds(creep.pos, creep.colony)) {
			return this.goTo(creep, creep.colony.controller.pos);
		}

		let positions = sortBy(roomPositionAvailableNeighbors(creep.pos), p => p.getRangeTo(pos));
		if (maintainDistance) {
			const currentRange = creep.pos.getRangeTo(pos);
			positions = positions.filter(p => p.getRangeTo(pos) <= currentRange);
		}

		let swampPosition;
		for (const position of positions) {
			if (roomPositionLookForStructure(position, STRUCTURE_ROAD)) continue;
			const terrain = position.lookFor(LOOK_TERRAIN)[0];
			if (terrain === 'swamp') {
				swampPosition = position;
			} else {
				return creep.move(creep.pos.getDirectionTo(position));
			}
		}

		if (swampPosition) {
			return creep.move(creep.pos.getDirectionTo(swampPosition));
		}

		return this.goTo(creep, pos);
	}

	/**
	 * Moves a creep off of the current tile to the first available neighbor
	 */
	static moveOffCurrentPos(creep: AnyZerg): number | undefined {
		const destinationPos = roomPositionAvailableNeighbors(creep.pos)[0];
		if (destinationPos) {
			const direction = creep.pos.getDirectionTo(destinationPos);
			return creep.move(direction);
		} else {
			log.debug(`${creep.print} can't move off current pos!`);
		}
	}

	/**
	 * Moves onto an exit tile
	 */
	static moveOnExit(creep: AnyZerg): ScreepsReturnCode | undefined {
		if (getRoomPositionRangeToEdge(creep.pos) > 0) {
			if (isStandardZerg(creep) && creep.fatigue > 0) {
				return;
			}
			const directions = [1, 3, 5, 7, 2, 4, 6, 8] as DirectionConstant[];
			for (const direction of directions) {
				const position = roomPositionGetPositionAtDirection(creep.pos, direction);
				const terrain = position.lookFor(LOOK_TERRAIN)[0];
				if (terrain != 'wall' && getRoomPositionRangeToEdge(position) == 0) {
					const outcome = creep.move(direction);
					return outcome;
				}
			}
			log.warning(`moveOnExit() assumes nearby exit tile, position: ${creep.pos}`);
			return ERR_NO_PATH;
		}
	}

	/**
	 * Moves off of an exit tile
	 */
	static moveOffExit(creep: AnyZerg, towardPos?: RoomPosition, avoidSwamp = true): ScreepsReturnCode | NO_ACTION {
		if (!isPositionOnEdge(creep.pos)) {
			return NO_ACTION;
		}
		const terrain = creep.room.getTerrain();
		const pos = minBy(getRoomPositionNeighbors(creep.pos), pos => {
			if (isPositionOnEdge(pos) || !roomPositionIsWalkable(pos)) {
				return false;
			}
			let penalty = 0;
			if (avoidSwamp && terrain.get(pos.x, pos.y) == TERRAIN_MASK_SWAMP) {
				penalty += 10;
			}
			if (towardPos) {
				penalty += pos.getRangeTo(towardPos);
			}
			return penalty;
		});
		if (pos) {
			const direction = creep.pos.getDirectionTo(pos);
			creep.debug(`moving off exit toward ${getRoomPositionPrint(pos)}, direction ${direction}`);
			return creep.move(direction);
		} else {
			log.warning(`${creep.print}: cannot move off exit!`);
			return ERR_NO_PATH;
		}
	}

	/**
	 * Moves a pair of creeps; the follower will always attempt to be in the last position of the leader
	 */
	static pairwiseMove(leader: AnyZerg, follower: AnyZerg, target: HasPos | RoomPosition,
						opts = {} as MoveOptions, allowedRange = 1): number | undefined {
		let outcome;
		if (leader.room != follower.room) {
			if (getRoomPositionRangeToEdge(leader.pos) == 0) {
				// Leader should move off of exit tiles while waiting for follower
				outcome = leader.goTo(target, opts);
			}
			follower.goTo(leader);
			return outcome;
		}

		const range = leader.pos.getRangeTo(follower);
		if (range > allowedRange) {
			// If leader is farther than max allowed range, allow follower to catch up
			if (isPositionOnEdge(follower.pos) && follower.room == leader.room) {
				const goToPos = roomPositionAvailableNeighbors(follower.pos).find(pos => pos.isNearTo(leader));
				if (goToPos) {
					follower.goTo(goToPos);
				} else {
					follower.goTo(leader, {pathOpts: {blockCreeps:true}});
				}
			} else {
				follower.goTo(leader, {stuckValue: 1});
			}
		} else if (isStandardZerg(follower) && follower.fatigue == 0) {
			// Leader should move if follower can also move this tick
			outcome = leader.goTo(target, opts);
			if (range == 1) {
				follower.move(follower.pos.getDirectionTo(leader));
			} else {
				follower.goTo(leader, {stuckValue: 1});
			}
		}
		return outcome;
	}

	/**
	 * Moves a swarm to a destination, accounting for group pathfinding
	 */
	static swarmMove(swarm: Swarm, destination: HasPos | RoomPosition, opts: SwarmMoveOptions = {}): number {

		if (swarm.fatigue > 0) {
			Movement.circle(swarm.anchor, 'aqua', .3);
			console.log('tired');
			return ERR_TIRED;
		}

		// Set default options
		defaults(opts, {
			range      : 1, // Math.max(swarm.width, swarm.height),
			blockCreeps: false,
			exitCost   : 10,
		});

		// if (options.range! < Math.max(swarm.width, swarm.height)) {
		// 	log.warning(`Range specified is ${options.range}; not allowable for ${swarm.width}x${swarm.height} swarm!`);
		// }

		destination = normalizePos(destination);

		// initialize data object
		if (!swarm.memory._go) {
			swarm.memory._go = {} as MoveData;
		}
		const moveData = swarm.memory._go as MoveData;

		// manage case where creep is nearby destination
		if (opts.range != undefined && swarm.minRangeTo(destination) <= opts.range &&
			swarm.maxRangeTo(destination) <= opts.range + Math.max(swarm.width, swarm.height)) {
			delete swarm.memory._go;
			console.log('no action');
			return NO_ACTION;
		}

		const state = this.deserializeState(moveData, destination);

		// check if swarm is stuck
		let stuck = false;
		if (state.lastCoord !== undefined) {
			if (sameCoord(swarm.anchor, state.lastCoord)) { // didn't move
				stuck = true;
			} else if (isExit(swarm.anchor) && isExit(state.lastCoord)) { // moved against exit
				stuck = true;
			}
		}
		if (stuck) {
			state.stuckCount++;
			this.circle(swarm.anchor, 'magenta', state.stuckCount * .3);
		} else {
			state.stuckCount = 0;
		}

		// handle case where creep is stuck
		if (!opts.stuckValue) {
			opts.stuckValue = DEFAULT_STUCK_VALUE;
		}
		if (state.stuckCount >= opts.stuckValue && Math.random() > .5) {
			opts.blockCreeps = true;
			delete moveData.path;
		}

		// delete path cache if destination is different
		if (!destination.isEqualTo(state.destination)) {
			delete moveData.path;
		}

		if (opts.repathChance && Math.random() < opts.repathChance) {	// randomly repath with some probability
			delete moveData.path;
		}

		// pathfinding
		let newPath = false;
		if (!moveData.path) {
			newPath = true;
			state.destination = destination;
			const cpu = Game.cpu.getUsed();
			// (!) Pathfinding is done here
			const ret = Pathing.findSwarmPath(swarm.anchor, destination, swarm.width, swarm.height, opts);
			const cpuUsed = Game.cpu.getUsed() - cpu;
			state.cpu = Math.round(cpuUsed + state.cpu);
			if (Game.time % 10 == 0 && state.cpu > REPORT_SWARM_CPU_THRESHOLD) {
				log.alert(`Movement: heavy cpu use for swarm with ${swarm.creeps[0].print}, cpu: ${state.cpu}. ` +
						  `(${getRoomPositionPrint(swarm.anchor)} ${rightArrow} ${getRoomPositionPrint(destination)})`);
			}
			let color = 'orange';
			if (ret.incomplete) {
				log.debug(`Movement: incomplete path for swarm with ${swarm.creeps[0].print}! ` +
						  `(${getRoomPositionPrint(swarm.anchor)} ${rightArrow} ${getRoomPositionPrint(destination)})`);
				color = 'red';
			}
			this.circle(swarm.anchor, color);
			moveData.path = Pathing.serializePath(swarm.anchor, ret.path, color);
			state.stuckCount = 0;
		}

		// uncomment to visualize destination
		this.circle(destination, 'orange');

		// Serialize state for swarm
		moveData.state = [swarm.anchor.x, swarm.anchor.y, state.stuckCount, state.cpu, destination.x, destination.y,
						  destination.roomName];

		if (!moveData.path || moveData.path.length == 0) {
			console.log(`No path from ${getRoomPositionPrint(swarm.anchor)} to ${getRoomPositionPrint(destination)}!`);
			return ERR_NO_PATH;
		}

		// consume path
		if (state.stuckCount == 0 && !newPath) {
			moveData.path = moveData.path.substr(1);
		}
		const nextDirection = parseInt(moveData.path[0], 10) as DirectionConstant;

		return swarm.move(nextDirection);
	}

	private static combatMoveCallbackModifier(room: Room, matrix: CostMatrix,
											  approach: PathFinderGoal[], avoid: PathFinderGoal[],
											  options: CombatMoveOptions) {
		// This is only applied once creep is in the target room
		if (!options.allowExit) {
			MatrixLib.blockExits(matrix);
		}
		// Add penalties for things you want to avoid
		avoid.forEach(avoidThis => {
			let cost: number;
			let x, y: number;
			for (let dx = -avoidThis.range; dx <= avoidThis.range; dx++) {
				for (let dy = -avoidThis.range; dy <= avoidThis.range; dy++) {
					x = avoidThis.pos.x + dx;
					y = avoidThis.pos.y + dy;
					cost = matrix.get(x, y);
					if (cost < 0xff) {
						cost = Math.min(cost + options.avoidPenalty!, 0xfe);
						matrix.set(x, y, cost);
					}
				}
			}
		});
		// Add bonuses for things you want to approach
		approach.forEach(approachThis => {
			let cost: number;
			let x, y: number;
			for (let dx = -approachThis.range; dx <= approachThis.range; dx++) {
				for (let dy = -approachThis.range; dy <= approachThis.range; dy++) {
					x = approachThis.pos.x + dx;
					y = approachThis.pos.y + dy;
					cost = matrix.get(x, y);
					if (cost < 0xff) { // is walkable
						cost = Math.max(cost - options.approachBonus!, 1);
						matrix.set(x, y, cost);
					}
				}
			}
		});
		// Prefer to path into open ramparts
		if (options.preferRamparts) {
			MatrixLib.setWalkableRampartCostToOne(matrix, room);
		}
		return matrix;
	}


	static swarmCombatMove(swarm: Swarm, approach: PathFinderGoal[], avoid: PathFinderGoal[],
						   options: CombatMoveOptions = {}): number {
		defaults(options, {
			allowExit     : false,
			avoidPenalty  : 10,
			approachBonus : 5,
			preferRamparts: true,
			blockMyCreeps : true, // todo: is this necessary?
		});

		const debug = false;
		const callback = (roomName: string) => {
			const room = swarm.roomsByName[roomName];
			const matrixOpts: Partial<MatrixOptions> = {
				explicitTerrainCosts: true,
				swarmWidth          : swarm.width,
				swarmHeight         : swarm.height,
				blockExits          : !options.allowExit, // todo: maybe refactor allowExit => blockExits
			};
			let matrix = MatrixLib.getMatrix(roomName, matrixOpts).clone();
			if (room) {
				matrix = matrix.clone();
				if (options.blockMyCreeps) {
					const otherCreeps = getRoomCreeps(room).filter(creep => !swarm.creeps.some(c => c.name == creep.name));
					MatrixLib.blockAfterMaxPooling(matrix, otherCreeps, swarm.width, swarm.height);
				}
				// Pathing.blockHostileCreeps(matrix, creep.room);
				Movement.combatMoveCallbackModifier(room, matrix, approach, avoid, options);
				// TODO: ^ needs to take swarm size into account
			}
			if (options.displayCostMatrix) {
				Visualizer.displayCostMatrix(matrix, roomName);
			}
			return matrix;
		};

		let outcome: number = NO_ACTION;

		// Flee from bad things that that you're too close to
		if (avoid.length > 0) {
			const size = Math.max(swarm.width, swarm.height);
			if (avoid.some(goal => swarm.minRangeTo(goal) <= goal.range)) {
				const allAvoid = flatten(avoid.map(goal =>
					Pathing.getPosWindow(goal.pos, -swarm.width, -swarm.height).map(pos => ({
						pos  : pos,
						range: goal.range
					})))) as PathFinderGoal[];
				if (options.displayAvoid) {
					const room = swarm.rooms[0];
					for (const avoid of allAvoid) {
						const {x, y} = avoid.pos;
						room.visual.text(avoid.range.toString(), x, y, {color: 'ff0099'});
					}
				}
				const avoidRet = PathFinder.search(swarm.anchor, allAvoid, {
					roomCallback: callback,
					flee        : true,
					maxRooms    : options.allowExit ? 5 : 1,
					plainCost   : 2,
					swampCost   : 10,
				});
				if (avoidRet.path.length > 0) {
					if (debug) Pathing.serializePath(swarm.anchor, avoidRet.path, 'magenta');
					outcome = swarm.move(swarm.anchor.getDirectionTo(avoidRet.path[0]));
					if (outcome == OK) {
						return outcome;
					}
				}
			}
		}

		// Approach things you want to go to if you're out of range of all the baddies
		if (approach.length > 0) {
			if (!approach.some(goal => swarm.minRangeTo(goal) <= goal.range)) {
				const allApproach = flatten(approach.map(goal =>
					Pathing.getPosWindow(goal.pos, -swarm.width, -swarm.height).map(pos => ({
						pos  : pos,
						range: goal.range
					})))) as PathFinderGoal[];
				const approachRet = PathFinder.search(swarm.anchor, allApproach, {
					roomCallback: callback,
					maxRooms    : 1,
					plainCost   : 2,
					swampCost   : 10,
				});
				if (approachRet.path.length > 0) {
					if (debug) Pathing.serializePath(swarm.anchor, approachRet.path, 'cyan');
					outcome = swarm.move(swarm.anchor.getDirectionTo(approachRet.path[0]));
					if (outcome == OK) {
						return outcome;
					}
				}
			}
		}

		return outcome;
	}

	static combatMove(creep: Zerg, approach: PathFinderGoal[], avoid: PathFinderGoal[],
					  opts: CombatMoveOptions = {}): number {
		defaults(opts, {
			allowExit         : false,
			avoidPenalty      : 10,
			approachBonus     : 5,
			preferRamparts    : true,
			requireRamparts   : false,
			blockMyCreeps     : true, // TODO: is this necessary?
			blockHostileCreeps: false,
			blockAlliedCreeps : false,
		});

		const debug = false;
		const callback = (roomName: string) => {
			const matrixOpts: Partial<MatrixOptions> = {
				blockExits: !opts.allowExit, // todo: maybe refactor allowExit => blockExits
			};
			let matrix = MatrixLib.getMatrix(roomName, matrixOpts);
			if (roomName == creep.room.name) {
				matrix = matrix.clone();
				if (opts.blockMyCreeps) {
					MatrixLib.blockMyCreeps(matrix, creep.room);
				} // TODO: is this necessary?
				if (opts.blockHostileCreeps) {
					MatrixLib.blockHostileCreeps(matrix, creep.room);
				}
				if (opts.blockAlliedCreeps) {
					MatrixLib.blockAlliedCreeps(matrix, creep.room);
				}
				if (opts.preferRamparts) {
					MatrixLib.setWalkableRampartCostToOne(matrix, creep.room);
				}
				if (opts.requireRamparts) {
					MatrixLib.blockNonRamparts(matrix, creep.room);
				}
				Movement.combatMoveCallbackModifier(creep.room, matrix, approach, avoid, opts);
				if (opts.displayCostMatrix) {
					Visualizer.displayCostMatrix(matrix, roomName);
				}
				return matrix;
			} else {
				if (Memory.rooms[roomName] && Memory.rooms[roomName][RMEM.AVOID]) return false;
				return matrix;
			}
		};

		let outcome: number = NO_ACTION;

		// Flee from bad things that that you're too close to
		if (avoid.length > 0) {
			if (avoid.some(goal => roomPositionInRangeToXY(creep.pos, goal.pos.x, goal.pos.y, goal.range))
				&& !creep.inRampart) {
				const avoidRet = PathFinder.search(creep.pos, avoid, {
					roomCallback: callback,
					flee        : true,
					maxRooms    : opts.allowExit ? 5 : 1,
					plainCost   : 2,
					swampCost   : 10,
				});
				if (avoidRet.path.length > 0) {
					if (debug) Pathing.serializePath(creep.pos, avoidRet.path, 'magenta');
					outcome = creep.move(creep.pos.getDirectionTo(avoidRet.path[0]));
					if (outcome == OK) {
						return outcome;
					}
				}
			}
		}

		// Approach things you want to go to if you're out of range of all the baddies
		if (approach.length > 0) {
			if (!approach.some(goal => roomPositionInRangeToXY(creep.pos, goal.pos.x, goal.pos.y, goal.range))) {
				const approachRet = PathFinder.search(creep.pos, approach, {
					roomCallback: callback,
					maxRooms    : 1,
					plainCost   : 2,
					swampCost   : 10,
				});
				if (approachRet.path.length > 0) {
					if (debug) Pathing.serializePath(creep.pos, approachRet.path, 'cyan');
					outcome = creep.move(creep.pos.getDirectionTo(approachRet.path[0]));
					if (outcome == OK) {
						return outcome;
					}
				}
			}
		}

		// Try to maneuver under ramparts if possible
		if ((opts.preferRamparts || opts.requireRamparts) && !creep.inRampart && approach.length > 0) {
			const openRamparts = getRoomWalkableRamparts(creep.room).filter(
										  rampart => approach.some(
														   g => roomPositionInRangeToXY(rampart.pos, g.pos.x, g.pos.y, g.range))
													 && roomPositionIsWalkable(rampart.pos));
			if (openRamparts.length > 0) {
				const ret = PathFinder.search(creep.pos, openRamparts.map(r => ({pos: r.pos, range: 0})), {
					roomCallback: callback,
					maxRooms    : 1,
					plainCost   : 2,
					swampCost   : 10,
				});
				if (ret.path.length > 0) {
					if (debug) Pathing.serializePath(creep.pos, ret.path, 'green');
					outcome = creep.move(creep.pos.getDirectionTo(ret.path[0]));
					if (outcome == OK) {
						return outcome;
					}
				}
			}
		}

		return outcome;
	}


	private static invasionMoveCallbackModifier(room: Room, matrix: CostMatrix): CostMatrix {
		// This is only applied once creep is in the target room
		MatrixLib.blockExits(matrix);
		for (const hostile of getRoomInvaders(room)) {
			if (hostile.getActiveBodyparts(RANGED_ATTACK) > 1) {
				MatrixLib.setInRange(matrix, hostile, 3, 1, true);
			} else if (hostile.getActiveBodyparts(ATTACK) > 1) {
				MatrixLib.setInRange(matrix, hostile, 1, 1, true);
			}
		}
		for (const keeper of getRoomSourceKeepers(room)) {
			MatrixLib.setInRange(matrix, keeper, 3, 10, true);
		}
		for (const lair of getRoomKeeperLairs(room)) {
			if ((lair.ticksToSpawn || Infinity) < 25) {
				MatrixLib.setInRange(matrix, lair, 5, 5, true);
			}
		}
		return matrix;
	}

	/**
	 * Moving routine for guards or sourceReapers in a room with NPC invaders
	 */
	static invasionMove(creep: Zerg, destination: RoomPosition | HasPos, opts: MoveOptions = {}): number {
		defaults(opts, getDefaultMoveOptions());
		const dest = normalizePos(destination);
		if (creep.pos.getRangeTo(dest) > 8) {
			opts.repathChance = .1;
			opts.movingTarget = true;
		}
		if (creep.room.name == dest.roomName) {
			defaults(opts.pathOpts!, {
				maxRooms          : 1,
				modifyRoomCallback: Movement.invasionMoveCallbackModifier,
			});
		}
		return creep.goTo(dest, opts);
	}

	/**
	 * Kite around enemies in a single room, repathing every tick. More expensive than flee().
	 */
	static kite(creep: AnyZerg, avoidGoals: (RoomPosition | HasPos)[], options: MoveOptions = {}): number | undefined {
		defaults(options, {
			fleeRange   : 5,
			terrainCosts: isPowerZerg(creep) ? {plainCost: 1, swampCost: 1} : getTerrainCosts((<Creep>creep.creep)),
		});
		const nextPos = Pathing.findKitingPath(creep.pos, avoidGoals, options.pathOpts || {}).path[0];
		if (nextPos) {
			return creep.move(creep.pos.getDirectionTo(nextPos));
		}
	}

	/**
	 * Flee from avoid goals in the room while not re-pathing every tick like kite() does.
	 */
	static flee(creep: AnyZerg, avoidGoals: (RoomPosition | HasPos)[],
				dropEnergy = false, opts: MoveOptions = {}): number | undefined {

		if (avoidGoals.length == 0) {
			return; // nothing to flee from
		}
		const terrainCosts = isPowerZerg(creep) ? {plainCost: 1, swampCost: 1} : getTerrainCosts((<Creep>creep.creep));
		const fleeDefaultOpts: MoveOptions = {pathOpts: {terrainCosts: terrainCosts}};
		defaults(opts, fleeDefaultOpts);

		const fleeRange = opts.fleeRange || (terrainCosts.plainCost > 1 ? 8 : 16);
		if (opts.fleeRange == undefined) {
			opts.fleeRange = fleeRange;
			opts.pathOpts!.fleeRange = fleeRange;
		}

		const closest = creep.pos.findClosestByRange(avoidGoals);
		const rangeToClosest = closest ? creep.pos.getRangeTo(closest) : 50;

		if (rangeToClosest > opts.fleeRange) { // Out of range of baddies

			if (!creep.memory._go) {
				return;
			}

			if (isPositionOnEdge(creep.pos)) {
				return creep.moveOffExit();
			}

			// wait until safe
			const moveData = creep.memory._go as MoveData;
			if (moveData.fleeWait != undefined) {
				if (moveData.fleeWait <= 0) {
					// you're safe now
					delete creep.memory._go;
					return;
				} else {
					moveData.fleeWait--;
					return NO_ACTION;
				}
			} else {
				// you're safe
				return;
			}

		} else { // Still need to run away

			// initialize data object
			if (!creep.memory._go) {
				creep.memory._go = {} as MoveData;
			}
			const moveData = creep.memory._go as MoveData;

			moveData.fleeWait = 2;

			// Invalidate path if needed
			if (moveData.path) {
				if (moveData.path.length > 0) {
					const nextDirection = parseInt(moveData.path[0], 10) as DirectionConstant;
					const pos = roomPositionGetPositionAtDirection(creep.pos, nextDirection);
					if (!isPositionOnEdge(pos)) {
						const newClosest = pos.findClosestByRange(avoidGoals);
						if (newClosest && normalizePos(newClosest).getRangeTo(pos) < rangeToClosest) {
							delete moveData.path;
						}
					}
				} else {
					delete moveData.path;
				}
			}

			// Re-calculate path if needed
			if (!moveData.path || !moveData.destination) {
				const ret = Pathing.findFleePath(creep.pos, avoidGoals, opts.pathOpts || {});
				if (ret.path.length == 0) {
					return NO_ACTION;
				}
				moveData.destination = last(ret.path);
				moveData.path = Pathing.serializePath(creep.pos, ret.path, 'purple');
			}

			// Call goTo to the final position in path
			return Movement.goTo(creep, derefRoomPosition(moveData.destination), opts);
		}
	}


	private static deserializeState(moveData: MoveData, destination: RoomPosition): MoveState {
		const state = {} as MoveState;
		if (moveData.state) {
			state.lastCoord = {x: moveData.state[STATE_PREV_X], y: moveData.state[STATE_PREV_Y]};
			state.cpu = moveData.state[STATE_CPU];
			state.stuckCount = moveData.state[STATE_STUCK];
			state.destination = new RoomPosition(moveData.state[STATE_DEST_X], moveData.state[STATE_DEST_Y],
												 moveData.state[STATE_DEST_ROOMNAME]);
			if (moveData.state[STATE_CURRENT_X] && moveData.state[STATE_CURRENT_Y]) {
				state.currentXY = {x: moveData.state[STATE_CURRENT_X], y: moveData.state[STATE_CURRENT_Y]};
			}
		} else {
			state.cpu = 0;
			state.destination = destination;
		}
		return state;
	}

	private static serializeState(creep: AnyZerg, destination: RoomPosition, state: MoveState, moveData: MoveData,
								  nextCoord?: Coord | RoomPosition | undefined) {
		if (nextCoord) {
			moveData.state = [creep.pos.x, creep.pos.y, state.stuckCount, state.cpu, destination.x, destination.y,
							  destination.roomName, nextCoord.x, nextCoord.y];
		} else {
			moveData.state = [creep.pos.x, creep.pos.y, state.stuckCount, state.cpu, destination.x, destination.y,
							  destination.roomName];
		}
	}

	/**
	 * Update the currentXY property for a move state
	 */
	private static updateStateNextCoord(moveData: MoveData, nextCoord: Coord | RoomPosition) {
		if (moveData.state) {
			if (moveData.state[STATE_CURRENT_X] != undefined && moveData.state[STATE_CURRENT_Y] != undefined) {
				moveData.state[STATE_CURRENT_X] = nextCoord.x;
				moveData.state[STATE_CURRENT_Y] = nextCoord.y;
			} else if (moveData.state.length == STATE_CURRENT_X) {
				moveData.state.push(nextCoord.x);
				moveData.state.push(nextCoord.y);
			} else {
				// Shouldn't ever reach here
				log.warning(`Invalid moveData.state length!`);
			}
		}
	}

	private static isStuck(creep: AnyZerg, state: MoveState): boolean {
		let stuck = false;
		if (state.lastCoord !== undefined) {
			if (sameCoord(creep.pos, state.lastCoord)) { // didn't move
				stuck = true;
			} else if (isExit(creep.pos) && isExit(state.lastCoord)) { // moved against exit
				stuck = true;
			}
		}
		return stuck;
	}

	/**
	 * Draw a circle
	 */
	private static circle(pos: RoomPosition, color: string, opacity?: number): RoomVisual {
		return new RoomVisual(pos.roomName).circle(pos, {
			radius: .45, fill: 'transparent', stroke: color, strokeWidth: .15, opacity: opacity
		});
	}
}

// Creep.prototype.goTo = function (destination: RoomPosition | HasPos, options?: MoveOptions) {
// 	return Movement.goTo(this, destination, options);
// };

