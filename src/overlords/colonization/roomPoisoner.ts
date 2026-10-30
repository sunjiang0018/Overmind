import {getRoomConstructionSites, getRoomDangerousPlayerHostiles} from '../../game/Room';
import {getRoomPositionNeighbors, roomPositionIsWalkable} from '../../game/RoomPosition';
import {getRoomSources} from '../../game/RoomStructures';
import {Roles, Setups} from '../../creepSetups/setups';
import {DirectivePoisonRoom} from '../../directives/colony/poisonRoom';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {Tasks} from '../../tasks/Tasks';
import {packPos} from '../../utilities/packrat';
import {Zerg} from '../../zerg/Zerg';
import {Overlord} from '../Overlord';
import {compact, uniqueBy, flatten} from '../../utilities/native';


/**
 * Spawn roomPoisoner - upgrqde controller to lvl2, wall in controller then sources.
 */
@profile
export class RoomPoisonerOverlord extends Overlord {

	roomPoisoners: Zerg[];

	private blockPositions: RoomPosition[];

	static settings: {
		wallHits: 1;
	};

	constructor(directive: DirectivePoisonRoom, priority = OverlordPriority.outpostOffense.roomPoisoner) {
		super(directive, 'PoisonRoom', priority);
		this.roomPoisoners = this.zerg(Roles.roomPoisoner);
	}

	init() {
		// Re-compute the list of positions to block
		if (this.room) {
			const thingsToBlock = compact([this.room.controller, ...getRoomSources(this.room)]) as RoomObject[];
			const neighborTiles = uniqueBy(flatten(thingsToBlock.map(obj => getRoomPositionNeighbors(obj.pos))),
										   pos => packPos(pos));
			this.blockPositions = neighborTiles.filter(pos => roomPositionIsWalkable(pos, true));
		} else {
			this.blockPositions = [];
		}

		if (this.room && getRoomDangerousPlayerHostiles(this.room).length == 0) {
			this.wishlist(1, Setups.roomPoisoner);
		}
	}

	private handleRoomPoisoner(posioner: Zerg): void {
		// Recharge if needed
		if (posioner.carry.energy < BUILD_POWER) {
			posioner.task = Tasks.recharge();
			return;
		}
		// Go to Target Room
		if (!posioner.inSameRoomAs(this)) {
			posioner.goTo(this.pos, {pathOpts:{ensurePath: true, avoidSK: true}});
			return;
		}
		// If you're in the room
		if (this.room && this.room.controller && this.room.controller.my) {
			// Upgrade controller to level 2
			if (this.room.controller.level! < 2) {
				posioner.task = Tasks.upgrade(this.room.controller);
				return;
			}
			// Fortify any walls below threshold (can't used cached room.walls here)
			const wallsUncached = this.room.find(FIND_STRUCTURES,
												 {filter: {structureType: STRUCTURE_WALL}}) as StructureWall[];
			const fortifyTarget = wallsUncached.find(wall => wall.hits < RoomPoisonerOverlord.settings.wallHits);
			if (fortifyTarget) {
				posioner.task = Tasks.fortify(fortifyTarget, RoomPoisonerOverlord.settings.wallHits);
				return;
			}
			// Construct walls
			const wallConstructionSite = getRoomConstructionSites(this.room)[0];
			if (wallConstructionSite) {
				posioner.task = Tasks.build(wallConstructionSite);
				return;
			}
			// If nothing to do, then move away from possible construction site locations
			posioner.flee(this.blockPositions, {}, {fleeRange: 4});
		}
	}

	run() {
		this.autoRun(this.roomPoisoners, roomPoisoner => this.handleRoomPoisoner(roomPoisoner));
	}
}
