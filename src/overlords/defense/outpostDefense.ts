import { getRoomClaimingPlayerHostiles, getRoomHostiles } from "../../game/Room";
import { GoalFinder } from "../../targeting/GoalFinder";
import { Movement } from "../../movement/Movement";
import { CombatSetups, Roles } from "../../creepSetups/setups";
import { DirectiveOutpostDefense } from "../../directives/defense/outpostDefense";
import { CombatIntel, CombatPotentials } from "../../intel/CombatIntel";
import { OverlordPriority } from "../../priorities/priorities_overlords";
import { profile } from "../../profiler/decorator";
import { CombatZerg } from "../../zerg/CombatZerg";
import { CombatOverlord } from "../CombatOverlord";

/**
 * General purpose skirmishing overlord for dealing with player combat in an outpost
 */
@profile
export class OutpostDefenseOverlord extends CombatOverlord {
  directive: DirectiveOutpostDefense;
  zerglings: CombatZerg[];
  hydralisks: CombatZerg[];
  healers: CombatZerg[];

  constructor(
    directive: DirectiveOutpostDefense,
    priority = OverlordPriority.outpostDefense.outpostDefense,
  ) {
    super(directive, "outpostDefense", priority, 1);
    // this.spawnGroup.settings.flexibleEnergy = true;
    this.zerglings = this.combatZerg(Roles.melee);
    this.hydralisks = this.combatZerg(Roles.ranged);
    this.healers = this.combatZerg(Roles.healer);
  }

  private handleCombat(zerg: CombatZerg) {
    const controllerGuard =
      this.directive.memory.controllerGuard && zerg.memory.role == Roles.ranged;
    if (controllerGuard && zerg.needsToRecover()) {
      zerg.healSelfIfPossible();
      delete zerg.memory._go;
      zerg.recover();
      return;
    }
    if (
      this.room &&
      zerg.room.name == this.pos.roomName &&
      zerg.getActiveBodyparts(RANGED_ATTACK) > 0 &&
      !zerg.needsToRecover()
    ) {
      const claimers = getRoomClaimingPlayerHostiles(this.room);
      const target = zerg.pos.findClosestByRange(claimers);
      if (target) {
        // Stop the controller contest before chasing passing transporters.
        zerg.autoRanged(claimers, false);
        zerg.healSelfIfPossible();
        const goals = GoalFinder.skirmishGoals(zerg);
        // Direct combat movement bypasses goTo's path cursor. Never reuse that old route later.
        delete zerg.memory._go;
        Movement.combatMove(zerg, [{ pos: target.pos, range: 3 }], goals.avoid);
        return;
      }
    }
    if (controllerGuard) {
      // This guard intercepts CLAIM units and returns to its post, without medic duties.
      zerg.healSelfIfPossible();
      const idlePos = this.directive.memory.idlePos || this.pos;
      zerg.goTo(new RoomPosition(idlePos.x, idlePos.y, this.pos.roomName), { range: 0 });
      return;
    }
    if (this.room && getRoomHostiles(this.room).length == 0) {
      const isDoingMedicActions = zerg.doMedicActions(this.room.name);
      const idlePos = this.directive.memory.idlePos;
      if (!isDoingMedicActions && idlePos && zerg.memory.role == Roles.ranged) {
        zerg.goTo(new RoomPosition(idlePos.x, idlePos.y, this.pos.roomName), { range: 0 });
      }
    } else {
      if (zerg.room.name == this.pos.roomName && !zerg.needsToRecover()) delete zerg.memory._go;
      zerg.autoSkirmish(this.pos.roomName);
    }
  }

  private handleHealer(healer: CombatZerg) {
    if (CombatIntel.isHealer(healer) && healer.getActiveBodyparts(HEAL) == 0) {
      if (this.colony.towers.length > 0) {
        return healer.goToRoom(this.colony.room.name); // go get healed
      } else {
        return healer.suicide(); // you're useless at this point // TODO: this isn't smart
      }
    } else {
      if (
        this.room &&
        [...this.zerglings, ...this.hydralisks].some((creep) => creep.room == this.room)
      ) {
        this.handleCombat(healer); // go to room if there are any fighters in there
      } else {
        healer.autoSkirmish(healer.room.name);
      }
    }
  }

  // private computeNeededHydraliskAmount(setup: CombatCreepSetup, enemyRangedPotential: number): number {
  // 	const hydraliskPotential = setup.getBodyPotential(RANGED_ATTACK, this.colony);
  // 	// TODO: body potential from spawnGroup energy?
  // 	// let worstDamageMultiplier = CombatIntel.minimumDamageMultiplierForGroup(this.room.hostiles);
  // 	// TODO this was reduced from 1.5 due to draining, but should be re-evaluated when we have infra in place to track
  // 	// If a directive is being too costly
  // 	return Math.ceil(1.1 * enemyRangedPotential / hydraliskPotential);
  // }
  //
  // // TODO: division by 0 error!
  // private computeNeededBroodlingAmount(setup: CombatCreepSetup, enemyAttackPotential: number): number {
  // 	const broodlingPotential = setup.getBodyPotential(ATTACK, this.colony);
  // 	// let worstDamageMultiplier = CombatIntel.minimumDamageMultiplierForGroup(this.room.hostiles);
  // 	return Math.ceil(1.1 * enemyAttackPotential / broodlingPotential);
  // }
  //
  // private computeNeededHealerAmount(setup: CombatCreepSetup, enemyHealPotential: number): number {
  // 	const healerPotential = setup.getBodyPotential(HEAL, this.colony);
  // 	return Math.ceil(1.1 * enemyHealPotential / healerPotential);
  // }

  private getEnemyPotentials(): CombatPotentials {
    if (this.room) {
      return CombatIntel.getCombatPotentials(getRoomHostiles(this.room));
    } else {
      return { attack: 0, ranged: 1, heal: 0 };
    }
  }

  private getSurplusHydralisks(): Set<CombatZerg> {
    if (
      !this.directive.memory.persistent ||
      !this.room ||
      getRoomHostiles(this.room).length > 0 ||
      !(Game.time - this.directive.memory.safeSince > 100) ||
      this.colony.spawns.length == 0
    ) {
      return new Set();
    }
    // Keep one capable sentry at a persistent outpost after the threat has passed.
    const ranked = [...this.hydralisks].sort(
      (a, b) =>
        b.getActiveBodyparts(RANGED_ATTACK) - a.getActiveBodyparts(RANGED_ATTACK) ||
        (b.ticksToLive ?? CREEP_LIFE_TIME) - (a.ticksToLive ?? CREEP_LIFE_TIME),
    );
    return new Set(ranked.slice(1));
  }

  private recycleDefender(defender: CombatZerg): void {
    const spawn = defender.pos.findClosestByRange(this.colony.spawns) || this.colony.spawns[0];
    if (spawn) {
      if (defender.pos.isNearTo(spawn)) {
        spawn.recycleCreep(defender.creep);
      } else {
        defender.goTo(spawn);
      }
    }
  }

  init() {
    const enemyPotentials = this.getEnemyPotentials();
    const needAttack = enemyPotentials.attack * 1.1;
    // CLAIM-only invaders have zero combat potential but still need a defender.
    const controllerContest = this.room && getRoomClaimingPlayerHostiles(this.room).length > 0;
    const maintainPresence =
      this.directive.memory.persistent && this.room && getRoomHostiles(this.room).length > 0;
    const needRanged = Math.max(
      enemyPotentials.ranged * 1.3,
      controllerContest || maintainPresence ? 1 : 0,
    );
    const needHeal = enemyPotentials.heal * 1.2;

    if (needAttack > 100 || needRanged > 100 || needHeal > 100) {
      return; // fuck it let's not fight this
    }

    const noBigColoniesNearby = this.spawnGroup.colonies.every(
      (col) => col.room.energyCapacityAvailable < 800,
    );

    const myPotentials = CombatIntel.getMyCombatPotentials([
      ...this.zerglings,
      ...this.hydralisks,
      ...this.healers,
    ]);

    // if (attack > 30 || rangedAttack > 30) {
    // 	// Handle boost worthy attackers
    // 	this.wishlist(1, CombatSetups.hydralisks.boosted_T3);
    // }

    const hydraliskSetup = noBigColoniesNearby
      ? CombatSetups.hydralisks.noHeal
      : CombatSetups.hydralisks.default;
    const zerglingSetup = noBigColoniesNearby
      ? CombatSetups.zerglings.default
      : CombatSetups.zerglings.healing;
    const healerSetup = CombatSetups.transfusers.default;

    if (myPotentials.ranged < needRanged) {
      if (!this.reassignIdleCreeps(Roles.ranged, 1)) this.requestCreep(hydraliskSetup);
    } else if (myPotentials.heal < needHeal) {
      if (!this.reassignIdleCreeps(Roles.healer, 1)) this.requestCreep(healerSetup);
    } else if (myPotentials.attack < needAttack) {
      if (!this.reassignIdleCreeps(Roles.melee, 1)) this.requestCreep(zerglingSetup);
    }
  }

  run() {
    const surplusHydralisks = this.getSurplusHydralisks();
    this.autoRun(this.zerglings, (zergling) => this.handleCombat(zergling));
    this.autoRun(this.hydralisks, (hydralisk) => {
      if (surplusHydralisks.has(hydralisk)) {
        this.recycleDefender(hydralisk);
      } else {
        this.handleCombat(hydralisk);
      }
    });
    this.autoRun(this.healers, (healer) => this.handleHealer(healer));
  }
}
