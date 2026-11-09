"""Offline correctness checks for the road tie-break and frozen proposal."""
from collections import deque
import importlib.util
import json
from pathlib import Path
import unittest

from e57s45_routes import compact_shared_network, near, point, quality, road_distances, rng, smooth_path, validate_routes

ROOT = Path(__file__).resolve().parents[1]


class RouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from e57s45_routes import refine, prune_redundant_roads
        spec = importlib.util.spec_from_file_location('e57_planner', ROOT / 'scripts/plan-e57s45.py')
        cls.planner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.planner)
        cls.fixture = json.loads(cls.planner.FIXTURE.read_text())
        choice = json.loads(cls.planner.SEARCH.read_text())['selected']
        cls.original = cls.planner.generate(cls.fixture, choice['extensionPolicy'], tuple(choice['coreOffset']), choice['extensionOrder'])
        cls.previous, _ = refine(cls.original, cls.fixture, cls.planner.min_cut)
        cls.previous['logisticsPolicy'] = {
            'preserveMiningBuffers': True, 'storageLinkFirst': True, 'queenBufferFirst': True}
        cls.previous, _ = prune_redundant_roads(cls.previous)

    def test_open_floor_uses_a_flat_approach_without_adding_steps(self):
        floor = {(x, y) for x in range(31) for y in range(20, 41)}
        route = smooth_path((4, 30), (25, 30), set(), floor)
        self.assertEqual(len(route), 20)
        self.assertEqual(quality((4, 30), (25, 30), route)['turns'], 0)
        self.assertTrue(all(p[1] == 30 for p in route))

    def test_existing_road_never_outweighs_shortest_step_count(self):
        floor = {(x, y) for x in range(7) for y in range(3)}
        old_road = {(x, 0) for x in range(7)} | {(0, 1), (6, 1)}
        route = smooth_path((0, 1), (6, 1), set(), floor, old_road, range_=0)
        self.assertEqual(route, [(x, 1) for x in range(1, 7)])

    def test_objective_matches_exhaustive_shortest_paths(self):
        floor = {(x, y) for x in range(5) for y in range(5)}
        start, goal = (0, 2), (4, 2)
        roads = {(x, 1) for x in range(5)}
        for blocked in [{(2, 2)}, {(2, 1), (2, 2), (2, 3)}, {(1, 2), (3, 2)}]:
            distances = {goal: 0}
            queue = deque([goal])
            while queue:
                p = queue.popleft()
                for n in near(p):
                    if n in floor and n not in blocked and n not in distances:
                        distances[n] = distances[p] + 1
                        queue.append(n)
            candidates = []

            def enumerate_paths(p, path):
                if p == goal:
                    q = quality(start, goal, path)
                    candidates.append((len(path), q['shapeCost'], q['turns'], sum(n not in roads for n in path)))
                    return
                for n in near(p):
                    if distances.get(n) == distances[p] - 1:
                        enumerate_paths(n, path + [n])

            enumerate_paths(start, [])
            route = smooth_path(start, goal, blocked, floor, roads, range_=0)
            q = quality(start, goal, route)
            actual = len(route), q['shapeCost'], q['turns'], sum(n not in roads for n in route)
            self.assertEqual(actual, min(candidates))

    def test_actual_source2_regression_and_all_named_routes(self):
        plan = json.loads((ROOT / 'plans/E57S45/plan.json').read_text())
        fixture = json.loads((ROOT / 'scripts/fixtures/E57S45.json').read_text())
        review = json.loads((ROOT / 'plans/E57S45/routing-review.json').read_text())
        validate_routes(plan, fixture)
        route = [point(p) for p in plan['routes']['westToStorage']]
        self.assertEqual(route[:17], [(x, 30) for x in range(5, 22)])
        self.assertEqual(len(route), 20)
        self.assertEqual(review['routes']['westToStorage']['after']['turns'], 1)
        self.assertEqual(len(review['routes']), 14)
        for label, row in review['routes'].items():
            self.assertLessEqual(row['after']['steps'], row['before']['steps'], label)
        for level, ticks in review['queenRefillAfter'].items():
            self.assertLessEqual(ticks, review['queenRefillBefore'][level], level)

    def test_buildings_and_link_priority_are_preserved(self):
        plan = json.loads(self.planner.DESTINATION.read_text())
        for kind, positions in self.original['buildings'].items():
            if kind not in ('road', 'rampart'):
                self.assertEqual(positions, plan['buildings'][kind], kind)
        self.assertEqual(plan['linkPriority'], self.original['linkPriority'])
        self.planner.validate(plan, self.fixture)

    def test_logistics_policy_and_redundant_road_removal_are_explicit(self):
        from e57s45_logistics import evaluate
        plan = json.loads((ROOT / 'plans/E57S45/plan.json').read_text())
        review = json.loads((ROOT / 'plans/E57S45/routing-review.json').read_text())
        self.assertEqual(plan['logisticsPolicy'], {
            'preserveMiningBuffers': True, 'storageLinkFirst': True, 'queenBufferFirst': True})
        removed = {point(p) for p in review['roadPruning']['removed']}
        self.assertTrue({(22, 37), (25, 21), (35, 33)} <= removed)
        for stage in plan['stages'].values():
            self.assertFalse(removed & {point(p) for p in stage['road']})
        result = evaluate(plan)['8']
        self.assertEqual(result['maximumTicks'], 195)
        self.assertTrue(all(case['buffer'] == 'container' for case in result['cases']))
        self.assertTrue(any(case['linkAvailable'] for case in result['cases']))

    def test_road_pruning_has_reached_a_stable_result(self):
        plan = json.loads((ROOT / 'plans/E57S45/plan.json').read_text())
        result, review = compact_shared_network(plan, self.fixture)
        self.assertEqual(review['removed'], [])
        self.assertEqual(result['buildings']['road'], plan['buildings']['road'])

    def test_shared_roads_can_replace_previously_frozen_main_paths(self):
        plan = json.loads(self.planner.DESTINATION.read_text())
        before = {point(p) for p in self.previous['buildings']['road']}
        after = {point(p) for p in plan['buildings']['road']}
        self.assertTrue(after < before)
        self.assertGreaterEqual(len(before - after), 30)
        removed_main_tiles = (before - after) & {point(p) for route in self.previous['routes'].values() for p in route}
        self.assertGreater(len(removed_main_tiles), 20)
        for name in ('westToStorage', 'westToSpawn'):
            self.assertEqual(plan['routes'][name], self.previous['routes'][name])
        self.assertEqual(plan['routes']['westToController'][:20], plan['routes']['westToStorage'])
        for name in plan['routes']:
            self.assertEqual(len(plan['routes'][name]), len(self.previous['routes'][name]), name)
        validate_routes(plan, self.fixture)

    def test_shared_network_preserves_every_staged_service_distance_and_refill_bound(self):
        from e57s45_logistics import evaluate
        plan = json.loads(self.planner.DESTINATION.read_text())
        hub, manager = point(plan['logisticsHub']), point(plan['managerPosition'])
        for level in range(2, 9):
            old_stage, new_stage = self.previous['stages'][str(level)], plan['stages'][str(level)]
            old_dist = road_distances(hub, {point(p) for p in old_stage['road']}, {manager})
            new_dist = road_distances(hub, {point(p) for p in new_stage['road']}, {manager})
            for kind, positions in old_stage.items():
                if kind in ('road', 'rampart', 'extractor'):
                    continue
                for p in positions:
                    goal = point(p)
                    old_cost = min(d for n, d in old_dist.items() if rng(n, goal) <= 1)
                    new_cost = min(d for n, d in new_dist.items() if rng(n, goal) <= 1)
                    self.assertEqual(new_cost, old_cost, (level, kind, goal))
        old_supply, new_supply = evaluate(self.previous), evaluate(plan)
        for level in old_supply:
            self.assertLessEqual(new_supply[level]['maximumTicks'], old_supply[level]['maximumTicks'], level)


if __name__ == '__main__':
    unittest.main()
