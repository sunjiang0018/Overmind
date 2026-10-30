import {profile} from '../../profiler/decorator';
import {Task} from '../Task';
import {sum} from '../../utilities/native';

export type pickupTargetType = Resource;
export const pickupTaskName = 'pickup';

@profile
export class TaskPickup extends Task<pickupTargetType> {

	constructor(target: pickupTargetType, options = {} as TaskOptions) {
		super('pickup', target, options);
		this.settings.oneShot = true;
	}

	isValidTask() {
		return sum(this.creep.carry) < this.creep.carryCapacity;
	}

	isValidTarget() {
		return !!this.target && this.target.amount > 0;
	}

	work() {
		if (!this.target) return ERR_INVALID_TARGET;
		return this.creep.pickup(this.target);
	}
}
