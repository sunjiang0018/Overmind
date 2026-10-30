import {createTickCache} from './cache';
import {defaults} from '../utilities/native';

// The renderer accepts false to disable strokes; keep the legacy payload despite the narrower API types.
const NO_STROKE = false as unknown as string;

const getVisualRoads = createTickCache<RoomVisual, [number, number][]>(() => []);

export function roomVisualInfoBox(
	visual: RoomVisual,
	info: string[],
	x: number,
	y: number,
	opts: { [option: string]: any } = {}
): RoomVisual {
	defaults(opts, {
		color    : colors.infoBoxGood,
		textstyle: false,
		textsize : speechSize,
		textfont : 'verdana',
		opacity  : 0.7,
	});

	let fontstring = '';
	if (opts.textstyle) {
		fontstring = opts.textstyle + ' ';
	}
	fontstring += opts.textsize + ' ' + opts.textfont;

	let pointer: [number, number][] = [
		[.9, -0.25],
		[.9, 0.25],
		[0.3, 0.0],
	];
	pointer = relPoly(x, y, pointer);
	pointer.push(pointer[0]);

	// Draw arrow
	visual.poly(pointer, {
		fill       : undefined,
		stroke     : opts.color,
		opacity    : opts.opacity,
		strokeWidth: 0.0
	});

	// // Draw box
	// this.rect(x + 0.9, y - 0.8 * opts.textsize,
	// 	0.55 * opts.textsize * _.max(_.map(info, line => line.length)), info.length * opts.textsize,
	// 	{
	// 		fill   : undefined,
	// 		opacity: opts.opacity
	// 	});

	// Draw vertical bar
	const x0 = x + 0.9;
	const y0 = y - 0.8 * opts.textsize;
	visual.line(x0, y0, x0, y0 + info.length * opts.textsize, {
		color: opts.color,
	});

	// Draw text
	let dy = 0;
	for (const line of info) {
		visual.text(line, x + 1, y + dy, {
			color            : opts.color,
			// backgroundColor  : opts.background,
			backgroundPadding: 0.1,
			opacity          : opts.opacity,
			font             : fontstring,
			align            : 'left',
		});
		dy += opts.textsize;
	}

	return visual;
}

export function roomVisualMultitext(
	visual: RoomVisual,
	textLines: string[],
	x: number,
	y: number,
	opts: { [option: string]: any } = {}
): RoomVisual {
	defaults(opts, {
		color    : colors.infoBoxGood,
		textstyle: false,
		textsize : speechSize,
		textfont : 'verdana',
		opacity  : 0.7,
	});

	let fontstring = '';
	if (opts.textstyle) {
		fontstring = opts.textstyle + ' ';
	}
	fontstring += opts.textsize + ' ' + opts.textfont;

	// // Draw vertical bar
	// let x0 = x + 0.9;
	// let y0 = y - 0.8 * opts.textsize;
	// this.line(x0, y0, x0, y0 + textLines.length * opts.textsize, {
	// 	color: opts.color,
	// });

	// Draw text
	let dy = 0;
	for (const line of textLines) {
		visual.text(line, x, y + dy, {
			color            : opts.color,
			// backgroundColor  : opts.background,
			backgroundPadding: 0.1,
			opacity          : opts.opacity,
			font             : fontstring,
			align            : 'left',
		});
		dy += opts.textsize;
	}

	return visual;
}

export function roomVisualBox(
	visual: RoomVisual,
	x: number,
	y: number,
	w: number,
	h: number,
	style?: LineStyle
): RoomVisual {
	const polyStyle: PolyStyle = {
		stroke     : style?.color,
		strokeWidth: style?.width,
		opacity    : style?.opacity,
		lineStyle  : style?.lineStyle,
		fill       : undefined,
	};
	return visual.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], polyStyle);
}

// Taken from https://github.com/screepers/RoomVisual with slight modification: ========================================

const colors = {
	gray            : '#555555',
	light           : '#AAAAAA',
	road            : '#666', // >:D
	energy          : '#FFE87B',
	power           : '#F53547',
	dark            : '#181818',
	outline         : '#8FBB93',
	speechText      : '#000000',
	speechBackground: '#aebcc4',
	infoBoxGood     : '#09ff00',
	infoBoxBad      : '#ff2600'
};

const speechSize = 0.5;
const speechFont = 'Times New Roman';

export function roomVisualStructure(
	visual: RoomVisual,
	x: number,
	y: number,
	type: string,
	opts: { [option: string]: any } = {}
): RoomVisual {
	defaults(opts, {opacity: 0.5});
	switch (type) {
		case STRUCTURE_EXTENSION:
			visual.circle(x, y, {
				radius     : 0.5,
				fill       : colors.dark,
				stroke     : colors.outline,
				strokeWidth: 0.05,
				opacity    : opts.opacity
			});
			visual.circle(x, y, {
				radius : 0.35,
				fill   : colors.gray,
				opacity: opts.opacity
			});
			break;
		case STRUCTURE_SPAWN:
			visual.circle(x, y, {
				radius     : 0.65,
				fill       : colors.dark,
				stroke     : '#CCCCCC',
				strokeWidth: 0.10,
				opacity    : opts.opacity
			});
			visual.circle(x, y, {
				radius : 0.40,
				fill   : colors.energy,
				opacity: opts.opacity
			});

			break;
		case STRUCTURE_POWER_SPAWN:
			visual.circle(x, y, {
				radius     : 0.65,
				fill       : colors.dark,
				stroke     : colors.power,
				strokeWidth: 0.10,
				opacity    : opts.opacity
			});
			visual.circle(x, y, {
				radius : 0.40,
				fill   : colors.energy,
				opacity: opts.opacity
			});
			break;
		case STRUCTURE_LINK: {
			// let osize = 0.3;
			// let isize = 0.2;
			let outer: [number, number][] = [
				[0.0, -0.5],
				[0.4, 0.0],
				[0.0, 0.5],
				[-0.4, 0.0]
			];
			let inner: [number, number][] = [
				[0.0, -0.3],
				[0.25, 0.0],
				[0.0, 0.3],
				[-0.25, 0.0]
			];
			outer = relPoly(x, y, outer);
			inner = relPoly(x, y, inner);
			outer.push(outer[0]);
			inner.push(inner[0]);
			visual.poly(outer, {
				fill       : colors.dark,
				stroke     : colors.outline,
				strokeWidth: 0.05,
				opacity    : opts.opacity
			});
			visual.poly(inner, {
				fill   : colors.gray,
				stroke: NO_STROKE,
				opacity: opts.opacity
			});
			break;
		}
		case STRUCTURE_TERMINAL: {
			let outer: [number, number][] = [
				[0.0, -0.8],
				[0.55, -0.55],
				[0.8, 0.0],
				[0.55, 0.55],
				[0.0, 0.8],
				[-0.55, 0.55],
				[-0.8, 0.0],
				[-0.55, -0.55],
			];
			let inner: [number, number][] = [
				[0.0, -0.65],
				[0.45, -0.45],
				[0.65, 0.0],
				[0.45, 0.45],
				[0.0, 0.65],
				[-0.45, 0.45],
				[-0.65, 0.0],
				[-0.45, -0.45],
			];
			outer = relPoly(x, y, outer);
			inner = relPoly(x, y, inner);
			outer.push(outer[0]);
			inner.push(inner[0]);
			visual.poly(outer, {
				fill       : colors.dark,
				stroke     : colors.outline,
				strokeWidth: 0.05,
				opacity    : opts.opacity
			});
			visual.poly(inner, {
				fill   : colors.light,
				stroke: NO_STROKE,
				opacity: opts.opacity
			});
			visual.rect(x - 0.45, y - 0.45, 0.9, 0.9, {
				fill       : colors.gray,
				stroke     : colors.dark,
				strokeWidth: 0.1,
				opacity    : opts.opacity
			});
			break;
		}
		case STRUCTURE_LAB:
			visual.circle(x, y - 0.025, {
				radius     : 0.55,
				fill       : colors.dark,
				stroke     : colors.outline,
				strokeWidth: 0.05,
				opacity    : opts.opacity
			});
			visual.circle(x, y - 0.025, {
				radius : 0.40,
				fill   : colors.gray,
				opacity: opts.opacity
			});
			visual.rect(x - 0.45, y + 0.3, 0.9, 0.25, {
				fill   : colors.dark,
				stroke: NO_STROKE,
				opacity: opts.opacity
			});
		{
			let box: [number, number][] = [
				[-0.45, 0.3],
				[-0.45, 0.55],
				[0.45, 0.55],
				[0.45, 0.3],
			];
			box = relPoly(x, y, box);
			visual.poly(box, {
				stroke     : colors.outline,
				strokeWidth: 0.05,
				opacity    : opts.opacity
			});
		}
			break;
		case STRUCTURE_TOWER:
			visual.circle(x, y, {
				radius     : 0.6,
				fill       : colors.dark,
				stroke     : colors.outline,
				strokeWidth: 0.05,
				opacity    : opts.opacity
			});
			visual.rect(x - 0.4, y - 0.3, 0.8, 0.6, {
				fill   : colors.gray,
				opacity: opts.opacity
			});
			visual.rect(x - 0.2, y - 0.9, 0.4, 0.5, {
				fill       : colors.light,
				stroke     : colors.dark,
				strokeWidth: 0.07,
				opacity    : opts.opacity
			});
			break;
		case STRUCTURE_ROAD:
			visual.circle(x, y, {
				radius : 0.175,
				fill   : colors.road,
				stroke: NO_STROKE,
				opacity: opts.opacity
			});
			getVisualRoads(visual).push([x, y]);
			break;
		case STRUCTURE_RAMPART:
			visual.circle(x, y, {
				radius     : 0.65,
				fill       : '#434C43',
				stroke     : '#5D735F',
				strokeWidth: 0.10,
				opacity    : opts.opacity
			});
			break;
		case STRUCTURE_WALL:
			visual.circle(x, y, {
				radius     : 0.40,
				fill       : colors.dark,
				stroke     : colors.light,
				strokeWidth: 0.05,
				opacity    : opts.opacity
			});
			break;
		case STRUCTURE_STORAGE:
			const storageOutline = relPoly(x, y, [
				[-0.45, -0.55],
				[0, -0.65],
				[0.45, -0.55],
				[0.55, 0],
				[0.45, 0.55],
				[0, 0.65],
				[-0.45, 0.55],
				[-0.55, 0],
				[-0.45, -0.55],
			]);
			visual.poly(storageOutline, {
				stroke     : colors.outline,
				strokeWidth: 0.05,
				fill       : colors.dark,
				opacity    : opts.opacity
			});
			visual.rect(x - 0.35, y - 0.45, 0.7, 0.9, {
				fill   : colors.energy,
				opacity: opts.opacity,
			});
			break;
		case STRUCTURE_OBSERVER:
			visual.circle(x, y, {
				fill       : colors.dark,
				radius     : 0.45,
				stroke     : colors.outline,
				strokeWidth: 0.05,
				opacity    : opts.opacity
			});
			visual.circle(x + 0.225, y, {
				fill   : colors.outline,
				radius : 0.20,
				opacity: opts.opacity
			});
			break;
		case STRUCTURE_NUKER:
			let outline: [number, number][] = [
				[0, -1],
				[-0.47, 0.2],
				[-0.5, 0.5],
				[0.5, 0.5],
				[0.47, 0.2],
				[0, -1],
			];
			outline = relPoly(x, y, outline);
			visual.poly(outline, {
				stroke     : colors.outline,
				strokeWidth: 0.05,
				fill       : colors.dark,
				opacity    : opts.opacity
			});
			let inline: [number, number][] = [
				[0, -.80],
				[-0.40, 0.2],
				[0.40, 0.2],
				[0, -.80],
			];
			inline = relPoly(x, y, inline);
			visual.poly(inline, {
				stroke     : colors.outline,
				strokeWidth: 0.01,
				fill       : colors.gray,
				opacity    : opts.opacity
			});
			break;
		case STRUCTURE_CONTAINER:
			visual.rect(x - 0.225, y - 0.3, 0.45, 0.6, {
				fill       : 'yellow',
				opacity    : opts.opacity,
				stroke     : colors.dark,
				strokeWidth: 0.10,
			});
			break;
		default:
			visual.circle(x, y, {
				fill       : colors.light,
				radius     : 0.35,
				stroke     : colors.dark,
				strokeWidth: 0.20,
				opacity    : opts.opacity
			});
			break;
	}

	return visual;
}

const dirs = [
	[],
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1]
];

export function roomVisualConnectRoads(visual: RoomVisual, opts: { [option: string]: any } = {}): RoomVisual | void {
	defaults(opts, {opacity: 0.5});
	const color = opts.color || colors.road || 'white';
	const roads = getVisualRoads(visual);
	if (roads.length === 0) return visual;
	const roadSet = new Set<number>();
	for (const r of roads) {
		roadSet.add(r[0] * 50 + r[1]);
	}
	for (const r of roads) {
		for (let i = 1; i <= 4; i++) {
			const d = dirs[i];
			if (roadSet.has((r[0] + d[0]) * 50 + (r[1] + d[1]))) {
				visual.line(r[0], r[1], r[0] + d[0], r[1] + d[1], {
					color  : color,
					width  : 0.35,
					opacity: opts.opacity
				});
			}
		}
	}

	return visual;
}

export function roomVisualSpeech(
	visual: RoomVisual,
	text: string,
	x: number,
	y: number,
	opts: { [option: string]: any } = {}
): RoomVisual {
	const background = !!opts.background ? opts.background : colors.speechBackground;
	const textcolor = !!opts.textcolor ? opts.textcolor : colors.speechText;
	// noinspection PointlessBooleanExpressionJS
	const textstyle = !!opts.textstyle ? opts.textstyle : false;
	const textsize = !!opts.textsize ? opts.textsize : speechSize;
	const textfont = !!opts.textfont ? opts.textfont : speechFont;
	const opacity = !!opts.opacity ? opts.opacity : 1;

	let fontstring = '';
	if (textstyle) {
		fontstring = textstyle + ' ';
	}
	fontstring += textsize + ' ' + textfont;

	let pointer: [number, number][] = [
		[-0.2, -0.8],
		[0.2, -0.8],
		[0, -0.3]
	];
	pointer = relPoly(x, y, pointer);
	pointer.push(pointer[0]);

	visual.poly(pointer, {
		fill       : background,
		stroke     : background,
		opacity    : opacity,
		strokeWidth: 0.0
	});

	visual.text(text, x, y - 1, {
		color            : textcolor,
		backgroundColor  : background,
		backgroundPadding: 0.1,
		opacity          : opacity,
		font             : fontstring
	});

	return visual;
}

export function roomVisualAnimatedPosition(
	visual: RoomVisual,
	x: number,
	y: number,
	opts: { [option: string]: any } = {}
): RoomVisual {

	const color = !!opts.color ? opts.color : 'blue';
	const opacity = !!opts.opacity ? opts.opacity : 0.5;
	let radius = !!opts.radius ? opts.radius : 0.75;
	const frames = !!opts.frames ? opts.frames : 6;

	const angle = (Game.time % frames * 90 / frames) * (Math.PI / 180);
	const s = Math.sin(angle);
	const c = Math.cos(angle);

	const sizeMod = Math.abs(Game.time % frames - frames / 2) / 10;
	radius += radius * sizeMod;

	const points = [
		rotate(0, -radius, s, c, x, y),
		rotate(radius, 0, s, c, x, y),
		rotate(0, radius, s, c, x, y),
		rotate(-radius, 0, s, c, x, y),
		rotate(0, -radius, s, c, x, y),
	];

	// The renderer accepts coordinate objects; ambient types only list RoomPosition and tuples.
	visual.poly(points as RoomPosition[], {stroke: color, opacity: opacity});

	return visual;
}

function rotate(x: number, y: number, s: number, c: number, px: number, py: number): Coord {
	const xDelta = x * c - y * s;
	const yDelta = x * s + y * c;
	return {x: px + xDelta, y: py + yDelta};
}

function relPoly(x: number, y: number, poly: [number, number][]): [number, number][] {
	return poly.map(([px, py]) => [px + x, py + y]);
}

export function roomVisualTest(visual: RoomVisual): RoomVisual {
	const demopos = [19, 24];
	visual.clear();
	roomVisualStructure(visual, demopos[0] + 0, demopos[1] + 0, STRUCTURE_LAB);
	roomVisualStructure(visual, demopos[0] + 1, demopos[1] + 1, STRUCTURE_TOWER);
	roomVisualStructure(visual, demopos[0] + 2, demopos[1] + 0, STRUCTURE_LINK);
	roomVisualStructure(visual, demopos[0] + 3, demopos[1] + 1, STRUCTURE_TERMINAL);
	roomVisualStructure(visual, demopos[0] + 4, demopos[1] + 0, STRUCTURE_EXTENSION);
	roomVisualStructure(visual, demopos[0] + 5, demopos[1] + 1, STRUCTURE_SPAWN);

	roomVisualAnimatedPosition(visual, demopos[0] + 7, demopos[1]);

	roomVisualSpeech(visual, 'This is a test!', demopos[0] + 10, demopos[1], {opacity: 0.7});

	// this.infoBox(['This is', 'a test', 'mmmmmmmmmmmmm'], demopos[0] + 15, demopos[1]);

	return visual;
}

const ColorSets: { [color: string]: [string, string] } = {
	white : ['#ffffff', '#4c4c4c'],
	grey  : ['#b4b4b4', '#4c4c4c'],
	red   : ['#ff7b7b', '#592121'],
	yellow: ['#fdd388', '#5d4c2e'],
	green : ['#00f4a2', '#236144'],
	blue  : ['#50d7f9', '#006181'],
	purple: ['#a071ff', '#371383'],
};

const ResourceColors: { [color: string]: [string, string] } = {
	[RESOURCE_ENERGY]: ColorSets.yellow,
	[RESOURCE_POWER] : ColorSets.red,

	[RESOURCE_HYDROGEN] : ColorSets.grey,
	[RESOURCE_OXYGEN]   : ColorSets.grey,
	[RESOURCE_UTRIUM]   : ColorSets.blue,
	[RESOURCE_LEMERGIUM]: ColorSets.green,
	[RESOURCE_KEANIUM]  : ColorSets.purple,
	[RESOURCE_ZYNTHIUM] : ColorSets.yellow,
	[RESOURCE_CATALYST] : ColorSets.red,
	[RESOURCE_GHODIUM]  : ColorSets.white,

	[RESOURCE_HYDROXIDE]       : ColorSets.grey,
	[RESOURCE_ZYNTHIUM_KEANITE]: ColorSets.grey,
	[RESOURCE_UTRIUM_LEMERGITE]: ColorSets.grey,

	[RESOURCE_UTRIUM_HYDRIDE]   : ColorSets.blue,
	[RESOURCE_UTRIUM_OXIDE]     : ColorSets.blue,
	[RESOURCE_KEANIUM_HYDRIDE]  : ColorSets.purple,
	[RESOURCE_KEANIUM_OXIDE]    : ColorSets.purple,
	[RESOURCE_LEMERGIUM_HYDRIDE]: ColorSets.green,
	[RESOURCE_LEMERGIUM_OXIDE]  : ColorSets.green,
	[RESOURCE_ZYNTHIUM_HYDRIDE] : ColorSets.yellow,
	[RESOURCE_ZYNTHIUM_OXIDE]   : ColorSets.yellow,
	[RESOURCE_GHODIUM_HYDRIDE]  : ColorSets.white,
	[RESOURCE_GHODIUM_OXIDE]    : ColorSets.white,

	[RESOURCE_UTRIUM_ACID]       : ColorSets.blue,
	[RESOURCE_UTRIUM_ALKALIDE]   : ColorSets.blue,
	[RESOURCE_KEANIUM_ACID]      : ColorSets.purple,
	[RESOURCE_KEANIUM_ALKALIDE]  : ColorSets.purple,
	[RESOURCE_LEMERGIUM_ACID]    : ColorSets.green,
	[RESOURCE_LEMERGIUM_ALKALIDE]: ColorSets.green,
	[RESOURCE_ZYNTHIUM_ACID]     : ColorSets.yellow,
	[RESOURCE_ZYNTHIUM_ALKALIDE] : ColorSets.yellow,
	[RESOURCE_GHODIUM_ACID]      : ColorSets.white,
	[RESOURCE_GHODIUM_ALKALIDE]  : ColorSets.white,

	[RESOURCE_CATALYZED_UTRIUM_ACID]       : ColorSets.blue,
	[RESOURCE_CATALYZED_UTRIUM_ALKALIDE]   : ColorSets.blue,
	[RESOURCE_CATALYZED_KEANIUM_ACID]      : ColorSets.purple,
	[RESOURCE_CATALYZED_KEANIUM_ALKALIDE]  : ColorSets.purple,
	[RESOURCE_CATALYZED_LEMERGIUM_ACID]    : ColorSets.green,
	[RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: ColorSets.green,
	[RESOURCE_CATALYZED_ZYNTHIUM_ACID]     : ColorSets.yellow,
	[RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE] : ColorSets.yellow,
	[RESOURCE_CATALYZED_GHODIUM_ACID]      : ColorSets.white,
	[RESOURCE_CATALYZED_GHODIUM_ALKALIDE]  : ColorSets.white,
};

export function roomVisualResource(
	visual: RoomVisual,
	type: ResourceConstant,
	x: number,
	y: number,
	size = 0.25,
	opacity = 1
): number {
	if (type == RESOURCE_ENERGY || type == RESOURCE_POWER) {
		roomVisualFluid(visual, type, x, y, size, opacity);
	} else if ((<string[]>[RESOURCE_CATALYST, RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_LEMERGIUM, RESOURCE_UTRIUM,
						   RESOURCE_ZYNTHIUM, RESOURCE_KEANIUM])
		.includes(type)) {
		roomVisualMineral(visual, type, x, y, size, opacity);
	} else if (ResourceColors[type] != undefined) {
		roomVisualCompound(visual, type, x, y, size, opacity);
	} else {
		return ERR_INVALID_ARGS;
	}
	return OK;
}

export function roomVisualFluid(visual: RoomVisual, type: string, x: number, y: number, size = 0.25, opacity = 1): void {
	visual.circle(x, y, {
		radius : size,
		fill   : ResourceColors[type][0],
		opacity: opacity,
	});
	visual.text(type[0], x, y - (size * 0.1), {
		font             : (size * 1.5),
		color            : ResourceColors[type][1],
		backgroundColor  : ResourceColors[type][0],
		backgroundPadding: 0,
		opacity          : opacity
	});
}

export function roomVisualMineral(
	visual: RoomVisual,
	type: string,
	x: number,
	y: number,
	size = 0.25,
	opacity = 1
): void {
	visual.circle(x, y, {
		radius : size,
		fill   : ResourceColors[type][0],
		opacity: opacity,
	});
	visual.circle(x, y, {
		radius : size * 0.8,
		fill   : ResourceColors[type][1],
		opacity: opacity,
	});
	visual.text(type, x, y + (size * 0.03), {
		font             : 'bold ' + (size * 1.25) + ' arial',
		color            : ResourceColors[type][0],
		backgroundColor  : ResourceColors[type][1],
		backgroundPadding: 0,
		opacity          : opacity
	});
}

export function roomVisualCompound(
	visual: RoomVisual,
	type: string,
	x: number,
	y: number,
	size = 0.25,
	opacity = 1
): void {
	const label = type.replace('2', '₂');

	visual.text(label, x, y, {
		font             : 'bold ' + (size * 1) + ' arial',
		color            : ResourceColors[type][1],
		backgroundColor  : ResourceColors[type][0],
		backgroundPadding: 0.3 * size,
		opacity          : opacity
	});
}
