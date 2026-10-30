import {getRoomHostiles} from '../../game/Room';
import {CombatCreepSetup} from '../../creepSetups/CombatCreepSetup';
import {CombatSetups, Roles} from '../../creepSetups/setups';
import {DirectiveInvasionDefense} from '../../directives/defense/invasionDefense';
import {CombatIntel} from '../../intel/CombatIntel';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {CombatZerg} from '../../zerg/CombatZerg';
import {CombatOverlord} from '../CombatOverlord';
import {min} from '../../utilities/native';

/**
 * Spawns ranged defenders to defend against incoming player invasions in an owned room
 */
@profile
export class RangedDefenseOverlord extends CombatOverlord {

	hydralisks: CombatZerg[];

	room: Room;
	directive: DirectiveInvasionDefense;

	static settings = {
		retreatHitsPercent : 0.85,
		reengageHitsPercent: 0.95,
	};

	constructor(directive: DirectiveInvasionDefense,
				priority = OverlordPriority.defense.rangedDefense) {
		super(directive, 'rangedDefense', priority, 1);
		this.hydralisks = this.combatZerg(Roles.ranged);
	}

	private handleDefender(hydralisk: CombatZerg): void {
		if (getRoomHostiles(this.room).length > 0) {
			hydralisk.autoCombat(this.room.name);
		} else {
			if (!hydralisk.doMedicActions(this.room.name) && hydralisk.pos.getRangeTo(this.directive.pos) > 4) {
				hydralisk.goTo(this.directive.pos);
			}
		}
	}

	/**
	 * Computes how much *additional* ranged parts we need
	 */
	private computeNeededAdditionalRangedPotential(): number {
		const healAmount = CombatIntel.maxHealingByCreeps(getRoomHostiles(this.room));
		const towerDamage = getRoomHostiles(this.room)[0] ? CombatIntel.towerDamageAtPos(getRoomHostiles(this.room)[0].pos) || 0 : 0;
		const worstDamageMultiplier = min(getRoomHostiles(this.room), creep => CombatIntel.minimumDamageTakenMultiplier(creep));
		const hydraliskDamage = RANGED_ATTACK_POWER * CombatIntel.getMyCombatPotentials(this.hydralisks).ranged;
		const maxDamageReceived = worstDamageMultiplier * (hydraliskDamage + towerDamage + 1);
		const needAdditionalDamage = Math.max(healAmount - maxDamageReceived, 0);
		const neededRangedParts = needAdditionalDamage / RANGED_ATTACK_POWER;
		return neededRangedParts;
	}

	init() {
		if (this.reassignIdleCreeps(Roles.ranged, 1)) return;

		let setup = CombatSetups.hydralisks.default;
		if (this.spawnGroup.colonies.every(col => col.room.energyCapacityAvailable < 800)) {
			setup = CombatSetups.hydralisks.noHeal; // can't spawn default hydras at very low rcl
		} else {
			const {attack, ranged, heal} = CombatIntel.getCombatPotentials(getRoomHostiles(this.room));
			// if there's a lot of big baddies or this assault has lasted a long time, pull out the boosts
			if (attack + ranged + heal > 100 || this.age > 1000) {
				setup = CombatSetups.hydralisks.boosted.default;
			}
		}

		const neededAdditionalRangedPotential = this.computeNeededAdditionalRangedPotential();
		if (neededAdditionalRangedPotential) {
			this.requestCreep(setup);
		}
	}

	run() {
		this.autoRun(this.hydralisks, hydralisk => this.handleDefender(hydralisk));
	}
}
