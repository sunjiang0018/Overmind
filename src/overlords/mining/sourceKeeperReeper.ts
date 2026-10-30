import {isCreepInRampart} from '../../game/Creep';
import {getRoomPositionPrint, isPositionOnEdge, roomPositionFindClosestByLimitedRange} from '../../game/RoomPosition';
import {getRoomHostiles, getRoomInvaders, getRoomSourceKeepers} from '../../game/Room';
import {getRoomKeeperLairs} from '../../game/RoomStructures';
import {debug, log} from '../../console/log';
import {CombatSetups, Roles} from '../../creepSetups/setups';
import {DirectiveSKOutpost} from '../../directives/colony/outpostSK';
import {RoomIntel} from '../../intel/RoomIntel';
import {Mem} from '../../memory/Memory';
import {Movement} from '../../movement/Movement';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {CombatTargeting} from '../../targeting/CombatTargeting';
import {minBy} from '../../utilities/utils';
import {Visualizer} from '../../visuals/Visualizer';
import {CombatZerg} from '../../zerg/CombatZerg';
import {CombatOverlord, CombatOverlordMemory} from '../CombatOverlord';

interface SourceReaperOverlordMemory extends CombatOverlordMemory {
	targetLairID?: string;
}

/**
 * SourceReaperOverlord -- spawns offensive creeps to allow source keeper mining
 */
@profile
export class SourceReaperOverlord extends CombatOverlord {

	static requiredRCL = 7;

	memory: SourceReaperOverlordMemory;
	targetLair: StructureKeeperLair | undefined;

	reapers: CombatZerg[];
	defenders: CombatZerg[];

	constructor(directive: DirectiveSKOutpost, priority = OverlordPriority.remoteSKRoom.sourceReaper) {
		super(directive, 'sourceReaper', priority, SourceReaperOverlord.requiredRCL);
		this.priority += this.outpostIndex * OverlordPriority.remoteSKRoom.roomIncrement;
		this.reapers = this.combatZerg(Roles.melee);
		this.defenders = this.combatZerg(Roles.ranged);
		this.memory = Mem.wrap(this.directive.memory, 'sourceReaper');
		this.computeTargetLair();
	}

	private computeTargetLair() {
		this.targetLair = this.memory.targetLairID ? <StructureKeeperLair>deref(this.memory.targetLairID) : undefined;
		if (!this.targetLair || (this.targetLair.ticksToSpawn || Infinity) >= 299) {
			if (this.room) {
				// If any lairs have an active keeper, target that
				const activeLair = getRoomKeeperLairs(this.room).find(
										  lair => lair.pos.findInRange(getRoomSourceKeepers(lair.room), 5).length > 0);
				if (activeLair) {
					this.targetLair = activeLair;
				} else {
					// Otherwise target whatever is closest to spawning
					this.targetLair = minBy(getRoomKeeperLairs(this.room), lair => lair.ticksToSpawn || Infinity);
				}
			}
		}
	}

	refresh() {
		super.refresh();
		this.computeTargetLair();
	}

	init() {
		const defenderAmount = this.room && (getRoomInvaders(this.room).length > 0
											 || RoomIntel.isInvasionLikely(this.room)) ? 1 : 0;
		this.wishlist(1, CombatSetups.zerglings.sourceKeeper);
		this.wishlist(defenderAmount, CombatSetups.hydralisks.sourceKeeper);
	}

	private handleReaper(reaper: CombatZerg) {

		const moveOpts: any = {pathOpts: {avoidSK: false}};

		// Go to keeper room
		if (!this.targetLair || !this.room || reaper.room != this.room || isPositionOnEdge(reaper.pos)) {
			// log.debugCreep(reaper, `Going to room!`);
			reaper.healSelfIfPossible();
			reaper.goTo(this.pos, moveOpts);
			return;
		}

		// Once you're safely in the room, block off the exits
		moveOpts.pathOpts.blockExits = true;

		const nonStrongholdInvaders = getRoomInvaders(this.room).filter(creep => !isCreepInRampart(creep));
		if (nonStrongholdInvaders.length > 0) {
			// Handle invader actions
			if (reaper.hits >= reaper.hitsMax * .5) {
				const result = reaper.autoMelee(getRoomInvaders(this.room));
				if (result == undefined) { // didn't attack
					reaper.autoHeal();
				}
			} else {
				reaper.healSelfIfPossible();
			}
			// Kite around ranged invaders until a defender arrives
			if (getRoomInvaders(this.room).length > 2 && this.defenders.filter(def => def.room == this.room).length == 0) {
				reaper.kite(getRoomHostiles(this.room).filter(h => h.getActiveBodyparts(RANGED_ATTACK) > 0), moveOpts);
				reaper.healSelfIfPossible();
			}
			// If defender is already here or a small invasion
			else {
				const target = CombatTargeting.findTarget(reaper, getRoomInvaders(this.room));
				if (target) {
					Movement.invasionMove(reaper, target);
				} else {
					log.warning(`KeeperReaper@${getRoomPositionPrint(reaper.pos)}: no invader target!`);
				}
			}
		} else {
			// Standard keeperReaper actions
			const nearestHostile = reaper.pos.findClosestByRange(getRoomHostiles(this.room)) as Creep;
			if (nearestHostile && reaper.pos.isNearTo(nearestHostile)) {
				reaper.attack(nearestHostile);
				reaper.move(reaper.pos.getDirectionTo(nearestHostile));
			} else {
				const keeper = roomPositionFindClosestByLimitedRange(this.targetLair.pos, getRoomSourceKeepers(this.room), 7);
				if (keeper) { // attack the source keeper
					// stop and heal at range 4 if needed
					const approachRange = (reaper.hits == reaper.hitsMax || reaper.pos.getRangeTo(keeper) <= 3) ? 1 : 4;
					reaper.goTo(keeper, {range: approachRange, pathOpts: moveOpts.pathOpts});
				} else { // travel to next lair
					reaper.goTo(this.targetLair, {range: 1, pathOpts: moveOpts.pathOpts});
				}
			}
			reaper.healSelfIfPossible();
		}

	}

	private handleDefender(defender: CombatZerg) {

		// Go to keeper room
		if (!this.targetLair || !this.room || defender.room != this.room || isPositionOnEdge(defender.pos)) {
			debug(defender, `Going to room!`);
			defender.healSelfIfPossible();
			defender.goToRoom(this.pos.roomName, {pathOpts: {avoidSK: false}});
			return;
		}

		if (getRoomInvaders(this.room).length > 0) {
			// Handle invader actions
			debug(defender, `AutoCombat`);
			defender.autoSkirmish(this.room.name);
		} else {
			debug(defender, `Standard duty`);
			const minKeepersToHelp = this.reapers.length == 0 ? 1 : 2;
			if (getRoomSourceKeepers(this.room).length >= minKeepersToHelp) {
				// Help out with keeper reaping
				defender.autoRanged();
				defender.autoHeal(false);

				const reaper = defender.pos.findClosestByRange(this.reapers);
				if (reaper) {
					defender.goTo(reaper, {
						movingTarget: defender.pos.getRangeTo(reaper) > 8,
						repathChance: 0.1,
						pathOpts    : {
							maxRooms  : 1,
							avoidSK   : false,
							blockExits: true,
						}
					});
				} else {
					const keeper = roomPositionFindClosestByLimitedRange(this.targetLair.pos, getRoomSourceKeepers(this.room), 7);
					if (keeper) { // attack the source keeper
						const range = defender.pos.getRangeTo(keeper);
						const keepAtRange = defender.hits < defender.hitsMax * .9 ? 4 : 3;
						if (range < keepAtRange) {
							defender.kite(getRoomHostiles(this.room), {
								range: keepAtRange, pathOpts: {
									avoidSK   : false,
									blockExits: true,
								}
							});
						} else if (range > keepAtRange) {
							defender.goTo(keeper, {
								range: keepAtRange, pathOpts: {
									avoidSK   : false,
									blockExits: true
								}
							});
						}
					} else { // travel to next lair
						defender.goTo(this.targetLair, {
							range: 5, pathOpts: {
								avoidSK   : false,
								blockExits: true
							}
						});
					}
				}
			} else {
				// Do medic actions
				debug(defender, `Medic actions`);
				defender.doMedicActions(this.room.name);
			}
		}

	}

	run() {
		this.autoRun(this.reapers, reaper => this.handleReaper(reaper));
		this.autoRun(this.defenders, defender => this.handleDefender(defender));
	}

	visuals() {
		if (this.room && this.targetLair) {
			Visualizer.marker(this.targetLair.pos);
		}
	}

}
