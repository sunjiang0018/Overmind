"""Validate the actual shipped layout against the surveyed shard3 terrain."""
import json, unittest
from collections import deque
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT/'tests/fixtures/E58S42.json').read_text())
PLAN = json.loads((ROOT/'src/roomPlanner/layouts/E58S42.ts').read_text().split(' = ', 1)[1].rstrip(';\n'))
def coords(ps): return {(p['x'],p['y']) for p in ps}
def neighbors(p):
 return [(p[0]+dx,p[1]+dy) for dx in (-1,0,1) for dy in (-1,0,1) if (dx or dy) and 0<=p[0]+dx<50 and 0<=p[1]+dy<50]
def distance(p,q): return max(abs(p[0]-q[0]),abs(p[1]-q[1]))
def wall(p): return FIXTURE['terrain'][p[1]*50+p[0]] == '1'
BUILDINGS = {t:coords(ps) for t,ps in PLAN['buildings'].items()}
TUNNELS = coords(PLAN['tunnel'])
NATURAL = {(o['x'],o['y']) for o in FIXTURE['objects'] if o['type'] in ('controller','source','mineral')}
def flood(starts,blocked,tunnels=()):
 seen=set(starts);queue=list(starts)
 for p in queue:
  for n in neighbors(p):
   if n not in seen and n not in blocked and (not wall(n) or n in tunnels):seen.add(n);queue.append(n)
 return seen
class LayoutTests(unittest.TestCase):
 def test_terrain_and_no_structure_collisions(self):
  taken=set()
  for t,ps in BUILDINGS.items():
   self.assertEqual(len(ps),len(PLAN['buildings'][t]))
   for p in ps:
    self.assertTrue(1<=p[0]<=48 and 1<=p[1]<=48)
    if t=='road':
     self.assertTrue(not wall(p) or p in TUNNELS)
    elif t!='extractor':
     self.assertFalse(wall(p));self.assertNotIn(p,NATURAL)
    if t not in ('road','container'):
     self.assertNotIn(p,taken);taken.add(p)
  self.assertFalse(taken & BUILDINGS['road'])
 def test_existing_economy_preserved(self):
  for o in FIXTURE['objects']:
   if o['type'] in ('spawn','extension','storage','tower','container'):
    self.assertIn((o['x'],o['y']),BUILDINGS[o['type']])
 def test_capacity(self):
  for t,count in {'spawn':3,'extension':60,'tower':6,'storage':1,'terminal':1,'lab':10,'factory':1,'observer':1,'nuker':1,'powerSpawn':1}.items():
   self.assertEqual(len(BUILDINGS[t]),count)
 def test_labs(self):
  labs=[(p['x'],p['y']) for p in PLAN['buildings']['lab']]
  for output in labs[2:]:
   for reagent in labs[:2]:self.assertLessEqual(distance(output,reagent),2)
 def test_compact_roads_preserve_service_and_logistics_distances(self):
  baseline=coords(json.loads((ROOT/'tests/fixtures/E58S42-road-baseline.json').read_text())['roads'])
  roads=BUILDINGS['road']
  self.assertLess(len(roads),len(baseline));self.assertTrue(roads<=baseline)
  logistics=[p for t in ('spawn','storage','container','tower','terminal') for p in BUILDINGS[t]]
  goals=[p for t,ps in BUILDINGS.items() if t not in ('road',) for p in ps]
  def costs(network,start,targets,opened,start_range):
   starts={p for p in network if distance(p,start)<=start_range and (not wall(p) or opened)}
   seen={p:0 for p in starts};queue=deque(starts)
   while queue:
    p=queue.popleft()
    for n in neighbors(p):
     if n in network and n not in seen and (not wall(n) or opened):seen[n]=seen[p]+1;queue.append(n)
   return [min((d for p,d in seen.items() if distance(p,target)<=1),default=999) for target in targets]
  for opened in (False,True):
   for start,start_range,targets in [((23,39),0,goals)]+[(p,1,logistics) for p in logistics]:
    before=costs(baseline,start,targets,opened,start_range);after=costs(roads,start,targets,opened,start_range)
    self.assertTrue(all(d<999 for d in after),(start,opened))
    self.assertEqual(before,after,(start,opened))
 def test_service_access_without_finished_tunnel(self):
  blocked=NATURAL|set.union(*(ps for t,ps in BUILDINGS.items() if t not in ('container','road','extractor')))
  seen=flood([(23,39)],blocked)
  for t,ps in BUILDINGS.items():
   for p in ps:
    if t not in ('road','extractor'):self.assertTrue(any(n in seen for n in neighbors(p)),(t,p))
  for p in BUILDINGS['container']:self.assertIn(p,seen)
 def test_tunnel_route(self):
  route=[(p['x'],p['y']) for p in PLAN['sourceRoute']]
  self.assertEqual(TUNNELS,{(30,28),(31,27)})
  self.assertEqual(len(route),28)
  last=(24,40)
  for p in route:
   self.assertEqual(distance(last,p),1)
   self.assertIn(p,BUILDINGS['road']);last=p
  self.assertEqual(last,(39,20))
 def test_defense_after_novice_walls_disappear_and_tunnel_opens(self):
  barriers=coords(PLAN['barriers'])
  for p in barriers:self.assertTrue(2<=p[0]<=47 and 2<=p[1]<=47 and not wall(p))
  exits={(x,y) for x in range(50) for y in range(50) if (x in (0,49) or y in (0,49)) and not wall((x,y))}
  outside=flood(exits,barriers,TUNNELS)
  for t,ps in BUILDINGS.items():
   if t not in ('road','extractor'):
    for p in ps:self.assertNotIn(p,outside,(t,p))
  for o in FIXTURE['objects']:
   if o['type'] in ('controller','source'):
    for p in neighbors((o['x'],o['y'])):
     if not wall(p):self.assertNotIn(p,outside)
 def test_perimeter_has_no_redundant_barriers(self):
  barriers=coords(PLAN['barriers'])
  exits={(x,y) for x in range(50) for y in range(50) if (x in (0,49) or y in (0,49)) and not wall((x,y))}
  protected=set.union(*(ps for t,ps in BUILDINGS.items() if t not in ('road','extractor')))
  for o in FIXTURE['objects']:
   if o['type'] in ('controller','source'):
    protected.update(p for p in neighbors((o['x'],o['y'])) if not wall(p))
  for p in barriers:
   self.assertTrue(flood(exits,barriers-{p},TUNNELS)&protected,('Redundant barrier',p))
if __name__=='__main__':unittest.main()
