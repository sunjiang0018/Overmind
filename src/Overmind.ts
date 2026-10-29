import { GameCache } from './caching/GameCache';
import { Colony, getAllColonies } from './Colony';
import { log } from './console/log';
import { DirectiveClearRoom } from './directives/colony/clearRoom';
import { DirectivePoisonRoom } from './directives/colony/poisonRoom';
import { Directive } from './directives/Directive';
import { DirectiveWrapper } from './directives/initializer';
import { NotifierPriority } from './directives/Notifier';
import { RoomIntel } from './intel/RoomIntel';
import { SpawnGroup } from './logistics/SpawnGroup';
import { TerminalNetworkV2 } from './logistics/TerminalNetwork_v2';
import { TraderJoe } from './logistics/TradeNetwork';
import { Mem } from './memory/Memory';
import { Segmenter } from './memory/Segmenter';
import { Overlord } from './overlords/Overlord';
import { Overseer } from './Overseer';
import { profile } from './profiler/decorator';
import { Stats } from './stats/stats';
import { ExpansionPlanner } from './strategy/ExpansionPlanner';
import { alignedNewline } from './utilities/stringConstants';
import { Visualizer } from './visuals/Visualizer';
import { PowerZerg } from './zerg/PowerZerg';
import { Zerg } from './zerg/Zerg';
import {
	NEW_OVERMIND_INTERVAL,
	PROFILER_COLONY_LIMIT,
	PROFILER_INCLUDE_COLONIES,
	SHOW_ROOM_HUD,
	SUPPRESS_INVALID_DIRECTIVE_ALERTS,
	USE_SCREEPS_PROFILER,
	USE_TRY_CATCH
} from './~settings';

declare global {
	interface IOvermindMemory {
		[key: string]: any;
	}
}

const profilerRooms: { [roomName: string]: boolean } = {};
if (USE_SCREEPS_PROFILER) {
	for (const name of PROFILER_INCLUDE_COLONIES) {
		profilerRooms[name] = true;
	}
	const myRoomNames = _.filter(_.keys(Game.rooms), roomName => Game.rooms[roomName] && Game.rooms[roomName].my);
	for (const name of _.sample(myRoomNames, PROFILER_COLONY_LIMIT - PROFILER_INCLUDE_COLONIES.length)) {
		profilerRooms[name] = true;
	}
}

/**
 * Overmind class - manages colony-scale operations and contains references to all brain objects
 */
@profile
export default class Overmind implements IOvermind {

	memory: IOvermindMemory;
	overseer: Overseer;
	shouldBuild: boolean;
	expiration: number;
	cache: GameCache;
	colonies: { [roomName: string]: Colony };
	suspendedColonies: string[];
	suppressedColonies: string[];
	directives: { [flagName: string]: Directive };
	zerg: { [creepName: string]: Zerg };
	powerZerg: { [creepName: string]: PowerZerg };
	overlords: { [ref: string]: Overlord };
	spawnGroups: { [ref: string]: SpawnGroup };
	colonyMap: { [roomName: string]: string };
	terminalNetwork: TerminalNetworkV2;
	tradeNetwork: TraderJoe;
	expansionPlanner: ExpansionPlanner;
	roomIntel: RoomIntel;
	exceptions: Error[];

	constructor() {
		this.memory = Memory.Overmind;
		this.overseer = new Overseer();
		this.shouldBuild = true;
		this.expiration = Game.time + NEW_OVERMIND_INTERVAL;
		this.cache = new GameCache();
		this.colonies = {};
		this.suspendedColonies = [];
		this.suppressedColonies = [];
		this.directives = {};
		this.zerg = {};
		this.powerZerg = {};
		this.overlords = {};
		this.spawnGroups = {};
		this.colonyMap = {};
		this.terminalNetwork = new TerminalNetworkV2();
		global.TerminalNetwork = this.terminalNetwork;
		this.tradeNetwork = new TraderJoe();
		global.TradeNetwork = this.tradeNetwork;
		this.expansionPlanner = new ExpansionPlanner();
		this.roomIntel = new RoomIntel();
		this.exceptions = [];
	}

	build(): void {
		log.debug('Rebuilding Overmind object!');
		this.cache.build();
		this.registerColonies();
		this.registerDirectives();
		_.forEach(this.colonies, colony => colony.spawnMoarOverlords());
		_.forEach(this.directives, directive => directive.spawnMoarOverlords());
		this.shouldBuild = false;
	}

	refresh(): void {
		this.shouldBuild = true;
		this.memory = Memory.Overmind;
		this.exceptions = [];
		this.cache.refresh();
		this.overseer.refresh();
		this.terminalNetwork.refresh();
		this.tradeNetwork.refresh();
		this.expansionPlanner.refresh();
		this.refreshColonies();
		this.refreshDirectives();
		for (const name in this.overlords) {
			this.overlords[name].refresh();
		}
		for (const name in this.spawnGroups) {
			this.spawnGroups[name].refresh();
		}
		this.shouldBuild = false;
	}

	try(fn: () => any, identifier?: string): void {
		if (USE_TRY_CATCH) {
			try {
				fn();
			} catch (e: any) {
				if (identifier) {
					e.name = `Caught unhandled exception at ${fn} (identifier: ${identifier}): \n` + e.name + '\n' + e.stack;
				} else {
					e.name = `Caught unhandled exception at ${fn}: \n` + e.name + '\n' + e.stack;
				}
				this.exceptions.push(e);
			}
		} else {
			fn();
		}
	}

	handleExceptions(): void {
		if (this.exceptions.length == 0) {
			return;
		} else {
			log.warning('Exceptions present this tick! Rebuilding Overmind object in next tick.');
			Memory.stats.persistent.lastErrorTick = Game.time;
			this.shouldBuild = true;
			this.expiration = Game.time;
			if (this.exceptions.length == 1) {
				throw _.first(this.exceptions);
			} else {
				for (const error of this.exceptions) {
					log.throw(error);
				}
				const error = new Error('Multiple exceptions caught this tick!');
				error.stack = _.map(this.exceptions, e => e.name).join('\n');
				throw error;
			}
		}
	}

	private registerColonies(): void {
		const colonyOutposts: { [colonyName: string]: string[] } = {};
		this.colonyMap = {};
		const outpostFlagsByColony = _.groupBy(this.cache.outpostFlags, flag => flag.memory[MEM.COLONY]);

		for (const name in Game.rooms) {
			const room = Game.rooms[name];
			if (room.my) {
				const colonyMemory = Memory.colonies[name];
				if (colonyMemory && colonyMemory.suspend) {
					this.suspendedColonies.push(name);
					continue;
				}
				if (room.flags) {
					const clearOrPoisonFlags = _.filter(room.flags, flag => DirectiveClearRoom.filter(flag) || DirectivePoisonRoom.filter(flag));
					if (clearOrPoisonFlags.length > 0) {
						this.suppressedColonies.push(name);
						continue;
					}
					colonyOutposts[name] = _.map(outpostFlagsByColony[name], flag => (flag.memory.setPos || flag.pos).roomName);
				}
				this.colonyMap[name] = name;
			}
		}

		for (const colonyName in colonyOutposts) {
			for (const outpostName of colonyOutposts[colonyName]) {
				this.colonyMap[outpostName] = colonyName;
			}
		}

		let colonyId = 0;
		for (const name in colonyOutposts) {
			if (USE_SCREEPS_PROFILER && !profilerRooms[name]) {
				if (Game.time % 20 == 0) {
					log.alert(`Suppressing instantiation of colony ${name}.`);
				}
				continue;
			}
			try {
				this.colonies[name] = new Colony(colonyId, name, colonyOutposts[name]);
			} catch (e: any) {
				e.name = `Caught unhandled exception instantiating colony ${name}: \n` + e.name;
				this.exceptions.push(e);
			}
			colonyId++;
		}
	}

	private refreshColonies(): void {
		for (const name in this.colonies) {
			try {
				this.colonies[name].refresh();
			} catch (e: any) {
				e.name = `Caught unhandled exception refreshing colony ${name}: \n` + e.name;
				this.exceptions.push(e);
			}
		}
	}

	private registerDirectives(spawnMoarOverlords = false): void {
		for (const name in Game.flags) {
			if (this.directives[name]) {
				continue;
			}
			const colonyName = Game.flags[name].memory[MEM.COLONY];
			if (colonyName) {
				if (USE_SCREEPS_PROFILER && !profilerRooms[colonyName]) {
					continue;
				}
				const colonyMemory = Memory.colonies[colonyName];
				if (colonyMemory && colonyMemory.suspend) {
					continue;
				}
			}
			const directive = DirectiveWrapper(Game.flags[name]);
			const isRegistered = !!this.directives[name];
			if (directive && isRegistered && spawnMoarOverlords) {
				directive.spawnMoarOverlords();
			}
			if (!directive && !SUPPRESS_INVALID_DIRECTIVE_ALERTS && Game.time % 10 == 0) {
				log.alert(`Flag [${name} @ ${Game.flags[name].pos.print}] does not match a valid directive color code! (Refer to /src/directives/initializer.ts)` + alignedNewline + 'Use removeErrantFlags() to remove flags which do not match a directive.');
			}
		}
	}

	private refreshDirectives(): void {
		for (const name in this.directives) {
			this.directives[name].refresh();
		}
		this.registerDirectives(true);
	}

	init(): void {
		this.try(() => RoomIntel.init());
		this.try(() => this.tradeNetwork.init());
		this.try(() => this.terminalNetwork.init());
		this.try(() => this.overseer.init(), 'overseer.init()');
		for (const name in this.colonies) {
			const start = Game.cpu.getUsed();
			this.try(() => this.colonies[name].init(), name);
			Stats.log(`cpu.usage.${name}.init`, Game.cpu.getUsed() - start);
		}
		for (const name in this.spawnGroups) {
			this.try(() => this.spawnGroups[name].init(), name);
		}
		this.try(() => this.expansionPlanner.init());
	}

	run(): void {
		for (const name in this.spawnGroups) {
			this.try(() => this.spawnGroups[name].run(), name);
		}
		this.try(() => this.overseer.run(), 'overseer.run()');
		for (const name in this.colonies) {
			this.try(() => this.colonies[name].run(), name);
		}
		this.try(() => this.terminalNetwork.run());
		this.try(() => this.tradeNetwork.run());
		this.try(() => this.expansionPlanner.run());
		this.try(() => RoomIntel.run());
	}

	postRun(): void {
		this.try(() => Segmenter.run());
		this.handleExceptions();
	}

	handleNotifications(): void {
		for (const name of this.suspendedColonies) {
			this.overseer.notifier.alert('Colony suspended', name, NotifierPriority.High);
		}
		for (const name of this.suppressedColonies) {
			this.overseer.notifier.alert('Colony suppressed', name, NotifierPriority.Low);
		}
	}

	visuals(): void {
		if (!Visualizer.enabled) return;
		if (Game.cpu.bucket > 9000) {
			this.overseer.visuals();
			if (SHOW_ROOM_HUD) {
				Visualizer.visuals();
				for (const name in this.colonies) {
					this.colonies[name].visuals();
				}
			}
		} else if (Game.time % 10 == 0) {
			log.info(`CPU bucket is too low (${Game.cpu.bucket}) - skip rendering visuals.`);
		}
	}

}

