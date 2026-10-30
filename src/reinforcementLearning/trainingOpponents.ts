import {getRoomHostiles} from '../game/Room';
import {NeuralZerg} from '../zerg/NeuralZerg';
import {randomInt, sample} from '../utilities/native';

export class TrainingOpponents {

	/**
	 * Simple combat behavior to train against. Every creep just chases the nearest opponent and attacks them.
	 */
	static simpleCombat(zerg: NeuralZerg) {
		const closestOpponent = zerg.pos.findClosestByRange(getRoomHostiles(zerg.room));
		if (closestOpponent) {
			zerg.creep.moveTo(closestOpponent);
			zerg.attack(closestOpponent);
			zerg.rangedAttack(closestOpponent);
			zerg.heal(zerg);
		}
	}

	/**
	 * Stupid combat behavior. Moves in a random direction and attacks a random target in range if combat is allowed
	 */
	static stupidCombat(zerg: NeuralZerg, allowAttack = false, allowHeal = false) {
		const direction = randomInt(1, 8) as DirectionConstant;
		zerg.move(direction);

		if (allowAttack) {
			const meleeTarget = sample(zerg.pos.findInRange(getRoomHostiles(zerg.room), 1));
			if (meleeTarget) zerg.attack(meleeTarget);
			const rangedTarget = sample(zerg.pos.findInRange(getRoomHostiles(zerg.room), 3));
			if (rangedTarget) zerg.rangedAttack(rangedTarget);
		}
		if (allowHeal) {
			zerg.heal(zerg);
		}
	}

}
