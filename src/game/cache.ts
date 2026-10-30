/**
 * Per-tick state lives outside engine objects. Weak keys do not retain discarded objects;
 * resetting on Game.time also supports engine objects reused by a runtime across ticks.
 */
export function createTickCache<K extends object, V>(create: (key: K) => V): (key: K) => V {
	let tick: number | undefined;
	let values = new WeakMap<K, V>();
	return (key: K): V => {
		if (tick !== Game.time) {
			tick = Game.time;
			values = new WeakMap<K, V>();
		}
		const cached = values.get(key);
		// An absent singleton is a valid cached result too.
		if (cached !== undefined || values.has(key)) return cached as V;
		const value = create(key);
		values.set(key, value);
		return value;
	};
}
