import {getRoomPositionNeighbors, roomPositionIsWalkable} from '../../game/RoomPosition';
import {getRoomSources} from '../../game/RoomStructures';
import {
	getRoomConstructionSites,
	getRoomDangerousHostiles,
	getRoomOwner,
	getRoomPlayerHostiles,
	isColonyRoom,
	isOutpostRoom,
} from '../../game/Room';
import {log} from '../../console/log';
import {ClaimingOverlord} from '../../overlords/colonization/claimer';
import {RoomPoisonerOverlord} from '../../overlords/colonization/roomPoisoner';
import {profile} from '../../profiler/decorator';
import {Cartographer, ROOMTYPE_CONTROLLER} from '../../utilities/Cartographer';
import {packPos} from '../../utilities/packrat';
import {MY_USERNAME} from '../../~settings';
import {DirectiveOutpostDefense} from '../defense/outpostDefense';
import {Directive} from '../Directive';
import {DirectiveControllerAttack} from '../offense/controllerAttack';
import {compact, uniqueBy, flatten} from '../../utilities/native';


/**
 * Poison sources in remote rooms by claiming controller, walling in its sources and controller then unclaiming it.
 */
@profile
export class DirectivePoisonRoom extends Directive {

	static directiveName = 'poisonRoom';
	static color = COLOR_PURPLE;
	static secondaryColor = COLOR_RED;
	static requiredRCL = 5;

	private blockPositions: RoomPosition[];

	overlords: {
		claim: ClaimingOverlord;
		roomPoisoner: RoomPoisonerOverlord;
	};

	static settings: {
		runFrequency: 12;
	};

	constructor(flag: Flag) {
		super(flag, colony => colony.level >= DirectivePoisonRoom.requiredRCL);
		// Remove if misplaced
		let remove = false;
		if (Cartographer.roomType(this.pos.roomName) != ROOMTYPE_CONTROLLER) {
			log.error(`${this.print}: not placed is not a controller room; removing directive!`);
			remove = true;
		}
		// failsafe - if already owned and controller level > 2, remove flag
		if (this.room && this.room.controller && this.room.controller.my && this.room.controller.level > 2) {
			log.error(`Removing ${this.print}: room owned by self and above RCL 2!`);
			remove = true;
		}
		// Remove if owned by other player
		if (this.room && getRoomOwner(this.room) && getRoomOwner(this.room) != MY_USERNAME) {
			log.error(`Removing poisonRoom directive in ${this.pos.roomName}: room already owned by another player.`);
			remove = true;
		}
		if (remove) {
			this.remove(true);
		}
	}

	spawnMoarOverlords() {
		this.overlords.claim = new ClaimingOverlord(this);
		this.overlords.roomPoisoner = new RoomPoisonerOverlord(this);
	}

	/**
	 * Returns whether the room has already been poisoned
	 */
	static roomAlreadyPoisoned(room: Room): boolean {
		const thingsToBlock = compact([room.controller, ...getRoomSources(room)]) as RoomObject[];
		const neighborTiles = uniqueBy(flatten(thingsToBlock.map(obj => getRoomPositionNeighbors(obj.pos))),
									   pos => packPos(pos));
		const blockPositions = neighborTiles.filter(pos => roomPositionIsWalkable(pos, true));
		return blockPositions.length == 0;
	}

	/**
	 * Returns whether you can poison a specific room; assumes that poisoning is enabled and that you can claim another
	 * room and can poison another room (these checks should be done once on Overseer)
	 */
	static canAutoPoison(room: Room, allowReserved = false): boolean {
		if (isColonyRoom(room) || isOutpostRoom(room)) {
			return false;
		}
		if (!room.controller) {
			return false;
		}
		if (allowReserved && room.controller.reservation) {
			return false;
		}
		if (getRoomDangerousHostiles(room).length > 0) {
			return false;
		}
		if (getRoomPositionNeighbors(room.controller.pos).filter(pos => roomPositionIsWalkable(pos, true)).length == 0) {
			return false;
		}
		return true;
	}


	init() {
		this.alert(`Poisoning room`);

		// Re-compute the list of positions to block
		if (this.room) {
			const thingsToBlock = compact([this.room.controller, ...getRoomSources(this.room)]) as RoomObject[];
			const neighborTiles = uniqueBy(flatten(thingsToBlock.map(obj => getRoomPositionNeighbors(obj.pos))),
										   pos => packPos(pos));
			this.blockPositions = neighborTiles.filter(pos => roomPositionIsWalkable(pos, true));
		} else {
			this.blockPositions = [];
		}
	}

	private prePoisonActions(): void {
		if (this.room && this.room.controller && this.room.controller.level != 1) {
			return; // failsafe to prevent you from accidentally killing your own room
		}
		if (this.room) {
			const removeStructures = this.room.find(FIND_STRUCTURES, {
				filter: (s: Structure) =>
					s.structureType != STRUCTURE_CONTROLLER &&
					s.structureType != STRUCTURE_STORAGE &&
					s.structureType != STRUCTURE_TERMINAL &&
					s.structureType != STRUCTURE_FACTORY &&
					s.structureType != STRUCTURE_LAB &&
					s.structureType != STRUCTURE_NUKER
			});
			removeStructures.forEach(s => s.destroy());
			this.room.find(FIND_HOSTILE_CONSTRUCTION_SITES).forEach(csite => csite.remove());
		}
	}

	private poisonActions(): void {
		if (!(this.room && this.room.controller && this.room.controller.level == 2)) {
			return;
		}
		const positionToBlock = this.blockPositions[0];
		if (!positionToBlock) {
			return; // all blocked off
		}
		// Don't lock off the last position unless there's a creep with energy to build the site
		const enoughEnergyToBuildFinalWall = this.overlords.roomPoisoner.roomPoisoners.some(
												   creep => creep.carry.energy >= BUILD_POWER);
		if (this.blockPositions.length == 1 && !enoughEnergyToBuildFinalWall) {
			return;
		}
		// Otherwise build one site at a time
		positionToBlock.createConstructionSite(STRUCTURE_WALL);
	}

	private clearRoom(): void {
		if (this.room) {
			const allStructures = this.room.find(FIND_STRUCTURES, {
				filter: (s: Structure) =>
					s.structureType != STRUCTURE_CONTROLLER &&
					s.structureType != STRUCTURE_STORAGE &&
					s.structureType != STRUCTURE_TERMINAL &&
					s.structureType != STRUCTURE_FACTORY &&
					s.structureType != STRUCTURE_LAB &&
					s.structureType != STRUCTURE_NUKER
			});
			allStructures.forEach(s => s.destroy());
		}
	}

	run() {

		if (this.room && this.room.controller && Game.time % DirectivePoisonRoom.settings.runFrequency == 0) {
			// Remove hostile reservation if needed
			if (this.room.controller.reservation && this.room.controller.reservation.ticksToEnd > 500) {
				DirectiveControllerAttack.createIfNotPresent(this.room.controller.pos, 'room');
			}
			// Send fighters if needed
			if (getRoomPlayerHostiles(this.room).length > 0) {
				DirectiveOutpostDefense.createIfNotPresent(this.room.controller.pos, 'room');
			}
		}

		if (this.room && this.room.controller && this.room.controller.my) {
			if (Game.time % DirectivePoisonRoom.settings.runFrequency == 0 || getRoomConstructionSites(this.room).length == 0) {
				// At RCL 1, prepare room by removing structures and hostile construction sites
				if (this.room.controller.level == 1) {
					this.prePoisonActions();
					return;
				}
				// At RCL 2, build walls to make the room useless
				if (this.room.controller.level == 2) {
					if (this.blockPositions.length > 0) {
						this.poisonActions();
					} else {
						this.room.controller.unclaim();
						log.notify(`Removing poisonRoom directive in ${this.pos.roomName}: operation completed.`);
						this.remove();
					}
				}
			}
		}
	}
}
