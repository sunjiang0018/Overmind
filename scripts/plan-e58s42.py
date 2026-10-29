"""Reproduce the terrain-fitted layout; no server access or third party dependencies."""
import json, heapq, collections, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
f=json.loads((ROOT/'tests/fixtures/E58S42.json').read_text())
terrain=f['terrain']; objects=f['objects']
def wall(p): return terrain[p[1]*50+p[0]]=='1'
def near(p):
 return [(p[0]+dx,p[1]+dy) for dx in [-1,0,1] for dy in [-1,0,1] if (dx or dy) and 0<=p[0]+dx<50 and 0<=p[1]+dy<50]
def rng(a,b): return max(abs(a[0]-b[0]),abs(a[1]-b[1]))
def positions(t): return [(o['x'],o['y']) for o in objects if o['type']==t]
natural=set(positions('source')+positions('controller')+positions('mineral'))
buildings={t:positions(t) for t in ['spawn','extension','storage','tower','container']}
roads=set(positions('road')); occupied=set(sum(buildings.values(),[]))|natural
storage=positions('storage')[0]
def path(start,goal,blocked,wall_cost=None,range_=0,allowed_tunnels=()):
 q=[(0,start)];dist={start:0};prev={}
 while q:
  cost,p=heapq.heappop(q)
  if cost!=dist[p]:continue
  if rng(p,goal)<=range_:
   route=[]
   while p!=start:route.append(p);p=prev[p]
   return route[::-1]
  for n in near(p):
   if not(1<=n[0]<=48 and 1<=n[1]<=48) or n in blocked:continue
   if wall(n) and n not in allowed_tunnels and wall_cost is None:continue
   step=wall_cost if wall(n) and n not in allowed_tunnels else (1 if n in roads else 1.1)
   new=cost+step
   if new<dist.get(n,1e9):dist[n]=new;prev[n]=p;heapq.heappush(q,(new,n))
 return None
normal=path(storage,(39,20),occupied-set(positions('container')))
shortcut=path(storage,(39,20),occupied-set(positions('container')),allowed_tunnels=[(30,28),(31,27)])
tunnels=[p for p in shortcut if wall(p)]
print('Source route before/after:',len(normal),len(shortcut),'Tunnel:',tunnels)
# Reserve the shortcut after placing service buildings.
# The service square (23,39) touches storage, terminal, link and power spawn.
reserved={(23,39)}
def add(t,p):
 assert not wall(p) and p not in occupied and p not in roads,(t,p,'collision')
 buildings.setdefault(t,[]).append(p);occupied.add(p)
for t,p in [('terminal',(22,39)),('link',(23,38)),('powerSpawn',(24,39)),('nuker',(22,41)),('link',(28,38)),('spawn',(26,37)),('spawn',(23,37)),('tower',(32,37)),('tower',(26,31)),('tower',(31,45)),('tower',(22,32)),('tower',(32,38)),('observer',(21,42)),('factory',(24,41))]:add(t,p)
roads.update(shortcut)
# Keep source, controller and hatchery supply routes clear at every level.
for goal in positions('container')+positions('spawn'):
 roads.update(path(storage,goal,occupied-set(positions('container')),range_=1) or [])
buildings['container'].append((27,40))
occupied.add((27,40))
# Ten labs; the first two are reagent labs, within range two of all eight outputs.
labs=[(28,31),(29,31),(27,30),(28,30),(29,30),(30,30),(27,31),(30,31),(28,33),(30,33)]
for p in labs:add('lab',p)
# Greedy extension infill, preserving reachability to every building and supply station.
def reachable(blocked,tunnels=()):
 start=(23,39);seen={start};q=collections.deque([start])
 while q:
  p=q.popleft()
  for n in near(p):
   if n not in seen and n not in blocked and (not wall(n) or n in tunnels):seen.add(n);q.append(n)
 return seen

def accessible():
 seen=reachable(occupied-set(buildings['container']))
 return all(any(n in seen for n in near(p)) for t,ps in buildings.items() if t!='container' for p in ps) and all(p in seen for p in buildings['container'])
seen=reachable(occupied-set(buildings['container']))
assert accessible(),('Core blocks access',[(t,p) for t,ps in buildings.items() for p in ps if not any(n in seen for n in near(p))],labs)
candidates=[(x,y) for x in range(19,34) for y in range(30,47) if not wall((x,y)) and (x,y) not in occupied|roads|reserved]
candidates.sort(key=lambda p:(rng(p,(27,39)),rng(p,storage),p))
for p in candidates:
 if len(buildings['extension'])==60:break
 occupied.add(p);buildings['extension'].append(p)
 if not accessible():occupied.remove(p);buildings['extension'].pop()
assert len(buildings['extension'])==60,len(buildings['extension'])
# Connect all service positions; retain existing roads.
for t,ps in buildings.items():
 for p in ps:
  route=path((23,39),p,occupied-set(buildings['container']),range_=1)
  assert route is not None,(t,p)
  roads.update(route)
roads.difference_update(occupied-set(buildings['container']))
# Minimum vertex cut against ALL eventual exits. Tunnel roads are passable here.
# Source-side protected tiles have a 3-tile buffer around vital structures.
walk={ (x,y) for y in range(50) for x in range(50) if not wall((x,y)) or (x,y) in tunnels}
protected=set()
for t,ps in buildings.items():
 if t in ['container','lab','extension','spawn','storage','terminal','tower','link','powerSpawn','nuker','observer']:
  for p in ps:
   protected|={n for n in walk if rng(p,n)<=3 and 3<=n[0]<=46 and 3<=n[1]<=46}
# Protect controller access against CLAIM attacks, and both energy sources.
for p in positions('controller')+positions('source'):
 protected|={n for n in walk if rng(p,n)<=1}
# Dinic maximum flow, split each tile into in/out vertices.
N=5002;S=5000;T=5001;graph=[[] for _ in range(N)];INF=1000000
sys.setrecursionlimit(20000)
def edge(a,b,c):
 graph[a].append([b,c,len(graph[b])]);graph[b].append([a,0,len(graph[a])-1])
old=set(positions('rampart'))
for p in sorted(walk):
 x,y=p;i=y*50+x
 border=x<2 or x>47 or y<2 or y>47
 # Cannot construct ramparts on natural walls, including completed tunnels.
 cap=INF if border or p in protected or wall(p) or p in natural else (1 if p in old else 10)
 edge(i,i+2500,cap)
 if p in protected:edge(S,i,INF)
 if x==0 or x==49 or y==0 or y==49:edge(i+2500,T,INF)
 for n in near(p):
  if n in walk:edge(i+2500,n[1]*50+n[0],INF)
while True:
 level=[-1]*N;level[S]=0;q=collections.deque([S])
 while q:
  a=q.popleft()
  for b,c,_ in graph[a]:
   if c and level[b]<0:level[b]=level[a]+1;q.append(b)
 if level[T]<0:break
 it=[0]*N
 def flow(a,f):
  if a==T:return f
  while it[a]<len(graph[a]):
   e=graph[a][it[a]];b,c,r=e
   if c and level[b]==level[a]+1:
    d=flow(b,min(f,c))
    if d:e[1]-=d;graph[b][r][1]+=d;return d
   it[a]+=1
  return 0
 while flow(S,INF):pass
seen={S};q=[S]
for a in q:
 for b,c,_ in graph[a]:
  if c and b not in seen:seen.add(b);q.append(b)
cut={p for p in walk if p[1]*50+p[0] in seen and p[1]*50+p[0]+2500 not in seen}
assert all(not wall(p) and 2<=p[0]<=47 and 2<=p[1]<=47 for p in cut)
barriers=cut|{p for p in old if 2<=p[0]<=47 and 2<=p[1]<=47}
barriers|=set(sum([buildings[t] for t in ['spawn','tower','storage','terminal']],[]))
# Sort the east gates first; existing ramparts don't consume site slots.
barriers=sorted(barriers,key=lambda p:(-p[0],p[1]))
# Every tile in a finished base, controller approach and source must be enclosed.
outside=set(p for p in walk if 0 in p or 49 in p);q=list(outside)
for p in q:
 for n in near(p):
  if n in walk and n not in outside and n not in barriers:outside.add(n);q.append(n)
assert not (protected & outside),('Leaking defense',protected&outside)
# Runtime progressively slices structure arrays by CONTROLLER_STRUCTURES.
buildings['road']=sorted(roads)
buildings['extractor']=positions('mineral')
result={'buildings':{k:[{'x':x,'y':y} for x,y in v] for k,v in buildings.items()},'barriers':[{'x':x,'y':y} for x,y in barriers], 'tunnel':[{'x':x,'y':y} for x,y in tunnels], 'sourceRoute':[{'x':x,'y':y} for x,y in shortcut]}
output='/* tslint:disable */\n// Generated by scripts/plan-e58s42.py from the checked-in terrain fixture.\nexport const E58S42_PLAN = '+json.dumps(result,indent='\t')+';\n'
target = ROOT/'src/roomPlanner/layouts/E58S42.ts'
if '--check' in sys.argv:
 assert target.read_text() == output, 'Regenerate the checked-in layout'
else:
 target.write_text(output)
print('Counts:',{t:len(ps) for t,ps in buildings.items()},'cut',len(cut),'total barriers',len(barriers),'labs',labs)

