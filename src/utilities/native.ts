/* tslint:disable:prefer-for-of */
/* tslint:disable:no-bitwise */
// High-performance native replacements for the Lodash 3 helpers used by this project.
// Only the shapes this codebase actually uses are supported: arrays, Screeps store-like
// dictionaries, and plain option/memory objects. No Lodash iteratee shorthands or chain wrappers.

type Dictionary<T> = { readonly [key: string]: T };

function isArrayLike(value: any): value is ArrayLike<any> {
	return Array.isArray(value) || (value != null && typeof value !== 'function' && typeof value.length === 'number');
}

/** Sums array values or dictionary values, optionally mapping each element first. */
export function sum(values: ArrayLike<number> | Dictionary<number | undefined> | object | null | undefined): number;
export function sum<T>(values: ArrayLike<T> | Dictionary<T> | object | null | undefined,
					   iteratee: (value: T) => number): number;
export function sum(values: any, iteratee?: (value: any) => number): number {
	let total = 0;
	if (values == null) {
		return 0;
	}
	if (isArrayLike(values)) {
		if (iteratee) {
			for (let i = 0; i < values.length; i++) {
				total += iteratee(values[i]);
			}
		} else {
			for (let i = 0; i < values.length; i++) {
				total += values[i];
			}
		}
	} else if (iteratee) {
		for (const key in values) {
			total += iteratee(values[key]);
		}
	} else {
		for (const key in values) {
			total += values[key];
		}
	}
	return total;
}

/** Returns the minimum element, or the minimum computed value when an iteratee is given. */
export function min<T>(values: ArrayLike<T> | Dictionary<T> | object | null | undefined): T;
export function min<T>(values: ArrayLike<T> | Dictionary<T> | object | null | undefined,
					   iteratee: (value: T) => number): number;
export function min(values: any, iteratee?: (value: any) => number): any {
	if (iteratee) {
		let computed = Infinity;
		if (values != null) {
			if (isArrayLike(values)) {
				for (let i = 0; i < values.length; i++) {
					const current = iteratee(values[i]);
					if (current < computed) {
						computed = current;
					}
				}
			} else {
				for (const key in values) {
					const current = iteratee(values[key]);
					if (current < computed) {
						computed = current;
					}
				}
			}
		}
		return computed;
	}
	let result: any = Infinity;
	let computed = Infinity;
	if (values != null) {
		if (isArrayLike(values)) {
			for (let i = 0; i < values.length; i++) {
				const value = values[i];
				const current = +value;
				if (current < computed) {
					computed = current;
					result = value;
				}
			}
		} else {
			for (const key in values) {
				const value = values[key];
				const current = +value;
				if (current < computed) {
					computed = current;
					result = value;
				}
			}
		}
	}
	return result;
}

/** Returns the maximum element, or the maximum computed value when an iteratee is given. */
export function max<T>(values: ArrayLike<T> | Dictionary<T> | object | null | undefined): T;
export function max<T>(values: ArrayLike<T> | Dictionary<T> | object | null | undefined,
					   iteratee: (value: T) => number): number;
export function max(values: any, iteratee?: (value: any) => number): any {
	if (iteratee) {
		let computed = -Infinity;
		if (values != null) {
			if (isArrayLike(values)) {
				const length = values.length;
				for (let i = 0; i < length; i++) {
					const current = iteratee(values[i]);
					if (current > computed) {
						computed = current;
					}
				}
			} else {
				for (const key in values) {
					const current = iteratee(values[key]);
					if (current > computed) {
						computed = current;
					}
				}
			}
		}
		return computed;
	}
	let result: any = -Infinity;
	let computed = -Infinity;
	if (values != null) {
		if (isArrayLike(values)) {
			const length = values.length;
			for (let i = 0; i < length; i++) {
				const value = values[i];
				const current = +value;
				if (current > computed) {
					computed = current;
					result = value;
				}
			}
		} else {
			for (const key in values) {
				const value = values[key];
				const current = +value;
				if (current > computed) {
					computed = current;
					result = value;
				}
			}
		}
	}
	return result;
}

/**
 * Stable ascending sort by one iteratee. The key is computed once per element and the input
 * array is never mutated.
 */
export function sortBy<T>(values: readonly T[] | Dictionary<T> | null | undefined,
					   iteratee?: (value: T) => unknown): T[] {
	if (!values) {
		return [];
	}
	const items: readonly T[] = Array.isArray(values) ? values : Object.values(values as Dictionary<T>);
	const length = items.length;
	if (length < 2) {
		return items.slice();
	}
	if (!iteratee) {
		const result = items.slice();
		result.sort((a, b) => {
			const left = a as any;
			const right = b as any;
			return left < right ? -1 : left > right ? 1 : 0;
		});
		return result;
	}
	const entries: {key: unknown; value: T}[] = new Array(length);
	for (let i = 0; i < length; i++) {
		entries[i] = {key: iteratee(items[i]), value: items[i]};
	}
	entries.sort((a, b) => {
		const left = a.key as any;
		const right = b.key as any;
		return left < right ? -1 : left > right ? 1 : 0;
	});
	const result: T[] = new Array(length);
	for (let i = 0; i < length; i++) {
		result[i] = entries[i].value;
	}
	return result;
}

/** Flattens one level of nested arrays without allocating arrays for empty slots. */
export function flatten<T>(values: readonly (readonly T[] | null | undefined)[] | null | undefined): T[] {
	if (!values) {
		return [];
	}
	const outerLength = values.length;
	if (outerLength === 0) {
		return [];
	}
	if (outerLength === 1) {
		const inner = values[0];
		if (!inner) {
			return [];
		}
		const length = inner.length;
		const result = new Array<T>(length);
		for (let i = 0; i < length; i++) {
			result[i] = inner[i];
		}
		return result;
	}
	let length = 0;
	for (let i = 0; i < outerLength; i++) {
		const inner = values[i];
		if (inner) {
			length += inner.length;
		}
	}
	if (length === 0) {
		return [];
	}
	const result = new Array<T>(length);
	let index = 0;
	for (let i = 0; i < outerLength; i++) {
		const inner = values[i];
		if (inner) {
			for (let j = 0; j < inner.length; j++) {
				result[index++] = inner[j];
			}
		}
	}
	return result;
}

/** Maps values and drops falsy results in one pass. */
export function compactMap<T, R>(values: readonly T[] | null | undefined,
								iteratee: (value: T) => R): NonNullable<R>[] {
	const result: NonNullable<R>[] = [];
	if (!values) {
		return result;
	}
	for (let i = 0; i < values.length; i++) {
		const mapped = iteratee(values[i]);
		if (mapped) {
			result.push(mapped as NonNullable<R>);
		}
	}
	return result;
}

/** Removes false, null, undefined, 0, NaN, and empty-string values. */
export function compact<T>(values: readonly T[] | null | undefined): NonNullable<T>[] {
	const result: NonNullable<T>[] = [];
	if (values) {
		for (let i = 0; i < values.length; i++) {
			const value = values[i];
			if (value) {
				result.push(value as NonNullable<T>);
			}
		}
	}
	return result;
}

/** Removes duplicate values, keeping the first occurrence. */
export function unique<T>(values: readonly T[] | null | undefined): T[] {
	if (!values) {
		return [];
	}
	const length = values.length;
	if (length < 2) {
		return values.slice();
	}
	if (length <= 256) {
		const result: T[] = [];
		outer:
			for (let i = 0; i < length; i++) {
				const value = values[i];
				for (let j = result.length - 1; j >= 0; j--) {
					if (result[j] === value) {
						continue outer;
					}
				}
				result.push(value);
			}
		return result;
	}
	const seen = new Set<T>();
	const result: T[] = [];
	for (let i = 0; i < length; i++) {
		const value = values[i];
		if (!seen.has(value)) {
			seen.add(value);
			result.push(value);
		}
	}
	return result;
}

/** Removes values whose computed key was already seen, keeping the first occurrence. */
export function uniqueBy<T>(values: readonly T[] | null | undefined, iteratee: (value: T) => unknown): T[] {
	const result: T[] = [];
	if (!values) {
		return result;
	}
	const seen = new Set<unknown>();
	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		const key = iteratee(value);
		if (!seen.has(key)) {
			seen.add(key);
			result.push(value);
		}
	}
	return result;
}

/** Removes matching elements from `array` in place and returns them. */
export function remove<T>(array: T[], predicate: (value: T, index: number, array: T[]) => boolean): T[] {
	const removed: T[] = [];
	let writeIndex = 0;
	for (let readIndex = 0; readIndex < array.length; readIndex++) {
		const value = array[readIndex];
		if (predicate(value, readIndex, array)) {
			removed.push(value);
		} else {
			array[writeIndex++] = value;
		}
	}
	array.length = writeIndex;
	return removed;
}

/** Removes every occurrence of the supplied values from `array` in place. */
export function pull<T>(array: T[], ...values: T[]): T[] {
	if (values.length == 0) {
		return array;
	}
	const removedValues = new Set(values);
	let writeIndex = 0;
	for (let readIndex = 0; readIndex < array.length; readIndex++) {
		const value = array[readIndex];
		if (!removedValues.has(value)) {
			array[writeIndex++] = value;
		}
	}
	array.length = writeIndex;
	return array;
}

/** Fills `undefined` properties of `target` from `source`, returning `target`. */
export function defaults<T extends object, S extends object>(target: T, source: S): T & S {
	for (const key in source) {
		if ((target as any)[key] === undefined) {
			(target as any)[key] = (source as any)[key];
		}
	}
	return target as T & S;
}

/** Recursively fills `undefined` properties of `target` from `source`, returning `target`. */
export function defaultsDeep<T extends object, S extends object>(target: T, source: S): T & S {
	for (const key in source) {
		const targetValue = (target as any)[key];
		const sourceValue = (source as any)[key];
		if (targetValue === undefined) {
			(target as any)[key] = sourceValue;
		} else if (targetValue !== null && sourceValue !== null
				   && typeof targetValue == 'object' && typeof sourceValue == 'object') {
			if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
				defaultsDeepArray(targetValue, sourceValue);
			} else if (!Array.isArray(targetValue) && !Array.isArray(sourceValue)) {
				defaultsDeep(targetValue, sourceValue);
			}
		}
	}
	return target as T & S;
}

function defaultsDeepArray(target: any[], source: any[]): void {
	for (let i = 0; i < source.length; i++) {
		const targetValue = target[i];
		const sourceValue = source[i];
		if (targetValue === undefined) {
			target[i] = sourceValue;
		} else if (targetValue !== null && sourceValue !== null
				   && typeof targetValue == 'object' && typeof sourceValue == 'object') {
			if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
				defaultsDeepArray(targetValue, sourceValue);
			} else if (!Array.isArray(targetValue) && !Array.isArray(sourceValue)) {
				defaultsDeep(targetValue, sourceValue);
			}
		}
	}
}

/** Shallow-clones arrays and plain objects. */
export function clone<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.slice() as unknown as T;
	}
	if (value !== null && typeof value == 'object') {
		return {...(value as any)} as T;
	}
	return value;
}

/** Deep-clones arrays and plain objects; functions and class instances are kept by reference. */
export function cloneDeep<T>(value: T): T {
	if (Array.isArray(value)) {
		const result: any[] = new Array(value.length);
		for (let i = 0; i < value.length; i++) {
			result[i] = cloneDeep(value[i]);
		}
		return result as unknown as T;
	}
	if (value !== null && typeof value == 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
		const result: any = {};
		for (const key in value) {
			result[key] = cloneDeep((value as any)[key]);
		}
		return result as T;
	}
	return value;
}

/** Returns whether a value is empty, for arrays, strings, maps, sets, and dictionaries. */
export function isEmpty(value: any): boolean {
	if (value == null) {
		return true;
	}
	if (Array.isArray(value) || typeof value == 'string') {
		return value.length == 0;
	}
	if (value instanceof Map || value instanceof Set) {
		return value.size == 0;
	}
	if (typeof value == 'object') {
		for (const _key in value) {
			return false;
		}
		return true;
	}
	return true;
}

/** Lodash 3 `isObject`: functions and non-null objects are objects. */
export function isObject(value: any): value is object {
	const type = typeof value;
	return !!value && (type == 'object' || type == 'function');
}

/** Returns a copy of `values` in random order (Fisher-Yates). */
export function shuffle<T>(values: readonly T[] | null | undefined): T[] {
	if (!values) {
		return [];
	}
	const result = values.slice();
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const value = result[i];
		result[i] = result[j];
		result[j] = value;
	}
	return result;
}

/** Returns one random element, or `n` random elements without replacement. */
export function sample<T>(values: readonly T[]): T;
export function sample<T>(values: readonly T[], n: number): T[];
export function sample<T>(values: readonly T[], n?: number): T | T[] {
	const length = values ? values.length : 0;
	if (length === 0) {
		return n === undefined ? undefined as unknown as T : [];
	}
	if (n === undefined) {
		return values[Math.floor(Math.random() * length)];
	}
	if (n <= 0) {
		return [];
	}
	const count = Math.min(Math.floor(n) || 0, length);
	if (count === 0) {
		return [];
	}
	if (count === length) {
		return shuffle(values);
	}
	const result = values.slice();
	for (let i = 0; i < count; i++) {
		const j = i + Math.floor(Math.random() * (length - i));
		const value = result[i];
		result[i] = result[j];
		result[j] = value;
	}
	result.length = count;
	return result;
}

/** Returns a random integer in the inclusive range [min, max]. */
export function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Memoizes a single-argument function using a Map keyed by that argument. */
export function memoize<A, R>(fn: (arg: A) => R): (arg: A) => R {
	const cache = new Map<A, R>();
	return (arg: A): R => {
		if (cache.has(arg)) {
			return cache.get(arg)!;
		}
		const result = fn(arg);
		cache.set(arg, result);
		return result;
	};
}

/** Counts elements by computed key. */
export function countBy<T>(values: readonly T[], iteratee?: (value: T) => PropertyKey | null | undefined):
	Record<string, number> {
	const result: Record<string, number> = {};
	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		const key = String(iteratee ? iteratee(value) : value);
		result[key] = (result[key] || 0) + 1;
	}
	return result;
}

/** Groups iterable values by key. */
export function groupBy<T>(items: Iterable<T> | null | undefined,
						   getKey: (item: T) => PropertyKey | null | undefined): Record<PropertyKey, T[]> {
	const result: Record<PropertyKey, T[]> = Object.create(null);
	if (items == null) {
		return result;
	}
	for (const item of items) {
		const key = getKey(item);
		const normalizedKey = key == null ? String(key) : key;
		const group = result[normalizedKey];
		if (group) {
			group.push(item);
		} else {
			result[normalizedKey] = [item];
		}
	}
	return result;
}

/** Splits elements into `[matching, nonMatching]` arrays, preserving order. */
export function partition<T>(values: readonly T[], predicate: (value: T) => unknown): [T[], T[]] {
	const matching: T[] = [];
	const nonMatching: T[] = [];
	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		if (predicate(value)) {
			matching.push(value);
		} else {
			nonMatching.push(value);
		}
	}
	return [matching, nonMatching];
}

/** Maps object keys while keeping the corresponding values. */
export function mapKeys<T>(object: Dictionary<T> | null | undefined,
						   iteratee: (value: T, key: string) => PropertyKey): Record<string, T> {
	const result: Record<string, T> = {};
	if (object == null) {
		return result;
	}
	for (const key in object) {
		const value = object[key];
		result[String(iteratee(value, key))] = value;
	}
	return result;
}

/** Maps own dictionary values with one key snapshot and lazy value reads, as in Screeps' Lodash 3. */
export function mapValues<T, R>(source: { [key: string]: T } | null | undefined,
	mapper: (value: T, key: string, object: { [key: string]: T }) => R): { [key: string]: R } {
	const result: { [key: string]: R } = {};
	if (source == null) {
		return result;
	}
	for (const key of Object.keys(source)) {
		result[key] = mapper(source[key], key, source);
	}
	return result;
}

/** Selects the listed properties from an object. */
export function pick<T extends object>(object: T, keys: readonly string[]): Partial<T> {
	const result: Partial<T> = {};
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		if (key in object) {
			(result as any)[key] = (object as any)[key];
		}
	}
	return result;
}

/** Inverts object keys and values. */
export function invert<T extends PropertyKey>(object: Dictionary<T> | null | undefined): Record<string, string> {
	const result: Record<string, string> = {};
	if (object == null) {
		return result;
	}
	for (const key in object) {
		result[String(object[key])] = key;
	}
	return result;
}

/** Returns the elements of `values` not present in `exclude`, preserving order. */
export function difference<T>(values: readonly T[], exclude: readonly T[]): T[] {
	const excluded = new Set(exclude);
	const result: T[] = [];
	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		if (!excluded.has(value)) {
			result.push(value);
		}
	}
	return result;
}

/** Returns the elements of `values` excluding the supplied values. */
export function without<T>(values: readonly T[], ...excluded: T[]): T[] {
	return difference(values, excluded);
}

/** Splits an array into groups of at most `size` elements. */
export function chunk<T>(values: readonly T[], size = 1): T[][] {
	const chunkSize = Math.max(1, Math.floor(size));
	const length = values.length;
	const result: T[][] = new Array(Math.ceil(length / chunkSize));
	let chunkIndex = 0;
	for (let i = 0; i < length; i += chunkSize) {
		result[chunkIndex++] = values.slice(i, i + chunkSize);
	}
	return result;
}

/** Returns the lowest index at which `value` could be inserted into a sorted array. */
export function sortedIndex<T>(values: readonly T[], value: T): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle] < value) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

/** Returns the first key whose value satisfies the predicate. */
export function findKey<T>(object: Dictionary<T>, predicate: (value: T, key: string) => unknown): string | undefined {
	for (const key in object) {
		if (predicate(object[key], key)) {
			return key;
		}
	}
	return undefined;
}

/** Returns the number of own enumerable entries (or length for array-likes). */
export function size(value: any): number {
	if (value == null) {
		return 0;
	}
	if (Array.isArray(value) || typeof value == 'string') {
		return value.length;
	}
	if (value instanceof Map || value instanceof Set) {
		return value.size;
	}
	let count = 0;
	for (const _key in value) {
		count++;
	}
	return count;
}

/** Takes the first `n` elements. */
export function take<T>(values: readonly T[], n = 1): T[] {
	return n <= 0 ? [] : values.slice(0, n);
}

/** Drops the first `n` elements. */
export function drop<T>(values: readonly T[], n = 1): T[] {
	return n <= 0 ? values.slice() : values.slice(n);
}

/** Drops the last `n` elements. */
export function dropRight<T>(values: readonly T[], n = 1): T[] {
	return n <= 0 ? values.slice() : values.slice(0, -n);
}

/** Returns the last element (undefined for an empty array). */
export function last<T>(values: readonly T[]): T {
	return values[values.length - 1];
}

/** Builds an object from parallel key/value arrays or from `[key, value]` pairs. */
export function zipObject<K extends PropertyKey, V>(keys: readonly K[], values: readonly V[]): Record<K, V>;
export function zipObject<K extends PropertyKey, V>(pairs: readonly (readonly [K, V])[]): Record<K, V>;
export function zipObject(keysOrPairs: readonly any[], values?: readonly any[]): any {
	const result: any = {};
	if (values === undefined) {
		for (let i = 0; i < keysOrPairs.length; i++) {
			const pair = keysOrPairs[i];
			result[pair[0]] = pair[1];
		}
	} else {
		for (let i = 0; i < keysOrPairs.length; i++) {
			result[keysOrPairs[i]] = values[i];
		}
	}
	return result;
}

/** Creates an inclusive range of numbers. */
export function range(start: number, end?: number, step?: number): number[] {
	if (end === undefined) {
		end = start;
		start = 0;
	}
	if (step === undefined) {
		step = start < end ? 1 : -1;
	} else if (step == 0) {
		step = 1;
	}
	const length = Math.max(Math.ceil((end - start) / step), 0);
	const result: number[] = new Array(length);
	for (let i = 0; i < length; i++, start += step) {
		result[i] = start;
	}
	return result;
}
