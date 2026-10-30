import {profile} from '../../profiler/decorator';
import {Directive} from '../Directive';
import {defaultsDeep} from '../../utilities/native';


interface DirectiveEmptyMemory extends FlagMemory {

}

const getDefaultDirectiveEmptyMemory: () => DirectiveEmptyMemory = () => ({});


/**
 * DOCUMENTATION GOES HERE
 */
@profile
export class DirectiveEmpty extends Directive {

	static directiveName = 'empty';
	static color = COLOR_BROWN;
	static secondaryColor = COLOR_BROWN;

	memory: DirectiveEmptyMemory;

	overlords: {
		// TODO
	};

	constructor(flag: Flag) {
		super(flag);
		defaultsDeep(this.memory, getDefaultDirectiveEmptyMemory());
		this.refresh();
		// TODO
	}

	refresh(): void {
		super.refresh();
		// TODO
	}

	spawnMoarOverlords(): void {
		// TODO
	}

	init(): void {

	}

	run(): void {

	}

}
