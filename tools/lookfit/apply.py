# SPDX-License-Identifier: GPL-3.0-or-later
# Add (or update) fitted Emulsion x Fuji looks in the looks file, from the batch's results.
import json,sys,os
NAMES={'emulsion-film-pro-neg-hi':'Pro Neg Hi','emulsion-film-pro-neg-std':'Pro Neg Std','emulsion-film-provia':'Provia',
 'emulsion-film-velvia':'Velvia','emulsion-film-astia':'Astia','emulsion-film-eterna':'Eterna','emulsion-film-bleach':'Eterna Bleach Bypass',
 'emulsion-fuji-acros':'Acros','emulsion-fuji-acros-ye':'Acros + Ye','emulsion-fuji-acros-r':'Acros + R','emulsion-fuji-acros-g':'Acros + G',
 'emulsion-fuji-monochrome':'Monochrome','emulsion-fuji-monochrome-ye':'Monochrome + Ye','emulsion-fuji-monochrome-r':'Monochrome + R',
 'emulsion-fuji-monochrome-g':'Monochrome + G','emulsion-fuji-sepia':'Sepia',
 'emulsion-fuji-reala-ace':'Reala Ace','emulsion-fuji-nostalgic-neg':'Nostalgic Neg'}
# Usage: python3 apply.py LOOKS.json <look id> ...  (results from .scratch/batch/<id>/ in this worktree)
import os
p=sys.argv[1]; W=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','.scratch','batch')
d=json.load(open(p))
for id in sys.argv[2:]:
    fit=json.load(open(f'{W}/{id}/fitted-look.json'))['settings']
    assert fit['curve']['rgb'][-1]==[1,1]
    st=dict(fit); st['color']={k:[int(round(v)) for v in fit['color'][k]] for k in ('hue','sat','bright')}
    cb={}
    for k,v in fit['colorBalance'].items():
        cb[k]=round(v,5) if k.endswith('_C') else round(v,2) if k.endswith('_H') else round(v,4) if isinstance(v,float) else v
    st['colorBalance']=cb
    old=next((l for l in d if l['id']==id),None)
    entry={'id':id,'name':NAMES[id],'category':'Emulsion x Fuji','bw':fit.get('colorBalance',{}).get('chroma_global')==-1,'revision':(old['revision']+1) if old else 1,'settings':st}
    if old: d[d.index(old)]=entry
    elif entry['bw']: d.append(entry)
    else:
        # A colour look goes after the other colour Emulsion x Fuji looks, before the black and white ones.
        last=max(i for i,l in enumerate(d) if l.get('category')=='Emulsion x Fuji' and not l.get('bw'))
        d.insert(last+1,entry)
    if not os.path.exists(f'{W}/{id}/tone-report.json'): print(f"{NAMES[id]:22} rev {entry['revision']}"); continue
    t=json.load(open(f'{W}/{id}/tone-report.json'))
    tone=sum(x['after']['meanAbsDL'] for x in t['photos'])/len(t['photos'])
    c=json.load(open(f'{W}/{id}/color-report.json'))
    m=lambda f,k:sum(x[k]['meanDE'] for x in c['photos'] if f(x))/max(1,sum(1 for x in c['photos'] if f(x)))
    print(f"{NAMES[id]:22} rev {entry['revision']}  tone |ΔL*| {tone:.2f}  colour ΔE fitted {m(lambda x:not x['held'],'before'):.2f} -> {m(lambda x:not x['held'],'after'):.2f}, held out {m(lambda x:x['held'],'before'):.2f} -> {m(lambda x:x['held'],'after'):.2f}")
open(p,'w').write(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
