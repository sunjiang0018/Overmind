"""Offline road refinement for a frozen E57S45 building footprint.

Shortest tile count is a hard first priority. Among equally short paths, prefer
less cumulative departure from the source/goal axis and fewer direction changes.
A turn costs two tile-units of cumulative axis departure. Road reuse breaks only
remaining ties, so an existing detour never makes a longer route preferable.
The v4 network pass then merges equal-length alternatives while preserving
source2's straight approaches, staged service distances and refill bounds.
"""
from collections import deque
from copy import deepcopy
import heapq


def near(p):
    return [(p[0] + dx, p[1] + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
            if (dx or dy) and 0 <= p[0] + dx < 50 and 0 <= p[1] + dy < 50]


def rng(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def point(p):
    return p['x'], p['y']


def coords(positions):
    return [{'x': p[0], 'y': p[1]} for p in positions]


def quality(start, goal, route):
    axis = max(rng(start, goal), 1)
    dx, dy = goal[0] - start[0], goal[1] - start[1]
    previous, direction, turns, deviation = start, None, 0, 0
    max_deviation = 0
    for p in route:
        new_direction = p[0] - previous[0], p[1] - previous[1]
        turns += int(direction is not None and new_direction != direction)
        cross = abs(dx * (p[1] - start[1]) - dy * (p[0] - start[0]))
        deviation += cross
        max_deviation = max(max_deviation, cross)
        previous, direction = p, new_direction
    return {'steps': len(route), 'turns': turns, 'shapeCost': deviation + 2 * axis * turns,
            'axisDeparture': round(deviation / axis, 3),
            'maximumAxisDeparture': round(max_deviation / axis, 3)}


def smooth_path(start, goal, blocked, walkable, roads=frozenset(), range_=1):
    axis = max(rng(start, goal), 1)
    gx, gy = goal[0] - start[0], goal[1] - start[1]
    initial = (start, (0, 0))
    best = {initial: (0, 0, 0, 0)}
    previous = {}
    heap = [(max(0, rng(start, goal) - range_), 0, 0, 0, 0, *initial)]
    while heap:
        _, shape, turns, new_roads, steps, p, direction = heapq.heappop(heap)
        state = p, direction
        if best.get(state) != (steps, shape, turns, new_roads):
            continue
        if rng(p, goal) <= range_:
            result = []
            while state != initial:
                result.append(state[0])
                state = previous[state]
            return list(reversed(result))
        for n in near(p):
            if n not in walkable or n in blocked:
                continue
            next_direction = n[0] - p[0], n[1] - p[1]
            turn = int(direction != (0, 0) and next_direction != direction)
            cross = abs(gx * (n[1] - start[1]) - gy * (n[0] - start[0]))
            score = (steps + 1, shape + cross + 2 * axis * turn, turns + turn, new_roads + int(n not in roads))
            next_state = n, next_direction
            if score < best.get(next_state, (10000,) * 4):
                best[next_state] = score
                previous[next_state] = state
                heuristic = max(0, rng(n, goal) - range_)
                heapq.heappush(heap, (score[0] + heuristic, *score[1:], score[0], n, next_direction))
    raise AssertionError(f'No smooth path: {start} -> {goal}')


def road_distances(start, network, blocked=frozenset()):
    distances = {start: 0}
    queue = deque([start])
    while queue:
        p = queue.popleft()
        for n in near(p):
            if n in network and n not in blocked and n not in distances:
                distances[n] = distances[p] + 1
                queue.append(n)
    return distances


def refine(plan, fixture, min_cut):
    result = deepcopy(plan)
    terrain = fixture['terrain']
    walkable = {(x, y) for y in range(50) for x in range(50) if terrain[y * 50 + x] != '1'}
    natural = {point(o) for o in fixture['objects']}
    foreign = {point(o) for o in fixture['foreignConstructionSites']}
    buildings = {k: [point(p) for p in ps] for k, ps in plan['buildings'].items()}
    occupied = natural | {p for kind, ps in buildings.items() if kind not in ('road', 'rampart', 'extractor') for p in ps}
    hub, manager = point(plan['logisticsHub']), point(plan['managerPosition'])
    blocked = occupied | foreign | {manager}
    containers = buildings['container']
    endpoints = {
        'northSource': (hub, containers[0], 1), 'westSource': (hub, containers[1], 1),
        'controller': (hub, containers[3], 1), 'mineral': (hub, containers[4], 1),
        'eastSupply': (hub, (49, 44), 0), 'southExit': (hub, (28, 49), 0), 'westExit': (hub, (0, 41), 0),
    }
    for label, start in [('north', containers[0]), ('west', containers[1])]:
        for target, goal in [('Spawn', buildings['spawn'][0]), ('Storage', buildings['storage'][0]),
                             ('Controller', containers[3])]:
            endpoints[label + 'To' + target] = start, goal, 1
    endpoints['storageToController'] = buildings['storage'][0], containers[3], 1
    roads, routes, audit = {hub, manager}, {}, {}
    # Source2 is routed first so all destinations can share its straight approach.
    order = ['westToStorage', 'westToSpawn', 'westToController'] + [k for k in endpoints if not k.startswith('westTo')]
    for label in order:
        start, goal, radius = endpoints[label]
        route = smooth_path(start, goal, blocked, walkable, roads, radius)
        old = [point(p) for p in plan['routes'][label]]
        before, after = quality(start, goal, old), quality(start, goal, route)
        assert after['steps'] <= before['steps'], (label, 'longer path')
        if after['steps'] == before['steps']:
            assert after['shapeCost'] <= before['shapeCost'], (label, 'rougher path')
        routes[label] = route
        audit[label] = {'start': coords([start])[0], 'goal': coords([goal])[0], 'range': radius,
                        'before': before, 'after': after, 'changed': old != route}
        roads.update(route)
    # Apply the same preference to service approaches. Obsolete curved roads
    # are removed rather than kept as a second, misleading parallel trunk.
    service_paths = []
    for kind, ps in buildings.items():
        if kind in ('road', 'rampart', 'extractor'):
            continue
        for p in ps:
            route = smooth_path(hub, p, blocked, walkable, roads)
            roads.update(route)
            service_paths.append(route)
    # The manager is a stationary worker and is not a public shortcut.
    assert any(p in roads and p != manager for p in near(manager))
    assert not (roads - {manager}) & blocked
    required = {p for path in [*routes.values(), *service_paths] for p in path} | {hub, manager}
    assert required == roads

    protected = set()
    for kind, ps in buildings.items():
        if kind in ('road', 'rampart', 'extractor'):
            continue
        padding = 1 if kind in ('container', 'link') else 3
        for p in ps:
            protected.update(n for n in walkable if rng(p, n) <= padding and 3 <= n[0] <= 46 and 3 <= n[1] <= 46)
    for p in natural:
        protected.update(n for n in near(p) if n in walkable)
    for label, route in routes.items():
        if label not in ('eastSupply', 'southExit', 'westExit'):
            protected.update(route)
    perimeter = min_cut(walkable, protected, natural | foreign, buildings['tower'])
    assert not perimeter & (occupied | foreign)
    assert all(2 <= p[0] <= 47 and 2 <= p[1] <= 47 for p in perimeter)
    shields = set(buildings['spawn'] + buildings['storage'] + buildings['terminal'] + buildings['tower'])
    result['buildings']['road'] = coords(sorted(roads, key=lambda p: (rng(p, buildings['spawn'][0]), p)))
    result['buildings']['rampart'] = coords(buildings['spawn'][:1] + sorted(perimeter) + sorted(shields - {buildings['spawn'][0]}))
    result['routes'] = {label: coords(routes[label]) for label in plan['routes']}
    result['routeEndpoints'] = {label: {'start': coords([start])[0], 'goal': coords([goal])[0], 'range': radius}
                                for label, (start, goal, radius) in endpoints.items()}
    result['perimeter'] = coords(sorted(perimeter))
    result['gates'] = coords(sorted(perimeter & roads))

    # Early stages retain the same active buildings and construction order.
    # Their roads are selected from the final network, with monotonic additions.
    early_roads = {hub, manager}
    for level in range(1, 9):
        stage = result['stages'][str(level)]
        for kind, ps in stage.items():
            if kind not in ('road', 'rampart', 'extractor'):
                assert ps == plan['stages'][str(level)][kind]
        if level == 1:
            stage['road'] = []
        elif level < 4:
            for kind, ps in stage.items():
                if kind in ('road', 'rampart', 'extractor'):
                    continue
                for p in ps:
                    early_roads.update(smooth_path(hub, point(p), {manager}, roads))
            early_roads.update(routes['eastSupply'])
            stage['road'] = coords(sorted(early_roads))
        else:
            stage['road'] = result['buildings']['road']
        if level >= 3:
            stage['rampart'] = result['buildings']['rampart']

    metrics = result['metrics']
    metrics['roadStepsFromHub'] = {label: len(route) for label, route in routes.items()}
    for label, start in [('north', containers[0]), ('west', containers[1])]:
        distances = road_distances(start, roads, {manager})
        metrics['sourceRoadSteps'][label] = {
            target: min(d for n, d in distances.items() if rng(n, goal) <= 1)
            for target, goal in [('spawn', buildings['spawn'][0]), ('storage', buildings['storage'][0]),
                                 ('controllerSupply', containers[3])]}
    metrics['perimeterTiles'], metrics['roadTiles'] = len(perimeter), len(roads)
    previous_roads = set(buildings['road'])
    report = {'revision': 2, 'policy': 'Shortest steps first; then cumulative axis departure + two-tile turn penalty; road reuse only as final tie-break.',
              'buildingCoordinatesChanged': False, 'routeCount': len(routes),
              'routes': audit, 'roadTilesBefore': len(previous_roads), 'roadTilesAfter': len(roads),
              'removedRoadTiles': coords(sorted(previous_roads - roads)), 'addedRoadTiles': coords(sorted(roads - previous_roads)),
              'perimeterTilesBefore': len(plan['perimeter']), 'perimeterTilesAfter': len(perimeter)}
    result['routingRevision'] = report['revision']
    result['metrics']['routeQuality'] = {label: row['after'] for label, row in audit.items()}
    for kind, positions in plan['buildings'].items():
        if kind not in ('road', 'rampart'):
            assert result['buildings'][kind] == positions, (kind, 'building relocated')
    validate_routes(result, fixture)
    return result, report


def validate_routes(plan, fixture):
    """Independent BFS proves shortest step count, without the A* tie-break."""
    walkable = {(x, y) for y in range(50) for x in range(50) if fixture['terrain'][y * 50 + x] != '1'}
    blocked = {point(o) for o in fixture['objects']} | {point(o) for o in fixture['foreignConstructionSites']}
    blocked.update(point(p) for kind, ps in plan['buildings'].items()
                   if kind not in ('road', 'rampart', 'extractor') for p in ps)
    blocked.add(point(plan['managerPosition']))
    roads = {point(p) for p in plan['buildings']['road']}
    for label, route in plan['routes'].items():
        endpoint = plan['routeEndpoints'][label]
        start, goal = point(endpoint['start']), point(endpoint['goal'])
        radius = endpoint['range']
        previous = start
        for item in route:
            p = point(item)
            assert rng(previous, p) == 1 and p in walkable and p in roads and p not in blocked, (label, 'invalid step')
            previous = p
        assert rng(previous, goal) <= radius, (label, 'wrong endpoint')
        lower_bounds = road_distances(start, walkable, blocked)
        bound = min(d for p, d in lower_bounds.items() if rng(p, goal) <= radius)
        assert len(route) == bound, (label, 'not a shortest path')


def prune_redundant_roads(plan):
    """Remove roads only when every staged service distance and refill bound survives."""
    from e57s45_logistics import evaluate

    result = deepcopy(plan)
    hub, manager = point(plan['logisticsHub']), point(plan['managerPosition'])
    fixed = {point(p) for route in plan['routes'].values() for p in route} | {hub, manager}

    def service_costs(candidate):
        costs = []
        for level in range(2, 9):
            stage = candidate['stages'][str(level)]
            network = {point(p) for p in stage['road']}
            distances = road_distances(hub, network, {manager})
            for kind, positions in stage.items():
                if kind in ('road', 'rampart', 'extractor'):
                    continue
                for p in positions:
                    costs.append(min((d for n, d in distances.items() if rng(n, point(p)) <= 1), default=999))
        return costs

    baseline_costs = service_costs(plan)
    baseline_refill = evaluate(plan)
    removed = []
    changed = True
    while changed:
        changed = False
        for tile in sorted({point(p) for p in result['buildings']['road']} - fixed):
            trial = deepcopy(result)
            trial['buildings']['road'] = [p for p in trial['buildings']['road'] if point(p) != tile]
            for stage in trial['stages'].values():
                stage['road'] = [p for p in stage['road'] if point(p) != tile]
            if not all(a <= b for a, b in zip(service_costs(trial), baseline_costs)):
                continue
            refill = evaluate(trial)
            if any(refill[level]['maximumTicks'] > old['maximumTicks'] for level, old in baseline_refill.items()):
                continue
            result = trial
            removed.append(tile)
            changed = True
    result['metrics']['roadTiles'] = len(result['buildings']['road'])
    report = {'roadTilesBefore': len(plan['buildings']['road']), 'roadTilesAfter': len(result['buildings']['road']),
              'removed': coords(removed), 'allStagedServiceDistancesPreserved': True,
              'worstRefillPreserved': True}
    return result, report


def compact_shared_network(plan, fixture):
    """Share shortest routes instead of freezing every route's chosen tiles.

    Keep the two straight source2 approaches, all named shortest distances,
    every staged hub service distance, and each stage's worst refill bound.
    Other named routes are allowed to move onto shared roads. Compare four
    deterministic deletion orders; this is a constrained local search, not a
    globally minimum road network proof.
    """
    from e57s45_logistics import evaluate

    validate_routes(plan, fixture)
    hub, manager = point(plan['logisticsHub']), point(plan['managerPosition'])
    original = {point(p) for p in plan['buildings']['road']}
    stage_roads = {level: {point(p) for p in stage['road']} for level, stage in plan['stages'].items()}
    fixed_names = ('westToStorage', 'westToSpawn')
    fixed = {point(p) for name in fixed_names for p in plan['routes'][name]} | {hub, manager}
    endpoints = [(point(row['start']), point(row['goal']), row['range'])
                 for row in plan['routeEndpoints'].values()]
    service_goals = {level: [point(p) for kind, ps in plan['stages'][level].items()
                             if kind not in ('road', 'rampart', 'extractor') for p in ps]
                     for level in stage_roads if int(level) >= 2}

    def distance_constraints(network):
        values, searches = [], {}
        for start, goal, radius in endpoints:
            if start not in searches:
                searches[start] = road_distances(start, network, {manager})
            values.append(min((d for n, d in searches[start].items() if rng(n, goal) <= radius), default=999))
        for level, goals in service_goals.items():
            distances = road_distances(hub, network & stage_roads[level], {manager})
            for goal in goals:
                values.append(min((d for n, d in distances.items() if rng(n, goal) <= 1), default=999))
        return values

    def apply_network(candidate, network):
        candidate['buildings']['road'] = coords(sorted(network, key=lambda p: (rng(p, point(plan['firstSpawn'])), p)))
        for level, stage in candidate['stages'].items():
            stage['road'] = coords(sorted(network & stage_roads[level]))

    baseline_distances = distance_constraints(original)
    assert all(d < 999 for d in baseline_distances), 'Unreachable baseline route or service target'
    baseline_supply = evaluate(plan)
    usage = {p: sum(p in {point(q) for q in route} for route in plan['routes'].values()) for p in original}
    orderings = {
        'xy': sorted(original - fixed),
        'reverseXY': sorted(original - fixed, reverse=True),
        'leastSharedFirst': sorted(original - fixed, key=lambda p: (usage[p], p)),
        'outerFirst': sorted(original - fixed, key=lambda p: (-rng(p, hub), p)),
    }
    candidates, rows = [], []
    for name, order in orderings.items():
        candidate, network, removed = deepcopy(plan), set(original), []
        changed = True
        while changed:
            changed = False
            for tile in order:
                if tile not in network:
                    continue
                trial = network - {tile}
                if any(a > b for a, b in zip(distance_constraints(trial), baseline_distances)):
                    continue
                apply_network(candidate, trial)
                supply = evaluate(candidate)
                if any(row['maximumTicks'] > baseline_supply[level]['maximumTicks'] for level, row in supply.items()):
                    continue
                network = trial
                removed.append(tile)
                changed = True
        # A rejected trial may have been the last evaluation; restore the
        # accepted network before scoring and publishing this candidate.
        apply_network(candidate, network)
        supply = evaluate(candidate)
        rows.append({'order': name, 'roadTiles': len(network),
                     'worstRefillByLevel': {level: row['maximumTicks'] for level, row in supply.items()}})
        candidates.append((candidate, network, removed))
    winner = min(range(len(rows)), key=lambda i: (rows[i]['roadTiles'], sum(rows[i]['worstRefillByLevel'].values()), i))
    result, network, removed = candidates[winner]
    route_review = {}
    for name, row in plan['routeEndpoints'].items():
        start, goal, radius = point(row['start']), point(row['goal']), row['range']
        route = ([point(p) for p in plan['routes'][name]] if name in fixed_names
                 else smooth_path(start, goal, {manager}, network, range_=radius))
        before = quality(start, goal, [point(p) for p in plan['routes'][name]])
        after = quality(start, goal, route)
        assert after['steps'] == before['steps'], (name, 'transport distance changed')
        result['routes'][name] = coords(route)
        route_review[name] = {'before': before, 'after': after}
    result['metrics']['roadTiles'] = len(network)
    result['metrics']['routeQuality'] = {name: row['after'] for name, row in route_review.items()}
    result['gates'] = coords(sorted(network & {point(p) for p in result['perimeter']}))
    result['routingRevision'] = 4
    validate_routes(result, fixture)
    report = {'roadTilesBefore': len(original), 'roadTilesAfter': len(network),
              'selectedOrder': rows[winner]['order'], 'candidates': rows, 'removed': coords(sorted(removed)),
              'fixedRoutes': list(fixed_names), 'routes': route_review,
              'allNamedShortestDistancesPreserved': True, 'allStagedServiceDistancesPreserved': True,
              'worstRefillPreserved': True,
              'queenRefillBefore': {level: row['maximumTicks'] for level, row in baseline_supply.items()},
              'queenRefillAfter': rows[winner]['worstRefillByLevel']}
    return result, report
