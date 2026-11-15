# SPDX-License-Identifier: GPL-3.0-or-later
# Usage: python3 verify.py FOLDER [_Suffix]. Every RAF in the folder has exactly one JPEG with the folder's film simulation, base settings, DR100
# and the RAW's own white balance shift.
import sys,os,re,struct,collections
D=sys.argv[1]; SUFFIX=sys.argv[2] if len(sys.argv)>2 else ''
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fujiexif import *  # noqa: E402,F403
def info(path, embedded=False):
    b=open(path,'rb').read(4*1024*1024 if embedded else 131072)
    if embedded: off,ln=struct.unpack('>II',b[84:92]); b=b[off:off+131072]
    t=exif_from(b); e='<' if t[:2]==b'II' else '>'
    i0=ifd(t,struct.unpack(e+'I',t[4:8])[0],e); ex=ifd(t,u(t,i0[0x8769],e),e)
    mn=t[u(t,ex[0x927c],e):]; mi=ifd(mn,struct.unpack('<I',mn[8:12])[0],'<')
    g=lambda k:u(mn,mi[k],'<') if k in mi else None
    s=g(0x100a)
    return dict(film=g(0x1401), sat=g(0x1003), dr=g(0x1403) or g(0x140b), hi=g(0x1041), sh=g(0x1040), clarity=g(0x100f), cce=g(0x1048), fxb=g(0x104e), grain=g(0x1047), wb=g(0x1002), shift=tuple(s) if isinstance(s,tuple) else (0,0), cs=u(t,ex[0xa001],e) if 0xa001 in ex else None)
jps=collections.defaultdict(list)
for f in os.listdir(D):
    m=re.match(r'^(.+?)(\(\d+\))?\.jpe?g$',f,re.I)
    if m: jps[m.group(1)].append(f)
films=collections.Counter(); bad=[]
raws=[f for f in sorted(os.listdir(D)) if f.upper().endswith(SUFFIX.upper()+'.RAF')]
for f in raws:
    stem=f[:-4]
    if not jps[stem]: print('no JPEG, left out:', stem); continue
    if len(jps[stem])!=1: bad.append((stem,'JPEGs',jps[stem])); continue
    j=info(os.path.join(D,jps[stem][0])); r=info(os.path.join(D,f),True)
    films[j['film']]+=1
    issues=[k for k in ('hi','sh','clarity','cce','fxb','grain') if (j[k] or 0)!=0]
    if j['sat'] not in (0,None): issues.append(f"colour {j['sat']}")
    if j['dr']!=100: issues.append(f"JPEG DR{j['dr']}")
    if j['wb']!=r['wb'] or j['shift']!=r['shift']: issues.append('white balance')
    if j['cs']!=1: issues.append('colour space')
    if issues: bad.append((stem,issues))
if len(films)!=1: bad.append(('film simulations differ', dict(films)))
for b in bad: print(b)
print(f'{len(raws)} RAWs, {len(raws)-len(bad)} good, film {dict(films)}')
sys.exit(1 if bad else 0)
