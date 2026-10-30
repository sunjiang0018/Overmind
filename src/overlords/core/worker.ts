import {isControllerSignedByMe, isControllerSignedByScreeps} from '../../game/Structures';
import {getTargetedBy} from '../../game/RoomObject';
import {roomPositionFindClosestByMultiRoomRange} from '../../game/RoomPosition';
import {getRoomDangerousHostiles, getRoomFleeDefaults} from '../../game/Room';
import {getRoomBarriers, getRoomRamparts} from '../../game/RoomStructures';
import {$} from '../../caching/GlobalCache';
import {Colony, ColonyStage, DEFCON} from '../../Colony';
import {CreepSetup} from '../../creepSetups/CreepSetup';
import {Roles, Setups} from '../../creepSetups/setups';
import {DirectiveNukeResponse} from '../../directives/situational/nukeResponse';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {BuildPriorities, FortifyPriorities} from '../../priorities/priorities_structures';
import {profile} from '../../profiler/decorator';
import {buildTaskName} from '../../tasks/instances/build';
import {fortifyTaskName} from '../../tasks/instances/fortify';
import {repairTaskName} from '../../tasks/instances/repair';
import {upgradeTaskName} from '../../tasks/instances/upgrade';
import {earlyBarrierLimit, hasRoomOverride, isDeferredTunnel, prioritizesRCL6, RCL6_RUSH} from '../../roomPlanner/roomOverrides';
import {Tasks} from '../../tasks/Tasks';
import {Cartographer, ROOMTYPE_CONTROLLER} from '../../utilities/Cartographer';
import {minBy} from '../../utilities/utils';
import {Visualizer} from '../../visuals/Visualizer';
import {Zerg} from '../../zerg/Zerg';
import {Overlord} from '../Overlord';
import {groupBy, sortBy, sum, remove, max, min} from '../../utilities/native';

/**
 * Spawns general-purpose workers, which maintain a colony, performing actions such as building, repairing, fortifying,
 * paving, and upgrading, when needed
 */
@profile
export class WorkerOverlord extends Overlord {

	workers: Zerg[];
	room: Room;
	repairStructures: Structure[];
	dismantleStructures: Structure[];
	fortifyBarriers: (StructureWall | StructureRampart)[];
	criticalBarriers: (StructureWall | StructureRampart)[];
	constructionSites: ConstructionSite[];
	nukeDefenseRamparts: StructureRampart[];
	nukeDefenseHitsRemaining: { [id: string]: number };
	useBoostedRepair?: boolean;

	static settings = {
		barrierHits         : {			// What HP to fortify barriers to at each RCL
			critical: 2500,
			1       : 3e+3,
			2       : 3e+3,
			3       : 1e+4,
			4       : 5e+4,
			5       : 1e+5,
			6       : 5e+5,
			7       : 2e+6,
			8       : 2.1e+7,
		},
		hitTolerance        : 100000, 	// allowable spread in HP
		fortifyDutyThreshold: 250000,	// ignore fortify duties until this amount of energy is present in the room
	};

	constructor(colony: Colony, priority = OverlordPriority.ownedRoom.work) {
		super(colony, 'worker', priority);
		const rush = prioritizesRCL6(colony.name, colony.level) && colony.defcon == DEFCON.safe;
		const barrierTarget = this.barrierTarget;
		const criticalTarget = Math.min(barrierTarget, rush ? RCL6_RUSH.criticalBarrierHits :
			(hasRoomOverride(colony.name) ? 50000 : WorkerOverlord.settings.barrierHits.critical));
		// Compute barriers needing fortification or critical attention
		this.fortifyBarriers = $.structures(this, 'fortifyBarriers', () =>
			sortBy(getRoomBarriers(this.room).filter(s =>
				s.hits < barrierTarget
				&& this.colony.roomPlanner.barrierPlanner.barrierShouldBeHere(s.pos)
			), s => s.hits), 25);
		this.criticalBarriers = $.structures(this, 'criticalBarriers', () =>
			this.fortifyBarriers.filter(
					 barrier => barrier.hits < criticalTarget), 10);
		// Generate a list of structures needing repairing (different from fortifying except in critical case)
		this.repairStructures = $.structures(this, 'repairStructures', () =>
			this.colony.repairables.filter(structure => {
				if (structure.structureType == STRUCTURE_CONTAINER) {
					// only repair containers in owned room
					if (structure.pos.roomName == this.colony.name) {
						return structure.hits < 0.5 * structure.hitsMax;
					} else {
						return false;
					}
				} else {
					return structure.hits < structure.hitsMax;
				}
			}));
		this.dismantleStructures = [];

		const homeRoomName = this.colony.room.name;
		const defcon = this.colony.defcon;
		// Filter constructionSites to only build valid ones
		const room = this.colony.room as any;
		const level = this.colony.controller.level;
		this.constructionSites = this.colony.constructionSites.filter(function(site) {
			if (site.structureType == STRUCTURE_ROAD && isDeferredTunnel(site.pos)) return false;
			// If site will be more than max amount of a structure at current level, ignore (happens after downgrade)
			const structureAmount = room[site.structureType + 's'] ? room[site.structureType + 's'].length :
									(room[site.structureType] ? 1 : 0);
			if (structureAmount >= CONTROLLER_STRUCTURES[site.structureType][level]) {
				return false;
			}
			if (defcon > DEFCON.safe) {
				// Only build non-road, non-container sites in the home room if defcon is unsafe
				return site.pos.roomName == homeRoomName &&
					   site.structureType != STRUCTURE_CONTAINER &&
					   site.structureType != STRUCTURE_ROAD;
			} else {
				// Build all non-container sites in outpost and all sites in room if defcon is safe
				if (site.pos.roomName != homeRoomName
					&& Cartographer.roomType(site.pos.roomName) == ROOMTYPE_CONTROLLER) {
					return site.structureType != STRUCTURE_CONTAINER &&
						   !(site.room && getRoomDangerousHostiles(site.room).length > 0);
				} else {
					return true;
				}
			}
		});

		// Nuke defense ramparts needing fortification
		this.nukeDefenseRamparts = [];
		this.nukeDefenseHitsRemaining = {};
		if (this.room.find(FIND_NUKES).length > 0) {
			for (const rampart of getRoomRamparts(this.colony.room)) {
				const neededHits = this.neededRampartHits(rampart);
				if (rampart.hits < neededHits && rampart.pos.findInRange(FIND_NUKES, 2).length > 0
					&& DirectiveNukeResponse.shouldReinforceLocation(rampart.pos)) {
					this.nukeDefenseRamparts.push(rampart);
					Visualizer.marker(rampart.pos, {color: 'gold'});
					this.nukeDefenseHitsRemaining[rampart.id] = Math.min(neededHits - rampart.hits, 0);
				}
			}

		}

		// Spawn boosted workers if there is significant fortifying which needs to be done
		const totalNukeDefenseHitsRemaining = sum(Object.values(this.nukeDefenseHitsRemaining ?? {}));
		const totalFortifyHitsRemaining = sum(this.fortifyBarriers, barrier =>
			Math.max(barrierTarget - barrier.hits, 0));
		const approxRepairAmountPerLifetime = REPAIR_POWER * 50 / 3 * CREEP_LIFE_TIME;
		if (totalNukeDefenseHitsRemaining > 3 * approxRepairAmountPerLifetime ||
			totalFortifyHitsRemaining > 5 * approxRepairAmountPerLifetime) {
			this.useBoostedRepair = true;
		}

		// Register workers
		this.workers = this.zerg(Roles.worker);
	}

	private neededRampartHits(rampart: StructureRampart): number {
		let neededHits = WorkerOverlord.settings.barrierHits[this.colony.level];
		for (const nuke of rampart.pos.lookFor(LOOK_NUKES)) {
			neededHits += 10e6;
		}
		for (const nuke of rampart.pos.findInRange(FIND_NUKES, 2)) {
			if (nuke.pos != rampart.pos) {
				neededHits += 5e6;
			}
		}
		return neededHits;
	}

	private get barrierTarget(): number {
		const limit = earlyBarrierLimit(this.colony.controller.pos);
		return limit != undefined ? limit :
			Math.max(WorkerOverlord.settings.barrierHits[this.colony.level],
					 hasRoomOverride(this.colony.name) ? 100000 : 0);
	}

	refresh() {
		super.refresh();
		$.refresh(this, 'repairStructures', 'dismantleStructures', 'fortifyBarriers', 'criticalBarriers',
				  'constructionSites', 'nukeDefenseRamparts');
	}

	private wishlistWorkers() {
		let setup = this.colony.level == 1 ? Setups.workers.early : Setups.workers.default;
		const workPartsPerWorker = setup.getBodyPotential(WORK, this.colony);
		let numWorkers: number;
		if (this.colony.stage == ColonyStage.Larva) {
			numWorkers = $.number(this, 'numWorkers', () => {
				// At lower levels, try to saturate the energy throughput of the colony
				const MAX_WORKERS = 30; // Maximum number of workers to spawn
				const energyMinedPerTick = sum(Object.values(this.colony.miningSites).map(function(site) {
					const overlord = site.overlords.mine;
					const miningPowerAssigned = sum(overlord.miners, (miner: Zerg) => miner.getActiveBodyparts(WORK));
					const saturation = Math.min(miningPowerAssigned / overlord.miningPowerNeeded, 1);
					return overlord.energyPerTick * saturation;
				}));
				const transporterSaturation = Math.min(this.colony.overlords.logistics.memory.transporterSaturation, 1);
				// Average energy per tick when working
				const energySpentPerTickPerWorkPart = this.colony.constructionSites.filter(
															   s => s.structureType != STRUCTURE_ROAD).length > 0 ? BUILD_POWER : 1;
				const energyPerTickPerWorker = workPartsPerWorker * energySpentPerTickPerWorkPart;
				const workerUptime = 1.0;

				const numWorkers = Math.ceil((energyMinedPerTick * transporterSaturation) /
											 (energyPerTickPerWorker * workerUptime)
											 + 0.5);

				return Math.min(numWorkers, MAX_WORKERS);
			});
		} else {
			if (this.colony.roomPlanner.memory.relocating) {
				// If relocating, maintain a maximum of workers
				numWorkers = 5;
			} else {
				numWorkers = $.number(this, 'numWorkers', () => {
					// At higher levels, spawn workers based on construction and repair that needs to be done
					const MAX_WORKERS = 5; // Maximum number of workers to spawn
					if (this.nukeDefenseRamparts.length > 0) {
						return MAX_WORKERS;
					}
					const buildTicks = sum(this.constructionSites,
											 site => Math.max(site.progressTotal - site.progress, 0)) / BUILD_POWER;
					const repairTicks = sum(this.repairStructures,
											  structure => structure.hitsMax - structure.hits) / REPAIR_POWER;
					const activeRooms = this.colony.roomNames.filter(roomName => this.colony.isRoomActive(roomName));
					const paveTicks = sum(activeRooms,
											roomName => this.colony.roadLogistics.energyToRepave(roomName));
					let fortifyTicks = 0;
					const shouldFortify = this.colony.assets.energy > WorkerOverlord.settings.fortifyDutyThreshold;
					if (shouldFortify) {
						fortifyTicks = 0.25 * sum(this.fortifyBarriers, barrier =>
							Math.max(0, this.barrierTarget
										- barrier.hits)) / REPAIR_POWER;
					}
					// max constructionTicks for private server manually setting progress
					let numWorkers = Math.ceil(2 * (5 * buildTicks + repairTicks + paveTicks + fortifyTicks) /
											   (workPartsPerWorker * CREEP_LIFE_TIME));
					numWorkers = Math.min(numWorkers, MAX_WORKERS);
					if (this.colony.controller.ticksToDowngrade <= (this.colony.level >= 4 ? 10000 : 2000)) {
						numWorkers = Math.max(numWorkers, 1);
					}
					return numWorkers;
				});
			}
		}

		if (this.useBoostedRepair) {
			setup = CreepSetup.boosted(setup, ['construct']);
		}
		if (prioritizesRCL6(this.colony.name, this.colony.level) && this.colony.defcon == DEFCON.safe
			&& this.nukeDefenseRamparts.length == 0) {
			numWorkers = Math.max(1, Math.min(numWorkers, RCL6_RUSH.maxWorkers));
		}
		this.wishlist(numWorkers, setup);
	}

	/**
	 * At low RCL workers can request energy directly from transporters
	 */
	private registerEnergyRequests() {
		if (this.colony.stage == ColonyStage.Larva) { // todo: check that there are no drop directives here
			for (const worker of this.workers) {
				if (worker.spawning) continue;
				const workParts = worker.bodypartCounts[WORK];
				const rechargeThreshold = 25 * workParts;
				if (worker.store.energy < rechargeThreshold && worker.store.getCapacity() > rechargeThreshold && worker.task) {
					if (worker.task.name == upgradeTaskName && !this.colony.upgradeSite.battery) {
						this.colony.logisticsNetwork.requestInput(worker, {dAmountdt: workParts * UPGRADE_CONTROLLER_POWER});
					} else if (worker.task.name == buildTaskName) {
						this.colony.logisticsNetwork.requestInput(worker, {dAmountdt: workParts * BUILD_POWER});
					} else if (worker.task.name == repairTaskName) {
						this.colony.logisticsNetwork.requestInput(worker, {dAmountdt: workParts * 1});
					} else if (worker.task.name == fortifyTaskName) {
						this.colony.logisticsNetwork.requestInput(worker, {dAmountdt: workParts * 1});
					}
				}
			}
		}
	}

	init() {
		this.wishlistWorkers();
		this.registerEnergyRequests();
	}

	private repairActions(worker: Zerg): boolean {
		const target = roomPositionFindClosestByMultiRoomRange(worker.pos, this.repairStructures);
		if (target) {
			worker.task = Tasks.repair(target);
			return true;
		} else {
			return false;
		}
	}

	private buildActions(worker: Zerg): boolean {
		const groupedSites = groupBy(this.constructionSites, site => site.structureType);
		for (const structureType of BuildPriorities) {
			if (groupedSites[structureType]) {
				const target = roomPositionFindClosestByMultiRoomRange(worker.pos, groupedSites[structureType]);
				if (target) {
					worker.task = Tasks.build(target);
					return true;
				}
			}
		}
		return false;
	}

	private dismantleActions(worker: Zerg): boolean {
		const targets = this.dismantleStructures.filter(s => (getTargetedBy(s) || []).length < 3);
		const target = roomPositionFindClosestByMultiRoomRange(worker.pos, targets);
		if (target) {
			remove(this.dismantleStructures, s => s == target);
			worker.task = Tasks.dismantle(target);
			return true;
		} else {
			return false;
		}
	}

	// Find a suitable repair ordering of roads with a depth first search
	private pavingActions(worker: Zerg): boolean {
		const roomToRepave = this.colony.roadLogistics.workerShouldRepave(worker)!;
		this.colony.roadLogistics.registerWorkerAssignment(worker, roomToRepave);
		// Build a paving manifest
		const pavingManifest = this.colony.roadLogistics.buildPavingManifest(worker, roomToRepave);
		if (pavingManifest) {
			worker.task = pavingManifest;
			return true;
		} else {
			return false;
		}
	}

	private fortifyActions(worker: Zerg, fortifyStructures = this.fortifyBarriers): boolean {
		const hitsMax = this.barrierTarget;
		// Cached candidates may already have reached the new upkeep target.
		fortifyStructures = fortifyStructures.filter(structure => structure.hits < hitsMax);
		let lowBarriers: (StructureWall | StructureRampart)[];
		const highestBarrierHits = max(fortifyStructures, structure => structure.hits);
		if (highestBarrierHits > WorkerOverlord.settings.hitTolerance) {
			// At high barrier HP, fortify only structures that are within a threshold of the lowest
			const lowestBarrierHits = min(fortifyStructures, structure => structure.hits);
			lowBarriers = fortifyStructures.filter(structure => structure.hits <= lowestBarrierHits +
																   WorkerOverlord.settings.hitTolerance);
		} else {
			// Otherwise fortify the lowest N structures
			const numBarriersToConsider = 5; // Choose the closest barrier of the N barriers with lowest hits
			lowBarriers = fortifyStructures.slice(0, numBarriersToConsider);
		}
		const target = roomPositionFindClosestByMultiRoomRange(worker.pos, lowBarriers);
		if (target) {
			worker.task = Tasks.fortify(target, hitsMax);
			return true;
		} else {
			return false;
		}
	}

	private nukeFortifyActions(worker: Zerg, fortifyStructures = this.nukeDefenseRamparts): boolean {
		const target = minBy(fortifyStructures, rampart => {
			const structuresUnderRampart = rampart.pos.lookFor(LOOK_STRUCTURES);
			return min(structuresUnderRampart, structure => {
				const priority = FortifyPriorities.findIndex(sType => sType == structure.structureType);
				if (priority >= 0) { // if found
					return priority;
				} else { // not found
					return 999;
				}
			});
		});
		if (target) {
			worker.task = Tasks.fortify(target);
			return true;
		} else {
			return false;
		}
	}

	private upgradeActions(worker: Zerg): boolean {
		// Sign controller if needed
		if ((!isControllerSignedByMe(this.colony.controller) && !isControllerSignedByScreeps(this.colony.controller))) {
			worker.task = Tasks.signController(this.colony.controller);
			return true;
		}
		worker.task = Tasks.upgrade(this.room.controller!);
		return true;
	}

	private handleWorker(worker: Zerg) {
		if (worker.carry.energy > 0) {
			// TODO Add high priority to block controller with ramparts/walls in case of downgrade attack
			// FIXME workers get stalled at controller in case of downgrade attack
			// Upgrade controller if close to downgrade or if getting controller attacked/was downgraded
			const downgradeLevel = CONTROLLER_DOWNGRADE[this.colony.controller.level] *
								   (this.colony.controller.level < 4 ? .3 : .7);
			if ((!this.colony.controller.upgradeBlocked || this.colony.controller.upgradeBlocked < 30)
				&& (this.colony.controller.ticksToDowngrade <= downgradeLevel
					|| this.colony.controller.progress > this.colony.controller.progressTotal)) {
				if (this.upgradeActions(worker)) return;
			}
			// Repair damaged non-road non-barrier structures
			if (this.repairStructures.length > 0 && this.colony.defcon == DEFCON.safe) {
				if (this.repairActions(worker)) return;
			}
			// Fortify critical barriers
			if (this.criticalBarriers.length > 0) {
				if (this.fortifyActions(worker, this.criticalBarriers)) return;
			}
			// Keep one maintenance worker; everyone else puts available energy into RCL6.
			if (prioritizesRCL6(this.colony.name, this.colony.level) && this.colony.defcon == DEFCON.safe
				&& this.nukeDefenseRamparts.length == 0 && worker != this.workers[0]) {
				if (this.upgradeActions(worker)) return;
			}
			// Build new structures
			if (this.constructionSites.length > 0) {
				if (this.buildActions(worker)) return;
			}
			// Build ramparts to block incoming nuke
			if (this.nukeDefenseRamparts.length > 0 && !this.colony.state.isRebuilding) {
				if (this.nukeFortifyActions(worker, this.nukeDefenseRamparts)) return;
			}
			// Build and maintain roads
			if (this.colony.roadLogistics.workerShouldRepave(worker) && this.colony.defcon == DEFCON.safe) {
				if (this.pavingActions(worker)) return;
			}
			// Dismantle marked structures
			if (this.dismantleStructures.length > 0 && this.colony.defcon == DEFCON.safe) {
				if (this.dismantleActions(worker)) return;
			}
			// Fortify walls and ramparts
			if (prioritizesRCL6(this.colony.name, this.colony.level) && this.colony.defcon == DEFCON.safe) {
				if (this.upgradeActions(worker)) return;
			}
			if (this.fortifyBarriers.length > 0) {
				if (this.fortifyActions(worker, this.fortifyBarriers)) return;
			}
			// Upgrade controller if less than RCL8 or no upgraders
			if ((this.colony.level < 8 || this.colony.upgradeSite.overlord.upgraders.length == 0)
				&& this.colony.defcon == DEFCON.safe) {
				if (this.upgradeActions(worker)) return;
			}
		} else {
			// Acquire more energy
			const workerWithdrawLimit = this.colony.stage == ColonyStage.Larva ? 200 : 100;
			worker.task = Tasks.recharge(workerWithdrawLimit);
		}
	}

	run() {
		this.autoRun(this.workers, worker => this.handleWorker(worker),
					 worker => worker.flee(getRoomFleeDefaults(worker.room), {invalidateTask: true}));
	}
}
