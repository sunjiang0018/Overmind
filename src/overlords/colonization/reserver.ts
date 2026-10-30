import {isRoomMine} from '../../game/Room';
import {isPositionOnEdge, roomPositionAvailableNeighbors} from '../../game/RoomPosition';
import {
	isControllerReservedByMe,
	isControllerSignedByMe,
	isControllerSignedByScreeps,
	structureControllerNeedsReserving,
} from '../../game/Structures';
import {Roles, Setups} from '../../creepSetups/setups';
import {DirectiveOutpost} from '../../directives/colony/outpost';
import {RoomIntel} from '../../intel/RoomIntel';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {Tasks} from '../../tasks/Tasks';
import {Zerg} from '../../zerg/Zerg';
import {MY_USERNAME} from '../../~settings';
import {Overlord} from '../Overlord';

/**
 * Spawns reservers to reserve an outpost room
 */
@profile
export class ReservingOverlord extends Overlord {

	reservers: Zerg[];
	reserveBuffer: number;

	constructor(directive: DirectiveOutpost, priority = OverlordPriority.remoteRoom.reserve) {
		super(directive, 'reserve', priority);
		// Change priority to operate per-outpost
		this.priority += this.outpostIndex * OverlordPriority.remoteRoom.roomIncrement;
		this.reserveBuffer = 2000;
		this.reservers = this.zerg(Roles.claim);
	}

	init() {
		let amount = 0;
		if (this.room) {
			if (structureControllerNeedsReserving(this.room.controller!, this.reserveBuffer)) {
				amount = 1;
			} else if (this.room.controller!.reservation && !isControllerReservedByMe(this.room.controller!)) {
				amount = Math.min(roomPositionAvailableNeighbors(this.room.controller!.pos, true).length, 2);
			}
		} else if (RoomIntel.roomReservedBy(this.pos.roomName) == MY_USERNAME &&
				   RoomIntel.roomReservationRemaining(this.pos.roomName) < 1000) {
			amount = 1;
		}
		this.wishlist(amount, Setups.infestors.reserve);
	}

	private handleReserver(reserver: Zerg): void {
		if (reserver.avoidDanger()) return;
		if (reserver.room == this.room && !isPositionOnEdge(reserver.pos)) {
			// If reserver is in the room and not on exit tile
			if (!isControllerSignedByMe(this.room.controller!)) {
				// Takes care of an edge case where planned newbie zone signs prevents signing until room is reserved
				if (!isRoomMine(this.room) && isControllerSignedByScreeps(this.room.controller!)) {
					reserver.task = Tasks.reserve(this.room.controller!);
				} else {
					reserver.task = Tasks.signController(this.room.controller!);
				}
			} else {
				reserver.task = Tasks.reserve(this.room.controller!);
			}
		} else {
			// reserver.task = Tasks.goTo(this.pos);
			reserver.goTo(this.pos);
		}
	}

	run() {
		this.autoRun(this.reservers, reserver => this.handleReserver(reserver));
	}
}
