# SPDX-License-Identifier: GPL-3.0-or-later
# Native reference harness for the pinned RawTherapee DCP port; see README.md.
import sys
import json,subprocess,math
from pathlib import Path
def flat(v):return ' '.join(flat(x) for x in v) if isinstance(v,(list,tuple)) else str(v)
def run(v):return json.loads(subprocess.check_output([sys.argv[1]],input=flat(v).encode()))
m1=[[.72,-.18,-.04],[-.13,1.1,.08],[.01,.12,.61]];m2=[[.64,-.12,-.06],[-.18,1.18,.1],[.03,.08,.72]]
f1=[[.62,.22,.1242],[.2,.74,.06],[.01,.08,.7352]];f2=[[.65,.2,.1142],[.23,.7,.07],[.02,.06,.7452]]
cases=[]
for forward in [False,True]:
 for n in [[.5,1,.7],[.25,1,.9],[.9,1,.3]]:
  args=['matrix',[1,1,int(forward),int(forward)],[2850,6500],[m1,m2,f1,f2],n,5000,0]
  cases.append(dict(forward=forward,neutral=n,expected=run(args)))
tables=[]
for nv,gamma in [(1,False),(3,False),(3,True)]:
 dims=[4,3,nv];data=[]
 for v in range(nv):
  for h in range(4):
   for s in range(3):data.extend([h*3-s*1.5+v,.9+s*.05+h*.01,1+v*.04-s*.02])
 inputs=[[0,0,0],[.1,.75,.5],[1.5,1,1],[3.2,.3,.08],[5.9,.95,.95],[6,1,1],[4.4,.6,1.2]]
 tables.append(dict(dims=dims,gamma=gamma,data=data,inputs=inputs,outputs=run(['hsd',dims,int(gamma),data,len(inputs),inputs])))
points=[0,0,.08,.12,.22,.35,.5,.7,1,1]
inputs=[[.2,.1,.02],[.02,.2,.1],[.2,.02,.1],[.1,.02,.2],[.1,.2,.02],[.02,.1,.2],[.18,.18,.18],[-.1,.1,.4],[2,3,4],[1.2,.2,.4],[0,0,0]]
step=[]
for look in [False,True]:
 for tone in [False,True]:
  t=tables[2];args=['step2',int(tone),int(look),1.2,len(points)//2,points,t['dims'],int(t['gamma']),t['data'],len(inputs),inputs]
  step.append(dict(tone=tone,look=look,scale=1.2,points=points,table=t,inputs=inputs,outputs=run(args)))
out=dict(source='RawTherapee b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c: unchanged matrix/hsd/step2/AdobeToneCurve bodies in native harness; synthetic tables and matrices',matrix1=m1,matrix2=m2,forward1=f1,forward2=f2,matrices=cases,tables=tables,step2=step)
Path(sys.argv[2]).write_text(json.dumps(out,indent=2)+'\n')
