import {getRoomRechargeables, getRoomSources} from '../../game/RoomStructures';
import {
	roomPositionAvailableNeighbors,
	roomPositionFindClosestByMultiRoomRange,
	roomPositionGetMultiRoomRangeTo,
} from '../../game/RoomPosition';
import {getTargetedBy} from '../../game/RoomObject';
import {getStoredEnergy} from '../../game/Structures';
import {ColonyStage} from '../../Colony';
import {log} from '../../console/log';
import {isResource} from '../../declarations/typeGuards';
import {profile} from '../../profiler/decorator';
import {maxBy, minMax} from '../../utilities/utils';
import {Zerg} from '../../zerg/Zerg';
import {Task} from '../Task';
import {TaskHarvest} from './harvest';
import {pickupTaskName, TaskPickup} from './pickup';
import {TaskWithdraw, withdrawTaskName} from './withdraw';
import {sum, compactMap} from '../../utilities/native';

export type rechargeTargetType = HasRef & HasPos;  // This is handled better in the Tasks.recharge() dispatcher
// export type rechargeTargetType = null;
export const rechargeTaskName = 'recharge';

// This is a "dispenser task" which is not itself a valid task, but dispenses a task when assigned to a creep.

@profile
export class TaskRecharge extends Task<rechargeTargetType> {

	data: {
		minEnergy: number;
	};

	constructor(minEnergy = 0, options = {} as TaskOptions) {
		super(rechargeTaskName, {ref: '', pos: {x: -1, y: -1, roomName: ''}}, options);
		this.data.minEnergy = minEnergy;
	}

	private rechargeRateForCreep(creep: Zerg, obj: rechargeObjectType): number | false {
		if (creep.colony && creep.colony.hatchery && creep.colony.hatchery.batteries.length > 0
			&& creep.roleName != 'queen') {
			if (creep.colony.stage == ColonyStage.Larva) {
				const MINIMUM_BATTERY_THRESHOLD = 1500;
				if (creep.colony.hatchery.batteries.some(
						  battery => battery.id == obj.id && getStoredEnergy(battery) < MINIMUM_BATTERY_THRESHOLD)) {
					return false; // at low levels allow others to use hatchery battery if it is almost full
				}
			} else {
				if (creep.colony.hatchery.batteries.some(battery => battery.id == obj.id)) {
					return false; // only queens can use the hatchery batteries
				}
			}
		}

		// Don't allow workers to withdraw from mining containers at lower levels
		if (creep.colony && creep.colony.stage == ColonyStage.Larva && creep.roleName == 'worker') {
			const miningSiteContainers = compactMap(Object.values(creep.colony.miningSites),
												site => site.overlords.mine.container) as StructureContainer[];
			// if this is a mining site container, don't let creeps withdraw from it unless it is sort of full
			const CONTAINER_THRESHOLD = 1000;
			if (miningSiteContainers.some((c: StructureContainer) => c.id == obj.id && getStoredEnergy(c) < CONTAINER_THRESHOLD)) {
				return false;
			}
		}

		let amount = isResource(obj) ? obj.amount : obj.store[RESOURCE_ENERGY];
		if (amount < this.data.minEnergy) {
			return false;
		}

		// TODO: generalize this into a getPredictedStore function which includes all targeting creeps
		const otherTargeters = (getTargetedBy(obj) || []).map(name => Overmind.zerg[name]).filter(
										zerg => !!zerg && zerg.task
												&& (zerg.task.name == withdrawTaskName || zerg.task.name == pickupTaskName));

		const resourceOutflux = sum(otherTargeters, other => other.store.getFreeCapacity());
		amount = minMax(amount - resourceOutflux, 0, creep.carryCapacity);
		const effectiveAmount = amount / (roomPositionGetMultiRoomRangeTo(creep.pos, obj.pos) + 1);
		if (effectiveAmount <= 0) {
			return false;
		} else {
			return effectiveAmount;
		}
	}

	// Override creep setter to dispense a valid recharge task
	set creep(creep: Zerg) {
		this._creep.name = creep.name;
		if (this._parent) {
			this.parent!.creep = creep;
		}
		// Choose the target to maximize your energy gain subject to other targeting workers
		const possibleTargets = creep.colony && creep.inColonyRoom ? creep.colony.rechargeables
																   : getRoomRechargeables(creep.room);

		const target = maxBy(possibleTargets, o => this.rechargeRateForCreep(creep, o));
		if (!target || roomPositionGetMultiRoomRangeTo(creep.pos, target.pos) > 40) {
			// workers shouldn't harvest; let drones do it (disabling this check can destabilize early economy)
			const canHarvest = creep.getActiveBodyparts(WORK) > 0 && creep.roleName != 'worker';
			if (canHarvest) {
				// Harvest from a source if there is no recharge target available
				const availableSources = getRoomSources(creep.room).filter(function(source) {
					const filledSource = source.energy > 0 || source.ticksToRegeneration < 20;
					// Only harvest from sources which aren't surrounded by creeps excluding yourself
					const isSurrounded = roomPositionAvailableNeighbors(source.pos, false).length == 0;
					return filledSource && (!isSurrounded || creep.pos.isNearTo(source));
				});
				const availableSource = roomPositionFindClosestByMultiRoomRange(creep.pos, availableSources);
				if (availableSource) {
					creep.task = new TaskHarvest(availableSource);
					return;
				}
			}
		}
		if (target) {
			// log.debug(`target: ${target}`);
			if (isResource(target)) {
				creep.task = new TaskPickup(target);
				return;
			} else {
				creep.task = new TaskWithdraw(target);
				return;
			}
		} else {
			// if (creep.roleName == 'queen') {
			log.debug(`No valid withdraw target for ${creep.print}!`);
			// }
			creep.task = null;
		}
	}

	isValidTask() {
		return false;
	}

	isValidTarget() {
		return false;
	}

	work() {
		log.warning(`BAD RESULT: Should not get here...`);
		return ERR_INVALID_TARGET;
	}
}
