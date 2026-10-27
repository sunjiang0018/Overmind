//
// Assimilator: verifies the integrity of an Overmind codebase and coordinates the hivemind collective.
//
// Q: What is assimilation?
//
// A: Assimilation is a feature that allows all players running Overmind to act as a single, collective
//    hive mind, sharing creeps and resources between each other and responding jointly to a master ledger of all
//    directives across all colonies of all players. Assimilation is enabled by default, but you may opt out of it
//    if you wish. Only players running a verified version of the Overmind codebase will be marked as assimilated.
//
// Q: How does assimilation work and how do you verify the codebase?
//
// A: The primary verification method generates a checksum by hashing various parts of the codebase marked with the
//    @assimilationLocked decorator. Whenever Muon deploys code to the main server, a checksum for that version of the code
//    is generated and stored in a lookup table in memory along with recent previous hashes. If you are assimilated,
//    every 1000 ticks, Overmind will send 100 energy from one of your terminals to one of Muon's with a hash of the
//    current codebase as the description. If the hash matches that of a recent valid version, Muon replies on the following
//    tick with a unique clearance key valid for the next 1000 ticks transmitted through public memory. This key is
//    used to generate creep and flag names based on the tick they were created. Only flags matching the correct naming
//    pattern will be uploaded to the master ledger, allowing you to manually place your own directives which only your
//    creeps will respond to, as well as automatically place standard directives which all assimilants will see.
//

import { sha256 } from '../algorithms/sha256';
import { Segmenter, SEGMENTS } from '../memory/Segmenter';
import { MUON, MY_USERNAME } from '../~settings';

export interface AssimilatorMemory {
	masterLedger: { [directiveName: string]: any };
	clearanceCodes: { [username: string]: string | null };
	secret?: SecretAssimilatorMemory;
}

export interface SecretAssimilatorMemory {
	commands: { [username: string]: string };
	users: {
		[username: string]: {
			checksum: string;
			version: string;
			time: number;
		};
	};
	validChecksums: { [checksum: string]: number };
}

export interface PhoneHomePayload {
	U: string; // Username
	C: string; // Checksum
	V: string; // Version
}

const __lockedObjects__: any[] = [];
const lockedObjects: any[] = [];

const defaultAssimilatorMemory: AssimilatorMemory = {
	masterLedger: {},
	clearanceCodes: {}
};

const defaultSecretAssimilatorMemory: SecretAssimilatorMemory = {
	commands: {},
	users: {},
	validChecksums: {}
};

const TRUSTED_USERS: string[] = [MUON, 'Sarrick'];
const UNTRUSTED_USERS: string[] = ['Kokx'];
const ASSIMILATE_FREQUENCY = 1000;
const T = ASSIMILATE_FREQUENCY;
const CHECKSUM_MAX_AGE = 1000000;
const PHONE_HOME_HEADER = 'PHNHM:';

function alert(message: string): void {
	console.log(
		`<font color='yellow'>ALERT   </font><font color='gray'>${Game.time.toString()}</font>`,
		`<font color='#ff00ff'>${message} </font>`
	);
}

export default class Assimilator implements IAssimilator {

	constructor() {
		if (!Memory.assimilator) {
			Memory.assimilator = {};
		}
		_.defaultsDeep(Memory.assimilator, _.cloneDeep(defaultAssimilatorMemory));
		if (MY_USERNAME == MUON) {
			if (!Memory.assimilator.secret) {
				Memory.assimilator.secret = {};
			}
			_.defaultsDeep(Memory.assimilator.secret, _.cloneDeep(defaultSecretAssimilatorMemory));
		}
	}

	get memory(): AssimilatorMemory {
		return Memory.assimilator;
	}

	get secretMemory(): SecretAssimilatorMemory {
		return Memory.assimilator.secret!;
	}

	/**
	 * Registers an object or class for checksum validation
	 */
	validate(target: any): void {
		if (target.toString === Object.prototype.toString) {
			__lockedObjects__.push(target);
			lockedObjects.push(target);
		}
	}

	/**
	 * Generates a string hash token sequence from member call and instantiation patterns
	 */
	generateStringHash(codeStr: string, verbose = false): string {
		let tokens: string[] = [];
		const methodCalls = codeStr.match(/(\.[a-zA-Z]*\()/gm) || [];
		const constructorCalls = codeStr.match(/new [a-zA-Z]*\(/gm) || [];
		tokens = tokens.concat(methodCalls, constructorCalls);
		const hash = tokens.join('$');
		if (verbose) {
			console.log(hash);
		}
		return hash;
	}

	/**
	 * Computes a cumulative checksum of all registered @assimilationLocked code blocks
	 */
	generateChecksum(verbose = false): string {
		let checksum = 0;
		if (verbose) {
			console.log('Generating checksum for @assimilationLocked objects...');
		}
		for (const obj of lockedObjects) {
			const commentRegex = /\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm;
			let stringifiedCode = JSON.stringify('' + obj);
			stringifiedCode = stringifiedCode.replace(commentRegex, '');
			stringifiedCode = stringifiedCode.replace(/\s/gm, '');
			const hash = sha256(stringifiedCode);
			checksum += hash.reduce((acc, byte) => acc * 2 + byte);
			if (verbose) {
				console.log('Stringified code:');
				console.log(stringifiedCode);
				console.log('sha256 hash:');
				console.log(hash);
				console.log(`Partial checksum: ${checksum}`);
			}
		}
		const hexChecksum = '0x' + checksum.toString(16);
		if (verbose) {
			console.log(`Final checksum:     ${checksum}`);
			console.log(`Final hex checksum: ${hexChecksum}`);
		}
		return hexChecksum;
	}

	/**
	 * Checks if a user has a valid clearance code from Muon
	 */
	isAssimilated(username: string): boolean {
		if (!this.memory.clearanceCodes || !this.memory.clearanceCodes[MUON]) {
			return false;
		}
		return !!this.memory.clearanceCodes[username];
	}

	/**
	 * Returns the clearance code for a given user, or null if none
	 */
	getClearanceCode(username: string): string | null {
		return this.memory.clearanceCodes[username] || null;
	}

	/**
	 * Synchronizes clearance codes ledger from memory segment 98
	 */
	synchronizeClearanceCodeLedger(): void {
		let clearanceCodes: { [username: string]: string | null } | undefined;
		if (MY_USERNAME == MUON) {
			clearanceCodes = Segmenter.getSegmentProperty(SEGMENTS.assimilator, 'clearanceCodes');
		} else {
			clearanceCodes = Segmenter.getForeignSegmentProperty('clearanceCodes') || {};
		}
		if (clearanceCodes) {
			this.memory.clearanceCodes = clearanceCodes;
		}
	}

	/**
	 * Alerts the player with the new clearance code and expiration tick
	 */
	newClearanceCodeAlert(): void {
		const expiration = ASSIMILATE_FREQUENCY * Math.ceil(Game.time / ASSIMILATE_FREQUENCY) - 1;
		alert(`New clearance code obtained: ${this.getClearanceCode(MY_USERNAME)} (expiration: ${expiration})`);
	}

	/**
	 * Clears any pending scheduled commands for a specified user (master only)
	 */
	cancelCommand(username: string): string {
		delete this.secretMemory.commands[username];
		return `Command scheduled for execution by user ${username} have been cleared.`;
	}

	/**
	 * Registers a command for remote execution by a slave user on the next cycle (master only)
	 */
	registerCommand(username: string, command: string): string {
		this.secretMemory.commands[username] = command;
		const executionTick = Math.ceil(Game.time / ASSIMILATE_FREQUENCY) * ASSIMILATE_FREQUENCY - 1;
		return `Command registered for execution by user ${username}:\n${print(command)}\nScheduled for execution on tick ${executionTick}`;
	}

	/**
	 * Pushes scheduled commands to public segment memory and resets pending commands (master only)
	 */
	pushCommands_master(): void {
		const commands = _.cloneDeep(this.secretMemory.commands);
		Segmenter.setSegmentProperty(SEGMENTS.assimilator, 'commands', commands);
		this.secretMemory.commands = {};
	}

	/**
	 * Checks foreign segment memory for commands directed to this user and evaluates them (slave only)
	 */
	executeCommands_slave(): void {
		const commands = Segmenter.getForeignSegmentProperty('commands') || {};
		const command = commands[MY_USERNAME];
		if (command) {
			eval(command);
		}
	}

	/**
	 * Updates valid checksum ledger
	 */
	updateValidChecksumLedger(): void {
		this.updateValidChecksums_master();
	}

	/**
	 * Master: records current checksum and expires entries older than CHECKSUM_MAX_AGE ticks
	 */
	updateValidChecksums_master(): void {
		const checksum = this.generateChecksum();
		this.secretMemory.validChecksums[checksum] = Game.time;
		for (const key in this.secretMemory.validChecksums) {
			if (this.secretMemory.validChecksums[key] < Game.time - CHECKSUM_MAX_AGE) {
				delete this.secretMemory.validChecksums[key];
			}
		}
	}

	/**
	 * Master: inspects incoming terminal energy transfers for phone-home heartbeat messages
	 */
	updateUserChecksums_master(): void {
		for (const transaction of Game.market.incomingTransactions) {
			if (transaction.time == Game.time - 1 && transaction.description && transaction.description.includes(PHONE_HOME_HEADER)) {
				try {
					const data: PhoneHomePayload = JSON.parse(_.last(transaction.description.split(PHONE_HOME_HEADER)) as string);
					const username = data.U || '';
					const checksum = data.C || '';
					const version = data.V || '';
					if (username && username != '') {
						this.secretMemory.users[username] = {
							checksum: checksum,
							version : version,
							time    : transaction.time
						};
					}
				} catch (e) {
					console.log(`Unable to parse phone home message ${transaction.description}. Error: ${e}`);
				}
			}
		}
		this.secretMemory.users[MUON] = {
			checksum: this.generateChecksum(),
			version : __VERSION__,
			time    : Game.time
		};
	}

	/**
	 * Master: generates a clearance code for a user using sha256 hash of username, checksum, and tick
	 */
	generateClearanceCode_master(username: string, checksum: string, time: number): string | null {
		if (UNTRUSTED_USERS.includes(username)) {
			return null;
		}
		if (!this.secretMemory.validChecksums[checksum] && !TRUSTED_USERS.includes(username)) {
			return null;
		}
		const hashValue = sha256('U' + username + 'C' + checksum + 'T' + time).reduce((acc, byte) => acc * 2 + byte);
		return '0x' + hashValue.toString(16);
	}

	/**
	 * Master: computes clearance codes for all users and updates segment memory
	 */
	updateClearanceCodeLedger_master(): void {
		const ledger: { [username: string]: string | null } = {};
		for (const username in this.secretMemory.users) {
			const checksum = this.secretMemory.users[username].checksum;
			const time = ASSIMILATE_FREQUENCY * Math.ceil(Game.time / ASSIMILATE_FREQUENCY);
			ledger[username] = this.generateClearanceCode_master(username, checksum, time);
		}
		Segmenter.setSegmentProperty(SEGMENTS.assimilator, 'clearanceCodes', ledger);
	}

	/**
	 * Slave: transmits codebase checksum and version to Muon via 100-energy terminal transfer
	 */
	transmitUserData_slave(): void {
		const foreignSegment = Segmenter.getForeignSegment();
		if (foreignSegment) {
			const targetRoom = _.first(_.sample(foreignSegment.colonies, 1)) as string | undefined;
			if (targetRoom) {
				const terminals = _.compact(_.map(_.values(Overmind.colonies), (colony: any) => colony.terminal));
				const readyTerminal = _.sample(_.filter(terminals, (terminal: any) => terminal.isReady));
				if (readyTerminal) {
					const payload: PhoneHomePayload = {
						U: MY_USERNAME,
						C: this.generateChecksum(),
						V: __VERSION__
					};
					const message = PHONE_HOME_HEADER + JSON.stringify(payload);
					readyTerminal.send(RESOURCE_ENERGY, TERMINAL_MIN_SEND, targetRoom, message);
				}
			}
		}
	}

	/**
	 * Master execution sequence for periodic assimilation protocol
	 */
	run_master(): void {
		switch (Game.time % ASSIMILATE_FREQUENCY) {
			case T - 8:
				this.updateValidChecksums_master();
				break;
			case T - 7:
				Segmenter.requestSegments(SEGMENTS.assimilator);
				break;
			case T - 6:
				const terminals = _.compact(_.map(_.values(Overmind.colonies), (colony: any) => colony.terminal));
				const colonyRoomNames = _.map(terminals, (terminal: any) => terminal.room.name);
				Segmenter.setSegmentProperty(SEGMENTS.assimilator, 'colonies', colonyRoomNames);
				Segmenter.markSegmentAsPublic(SEGMENTS.assimilator);
				break;
			case T - 5:
				break;
			case T - 4:
				this.updateUserChecksums_master();
				break;
			case T - 3:
				Segmenter.requestSegments(SEGMENTS.assimilator);
				break;
			case T - 2:
				Segmenter.requestSegments(SEGMENTS.assimilator);
				this.updateClearanceCodeLedger_master();
				this.pushCommands_master();
				break;
			case T - 1:
				this.synchronizeClearanceCodeLedger();
				break;
			case 0:
				this.newClearanceCodeAlert();
				break;
			default:
				break;
		}
	}

	/**
	 * Slave execution sequence for periodic assimilation protocol
	 */
	run_slave(): void {
		switch (Game.time % ASSIMILATE_FREQUENCY) {
			case T - 6:
				Segmenter.requestForeignSegment(MUON, SEGMENTS.assimilator);
				break;
			case T - 5:
				this.transmitUserData_slave();
				break;
			case T - 4:
				break;
			case T - 3:
				break;
			case T - 2:
				Segmenter.requestForeignSegment(MUON, SEGMENTS.assimilator);
				break;
			case T - 1:
				this.synchronizeClearanceCodeLedger();
				this.executeCommands_slave();
				break;
			case 0:
				this.newClearanceCodeAlert();
				break;
			default:
				break;
		}
	}

	/**
	 * Main loop run handler, called every tick
	 */
	run(): void {
		if (MY_USERNAME == MUON) {
			this.run_master();
		} else {
			this.run_slave();
		}
	}

}
