
//
// ___________________________________________________________
//
//  _____  _    _ _______  ______ _______ _____ __   _ ______
// |     |  \  /  |______ |_____/ |  |  |   |   | \  | |     \
// |_____|   \/   |______ |    \_ |  |  | __|__ |  \_| |_____/
//
// _______________________ Screeps AI ________________________
//
//
// Overmind repository: github.com/bencbartlett/overmind
//


// @formatter:off
/* tslint:disable:ordered-imports */

'use strict';
global.PHASE = 'assimilating';
global.LATEST_BUILD_TICK = Game.time;
// Import ALL the things! ==============================================================================================
import './assimilation/initializer'; // This must always be imported before anything else
import './console/globals'; // Global functions accessible from CLI
import './tasks/initializer'; // This line is necessary to ensure proper compilation ordering...
import './zerg/CombatZerg'; // Initialize base classes before modules that extend them.
import {MUON, MY_USERNAME, RL_TRAINING_MODE, USE_SCREEPS_PROFILER} from './~settings';
import {sandbox} from './utilities/sandbox';
import {Mem} from './memory/Memory';
import {OvermindConsole} from './console/Console';
import {Stats} from './stats/stats';
import profiler from './profiler/screeps-profiler';
import _Overmind from './Overmind';
import {VersionMigration} from './versionMigration/migrator';
import {RemoteDebugger} from './debug/remoteDebugger';
import {ActionParser} from './reinforcementLearning/actionParser';
import {generatePixelIfFull} from './utilities/pixels';
// =====================================================================================================================

// Main loop
function main(): void {

	// Memory operations: load and clean memory, suspend operation as needed -------------------------------------------
	Mem.load();									// Load previous parsed memory if present
	if (!Mem.shouldRun()) return;				// Suspend operation if necessary
	Mem.clean();								// Clean memory contents

	// Instantiation operations: build or refresh the game state -------------------------------------------------------
	if (!Overmind || Overmind.shouldBuild || Game.time >= Overmind.expiration) {
		PHASE = 'build';
		delete global.Overmind;					// Explicitly delete the old Overmind object
		Mem.garbageCollect(true);			// Run quick garbage collection
		global.Overmind = new _Overmind();		// Instantiate the Overmind object
		Overmind.build();						// Build phase: instantiate all game components
		LATEST_BUILD_TICK = Game.time;			// Record this tick as having a build reset
	} else {
		PHASE = 'refresh';
		Overmind.refresh();						// Refresh phase: update the Overmind state
	}

	// Tick loop cycle: initialize and run each component --------------------------------------------------------------
	PHASE = 'init';
	Overmind.init();							// Init phase: spawning and energy requests
	PHASE = 'run';
	Overmind.run();								// Run phase: execute state-changing actions
	PHASE = 'postRun';
	Overmind.visuals(); 						// Draw visuals
	Stats.run(); 								// Record statistics
	Memory.tick++;								// Record successful tick

	// Post-run code: handle sandbox code and error catching -----------------------------------------------------------
	sandbox();									// Sandbox: run any testing code
	global.remoteDebugger.run();				// Run remote debugger code if enabled
	Overmind.postRun();							// Throw errors at end of tick; anything after here might not get run
	generatePixelIfFull();						// Spend a full bucket after successful colony operation
}

// Main loop if RL mode is enabled (~settings.ts)
function main_RL(): void {
	Mem.clean();

	delete global.Overmind;
	global.Overmind = new _Overmind();

	ActionParser.run();
}

// This gets run on each global reset
function onGlobalReset(): void {
	global.LATEST_GLOBAL_RESET_TICK = Game.time;
	global.LATEST_GLOBAL_RESET_DATE = new Date();
	if (USE_SCREEPS_PROFILER) profiler.enable();
	Mem.format();
	OvermindConsole.init();
	VersionMigration.run();
	Memory.stats.persistent.lastGlobalReset = Game.time;
	OvermindConsole.printUpdateMessage();
	// Make a new Overmind object
	global.Overmind = new _Overmind();
	// Make a remote debugger
	global.remoteDebugger = new RemoteDebugger();
}


// Global reset function if RL mode is enabled
function onGlobalReset_RL(): void {
	Mem.format();
}

// Decide which loop to export as the script loop
let _loop: () => void;
if (RL_TRAINING_MODE) {
	// Use stripped version for training reinforcment learning model
	_loop = main_RL;
} else {
	if (USE_SCREEPS_PROFILER) {
		// Wrap the main loop in the profiler
		_loop = () => profiler.wrap(main);
	} else {
		// Use the default main loop
		_loop = main;
	}
}

export const loop = _loop;

// Run the appropriate global reset function
if (RL_TRAINING_MODE) {
	OvermindConsole.printTrainingMessage();
	onGlobalReset_RL();
} else {
	// Run the global reset code
	onGlobalReset();
}


