import {profile} from '../../profiler/decorator';
import {earlyBarrierLimit} from '../../roomPlanner/roomOverrides';
import {Task} from '../Task';


export type fortifyTargetType = StructureWall | StructureRampart;
export const fortifyTaskName = 'fortify';

@profile
export class TaskFortify extends Task<fortifyTargetType> {
	data: {
		hitsMax: number | undefined;
	};

	constructor(target: fortifyTargetType, hitsMax?: number, options = {} as TaskOptions) {
		super(fortifyTaskName, target, options);
		// Settings
		this.settings.timeout = 100; // Don't want workers to fortify indefinitely
		this.settings.targetRange = 3;
		this.settings.workOffRoad = true;
		this.data.hitsMax = hitsMax;
	}

	isValidTask() {
		return (this.creep.carry.energy > 0); // Times out once creep is out of energy
	}

	isValidTarget() {
		if (!this.target) return false;
		const limit = earlyBarrierLimit(this.target.pos);
		return this.target.hits < Math.min(this.data.hitsMax || this.target.hitsMax, limit || Infinity);
	}

	work() {
		if (!this.target || !this.isValidTarget()) return ERR_INVALID_TARGET;
		return this.creep.repair(this.target);
	}
}
