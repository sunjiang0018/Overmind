import { assimilationLocked } from './assimilation/decorator';
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
import { bulleted } from './utilities/utils';
import { asciiLogoSmall } from './visuals/logos';
import { Visualizer } from './visuals/Visualizer';
import { PowerZerg } from './zerg/PowerZerg';
import { Zerg } from './zerg/Zerg';
import {
	DEFAULT_OVERMIND_SIGNATURE,
	MUON,
	MY_USERNAME,
	NEW_OVERMIND_INTERVAL,
	PROFILER_COLONY_LIMIT,
	PROFILER_INCLUDE_COLONIES,
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
@assimilationLocked
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
		if (Game.time % 3 == 0) {
			IntelManagement.run();
		}
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
		this.try(() => Assimilator.run());
	}

	postRun(): void {
		this.try(() => VersionUpdater.run());
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
		if (Game.cpu.bucket > 9000) {
			Visualizer.visuals();
			if (VersionUpdater.memory.newestVersion) {
				const newestVersion = VersionUpdater.memory.newestVersion;
				if (VersionUpdater.isVersionOutdated(newestVersion)) {
					this.overseer.notifier.alert(`[!] Update available: ${__VERSION__} → ${newestVersion}`, undefined, NotifierPriority.SystemUpdate);
				}
			}
			this.overseer.visuals();
			for (const name in this.colonies) {
				this.colonies[name].visuals();
			}
		} else if (Game.time % 10 == 0) {
			log.info(`CPU bucket is too low (${Game.cpu.bucket}) - skip rendering visuals.`);
		}
	}

}

class IntelManagement {

	static runRoomIntel_1(): void {
		const invalidSignatures: string[] = [];
		const colonies = getAllColonies();
		if (colonies.length == 0) {
			return;
		}
		for (const colony of colonies) {
			if (colony.defcon > 0 || colony.creeps.length == 0) {
				continue;
			}
			const controller = colony.controller;
			if (controller.signedByScreeps || controller.level < 4) {
				continue;
			}
			let hasValidSign = false;
			if (controller.sign) {
				const text = controller.sign.text;
				if (text.toLowerCase().includes('overmind') || text.includes('ᴏᴠᴇʀᴍɪɴᴅ')) {
					hasValidSign = true;
				}
			}
			if (!hasValidSign) {
				invalidSignatures.push(controller.sign ? controller.sign.text : 'undefined');
			}
		}
		if (invalidSignatures.length >= _.keys((Overmind as any).colonies).length * 0.5) {
			Memory.settings.signature = DEFAULT_OVERMIND_SIGNATURE;
			log.warning(`Invalid controller signatures detected:${bulleted(invalidSignatures)}${alignedNewline}Signatures must contain the string "Overmind" or ᴏᴠᴇʀᴍɪɴᴅ.`);
			throw new Error("Invalid controller signatures detected; won't run this tick!");
		}
	}

	static runRoomIntel_2(): void {
		if (MY_USERNAME == MUON || Assimilator.isAssimilated(MY_USERNAME)) {
			return;
		}
		let hasNoviceRoom = false;
		for (const name in Game.rooms) {
			const room = Game.rooms[name];
			if (room.controller && room.controller.owner && room.controller.my) {
				const roomStatus = (Game.map as any).getRoomStatus(room.name);
				if (roomStatus.status == 'novice') {
					hasNoviceRoom = true;
					break;
				}
			}
		}
		if (hasNoviceRoom) {
			const snarkyMessages = [
				'You might be missing the point of this game - most of the fun of the game is programming your own bot and watching your little ant farm run!',
				"Sure, Overmind might win you battles, but only your own code can win the hearts of your creeps. Don't let them down!",
				"Roses are red, violets are blue, Overmind's cool, but your code is too! Unleash your inner coder and show us what you've got!",
				"Coding your own Screeps AI is like brewing your own beer. Sure, store-bought is fine, but homemade? That's some good shit.",
				'WRITE YOUR OWN GODDAMN CODE',
				'If Overmind is the ready meal of Screeps, coding your own AI is the farm-to-table experience. Fresh, satisfying, rewarding!',
				'Sure, Overmind can play the game, but can it serenade your creeps under the moonlight? Time to code up some romance!',
				'Ditch the premade bot. Your creeps deserve an original hit, not a cover band!'
			];
			const index = _.random(snarkyMessages.length - 1);
			log.alert(snarkyMessages[index]);
			const bannedColors: ColorConstant[] = [COLOR_RED];
			const bannedColorPairs: ColorConstant[][] = [[COLOR_RED, COLOR_RED]];
			for (const name in Game.flags) {
				const flag = Game.flags[name];
				const colorPair = [flag.color, flag.secondaryColor];
				if (bannedColors.includes(flag.color) || (bannedColorPairs as any[]).includes(colorPair)) {
					flag.remove();
					log.warning(`Illegal directives detected and removed: ${flag.name}.`);
				}
			}
		}
	}

	static run(): void {
		this.runRoomIntel_1();
		if (Game.time % 30 == 0) {
			this.runRoomIntel_2();
		}
	}

}

interface VersionUpdaterMemory {
	versions: { [version: string]: any };
	newestVersion?: string;
}

class VersionUpdater {

	static CheckFrequency = 100;
	static CheckOnTick = 91;
	static VersionSegment = 99;

	static get memory(): VersionUpdaterMemory {
		return Mem.wrap(Memory.Overmind, 'versionUpdater', () => ({
			versions     : {},
			newestVersion: undefined,
		}));
	}

	static slave_fetchVersion(): string | undefined {
		if (Game.time % this.CheckFrequency == this.CheckOnTick - 1) {
			Segmenter.requestForeignSegment(MUON, this.VersionSegment);
		} else if (Game.time % this.CheckFrequency == this.CheckOnTick) {
			const foreignSegment = Segmenter.getForeignSegment();
			if (foreignSegment) {
				return foreignSegment.version;
			}
		}
	}

	static isVersionOutdated(version: string): boolean {
		const [major, minor, patch] = _.map(__VERSION__.split('.'), v => parseInt(v, 10));
		const [newMajor, newMinor, newPatch] = _.map(version.split('.'), v => parseInt(v, 10));
		return newMajor > major || newMinor > minor || newPatch > patch;
	}

	static master_pushVersion(): void {
		if (Game.time % this.CheckFrequency == this.CheckOnTick - 2) {
			Segmenter.requestSegments(this.VersionSegment);
		} else if (Game.time % this.CheckFrequency == this.CheckOnTick - 1) {
			Segmenter.markSegmentAsPublic(this.VersionSegment);
			Segmenter.setSegmentProperty(this.VersionSegment, 'version', __VERSION__);
		}
	}

	static generateUpdateMessage(currentVersion: string, newVersion: string): string {
		let msg = '\n';
		for (const line of asciiLogoSmall) {
			msg += line + '\n';
		}
		const downloadLink = '<a href="https://github.com/bencbartlett/Overmind/releases">Download</a>';
		const patchNotesLink = '<a href="https://github.com/bencbartlett/Overmind/blob/master/CHANGELOG.md">Patch notes</a>';
		const box = '╔═════════════════════════════════════════════════════════╗\n' +
					`║            Update available: ${currentVersion} → ${newVersion}              ║\n` +
					`║            > ${downloadLink} <    > ${patchNotesLink} <              ║\n` +
					'╚═════════════════════════════════════════════════════════╝';
		return msg + box;
	}

	static generateUpdateMessageSmall(currentVersion: string, newVersion: string): string {
		const downloadLink = '<a href="https://github.com/bencbartlett/Overmind/releases">Download</a>';
		const patchNotesLink = '<a href="https://github.com/bencbartlett/Overmind/blob/master/CHANGELOG.md">Patch notes</a>';
		const box = '╔═════════════════════════════════╗\n' +
					'║       OVERMIND SCREEPS AI       ║\n' +
					'╠═════════════════════════════════╣\n' +
					`║ Update available: ${currentVersion} → ${newVersion} ║\n` +
					`║ > ${downloadLink} <    > ${patchNotesLink} < ║\n` +
					'╚═════════════════════════════════╝';
		return '\n' + box;
	}

	static displayUpdateMessage(newVersion: string): void {
		const msg = this.generateUpdateMessage(__VERSION__, newVersion);
		console.log(`<font color='#ff00ff'>${msg}</font>`);
	}

	static sayUpdateMessage(newVersion?: string): void {
		for (const name in Game.creeps) {
			const creep = Game.creeps[name];
			creep.say('Update me!', true);
		}
	}

	static notifyNewVersion(newVersion: string): void {
		const msg = this.generateUpdateMessageSmall(__VERSION__, newVersion);
		Game.notify(`<font color='#ff00ff'>${msg}</font>`);
	}

	static run(): void {
		if (MY_USERNAME == MUON) {
			this.master_pushVersion();
		}
		const version = this.slave_fetchVersion();
		if (version) {
			this.memory.newestVersion = version;
		}
		const newestVersion = this.memory.newestVersion;
		if (newestVersion && this.isVersionOutdated(newestVersion)) {
			if (Game.time % 10 == 0) {
				this.displayUpdateMessage(newestVersion);
				this.sayUpdateMessage(newestVersion);
			}
			if (Game.time % 10000 == 0) {
				this.notifyNewVersion(newestVersion);
			}
		}
	}

}
