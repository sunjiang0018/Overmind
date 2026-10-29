"""Validate the actual shipped layout against the surveyed shard3 terrain."""
import json, unittest
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
   if o['type'] in ('spawn','extension','storage','tower','container','road'):
    self.assertIn((o['x'],o['y']),BUILDINGS[o['type']])
 def test_capacity(self):
  for t,count in {'spawn':3,'extension':60,'tower':6,'storage':1,'terminal':1,'lab':10,'factory':1,'observer':1,'nuker':1,'powerSpawn':1}.items():
   self.assertEqual(len(BUILDINGS[t]),count)
 def test_labs(self):
  labs=[(p['x'],p['y']) for p in PLAN['buildings']['lab']]
  for output in labs[2:]:
   for reagent in labs[:2]:self.assertLessEqual(distance(output,reagent),2)
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
if __name__=='__main__':unittest.main()
