# SPDX-License-Identifier: GPL-3.0-or-later
# Make one X RAW Studio folder holding every RAW once per film simulation: APFS clones (no extra
# space) named <RAW>_<Tag>.RAF, each with a settings file (.FP2) for that simulation at base
# settings and DR100, and the RAW's OWN white balance shift (the RAF's as-shot white balance
# includes Fuji's fine-tune shift, so the JPEG must keep it too).
#
#   python3 xraw_folder.py TEMPLATE.FP2 OUT_FOLDER Tag=XRAWName [Tag=XRAWName ...] -- SOURCE_FOLDER [...]
#
# TEMPLATE.FP2: a settings file X RAW Studio wrote for one of these RAWs, already at the base recipe
# (only SourceFileName, WBShiftR/B and FilmSimulation are changed). X RAW Studio's simulation names:
# Provia Velvia Astia Classic NEGAhi NEGAStd ClassicNEGA Eterna BleachBypass (colour), Acros AcrosYe
# AcrosR AcrosG BW BYe BR BG Sepia (black and white); NostalgicNEGA and Reala need a newer camera.
import sys,os,re,struct,subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fujiexif import *  # noqa: E402,F403
args=sys.argv[1:]; cut=args.index('--')
template_path,out=args[0],args[1]; sims=[a.split('=') for a in args[2:cut]]; sources=args[cut+1:]
template=open(template_path).read()
def setv(x,k,v):
    y,n=re.subn(f'<{k}>[^<]*</{k}>',f'<{k}>{v}</{k}>',x); assert n==1,k; return y
def shot_shift(raf):
    b=open(raf,'rb').read(4*1024*1024); off,ln=struct.unpack('>II',b[84:92]); t=exif_from(b[off:off+131072]); e='<' if t[:2]==b'II' else '>'
    i0=ifd(t,struct.unpack(e+'I',t[4:8])[0],e); ex=ifd(t,u(t,i0[0x8769],e),e); mn=t[u(t,ex[0x927c],e):]; mi=ifd(mn,struct.unpack('<I',mn[8:12])[0],'<')
    s=u(mn,mi[0x100a],'<') if 0x100a in mi else None
    assert (u(mn,mi[0x1002],'<') if 0x1002 in mi else 0)==0, f'{raf}: white balance is not Auto'
    return (s[0]//20, s[1]//20) if isinstance(s,tuple) else (0,0)
assert not os.path.exists(out), out
os.mkdir(out)
raws=[os.path.join(d,f) for d in sources for f in sorted(os.listdir(d)) if f.upper().endswith('.RAF')]
assert len(set(os.path.basename(r) for r in raws))==len(raws), 'two RAWs share a name'
shifts={r:shot_shift(r) for r in raws}
for tag,sim in sims:
    for r in raws:
        name=f'{os.path.basename(r)[:-4]}_{tag}.RAF'
        subprocess.run(['cp','-c','-p',r,os.path.join(out,name)],check=True)
        R,Bs=shifts[r]
        x=setv(template,'SourceFileName',name); x=setv(x,'WBShiftR',R); x=setv(x,'WBShiftB',Bs); x=setv(x,'FilmSimulation',sim)
        open(os.path.join(out,name[:-4]+'.FP2'),'w').write(x)
print(len(sims)*len(raws),'RAWs with settings in',out)
