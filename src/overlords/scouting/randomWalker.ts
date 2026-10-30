import {roomPositionFindClosestByMultiRoomRange} from '../../game/RoomPosition';
import {getRoomWalls} from '../../game/RoomStructures';
import {Colony} from '../../Colony';
import {Roles, Setups} from '../../creepSetups/setups';
import {RoomIntel} from '../../intel/RoomIntel';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {Tasks} from '../../tasks/Tasks';
import {Zerg} from '../../zerg/Zerg';
import {Overlord} from '../Overlord';
import {RANDOM_SCOUT_COUNT} from '../../~settings';
import {sample} from '../../utilities/native';

/**
 * Sends out scouts which randomly traverse rooms to uncover possible expansion locations and gather intel
 */
@profile
export class RandomWalkerScoutOverlord extends Overlord {

	scouts: Zerg[];

	constructor(colony: Colony, priority = OverlordPriority.scouting.randomWalker) {
		super(colony, 'scout', priority);
		this.scouts = this.zerg(Roles.scout, {notifyWhenAttacked: false});
	}

	init() {
		this.wishlist(RANDOM_SCOUT_COUNT, Setups.scout);
	}

	private handleScout(scout: Zerg) {
		// // Stomp on enemy construction sites
		// const enemyConstructionSites = scout.room.find(FIND_HOSTILE_CONSTRUCTION_SITES);
		// if (enemyConstructionSites.length > 0 && enemyConstructionSites[0].pos.isWalkable(true)) {
		// 	scout.goTo(enemyConstructionSites[0].pos);
		// 	return;
		// }
		// Check if room might be connected to newbie/respawn zone
		const indestructibleWalls = getRoomWalls(scout.room).filter(wall => wall.hits == undefined);
		if (indestructibleWalls.length > 0) { // go back to origin colony if you find a room near newbie zone
			scout.task = Tasks.goToRoom(this.colony.room.name); // todo: make this more precise
		} else {
			// Pick a new room
			const neighboringRooms = Object.values(Game.map.describeExits(scout.pos.roomName) ?? {}) as string[];
			const roomName = sample(neighboringRooms);
			if (RoomIntel.isRoomAccessible(roomName)) {
				scout.task = Tasks.goToRoom(roomName);
			}
		}
	}

	run() {
		if (RANDOM_SCOUT_COUNT == 0) {
			for (const scout of this.scouts) {
				if (scout.spawning) continue;
				// Discard saved goToRoom tasks so retiring scouts cannot keep wandering.
				scout.task = null;
				const spawn = roomPositionFindClosestByMultiRoomRange(scout.pos, this.colony.spawns);
				if (!spawn) {
					scout.suicide();
				} else if (scout.pos.isNearTo(spawn)) {
					spawn.recycleCreep(scout.creep);
				} else {
					scout.goTo(spawn, {range: 1});
				}
			}
			return;
		}
		this.autoRun(this.scouts, scout => this.handleScout(scout));
	}
}
