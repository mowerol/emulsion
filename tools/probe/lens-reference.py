# SPDX-License-Identifier: GPL-3.0-or-later
# Usage: python3 tools/probe/lens-reference.py /path/to/darktable
# Compile the pinned upstream C functions against the metadata fixtures; no hand-reimplemented maths.
import pathlib,json,subprocess,sys,tempfile
root=pathlib.Path(__file__).resolve().parents[2]
upstream=pathlib.Path(sys.argv[1]).resolve()
commit=subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()
assert commit=='20891f6c6fa7be995e5bf9dff9d1ee5062051773',commit
scratch=tempfile.TemporaryDirectory(prefix='emulsion-lens-reference-')
tmp=pathlib.Path(scratch.name)
src=(upstream/'src/iop/lens.cc').read_text()
interp=src[src.index('static inline float _interpolate_linear_spline'):src.index('static int _init_coeffs_md_v1')]
calc=src[src.index('static int _init_coeffs_md_v2'):src.index('static void _use_latest_md_algo_callback')]
pre='''#include <cmath>
#include <cstdio>
#include <cstring>
#define MAXKNOTS 16
#define MIN(a,b) ((a)<(b)?(a):(b))
#define MAX(a,b) ((a)>(b)?(a):(b))
#define dt_fast_hypotf hypotf
#define DT_IOP_LENS_MODIFY_FLAG_DISTORTION 1
#define DT_IOP_LENS_MODIFY_FLAG_TCA 2
#define DT_IOP_LENS_MODIFY_FLAG_VIGNETTING 4
enum {CORRECTION_TYPE_FUJI=1,CORRECTION_TYPE_SONY,CORRECTION_TYPE_DNG,CORRECTION_TYPE_OLYMPUS};
struct dt_image_correction_data_t {
 struct {int nc;float distortion[16],ca_r[16],ca_b[16],vignetting[16];} sony;
 struct {int nc;float knots[16],distortion[16],ca_r[16],ca_b[16],vignetting[16];float cropf;} fuji;
 struct {bool has_dist,has_ca;float dist[4],ca[6];} olympus;
 struct {bool has_warp,has_vignette;int planes;float cwarp[3][6],cvig[5];} dng;
};
struct dt_image_t {dt_image_correction_data_t exif_correction_data;int exif_correction_type,p_width,p_height;};
struct dt_iop_lens_params_t {int modify_flags;float cor_dist_ft,cor_ca_r_ft,cor_ca_b_ft,cor_vig_ft;};
'''
rows=json.loads((root/'src/engine/fixtures/lens-metadata.json').read_text())
body=['int main(){puts("[");']
num=0
for idx,meta in enumerate(rows):
 for width,height,flags in [(1200,800,7),(800,1200,7),(1200,800,6),(1200,800,5),(1200,800,3)]:
  c=meta['correction'];kind=c['kind']
  if kind=='dng' and flags==6:continue # DNG's UI combines the geometry/CA flags.
  line=['{dt_image_t img={};','dt_iop_lens_params_t p={%d,1,1,1,1};'%flags,f'img.p_width={width};img.p_height={height};img.exif_correction_type=CORRECTION_TYPE_{kind.upper()};']
  def val(name,v):line.append(f'img.exif_correction_data.{kind}.{name}={json.dumps(v).lower()};')
  def arr(name,v):
   for j,x in enumerate(v):val(f'{name}[{j}]',x)
  if kind in ('fuji','sony'):
   val('nc',len(c['distortion']));arr('distortion',c['distortion']);arr('ca_r',c['red']);arr('ca_b',c['blue']);arr('vignetting',c['vignette'])
   if kind=='fuji':arr('knots',c['knots']);val('cropf',c['crop'])
  elif kind=='olympus':
   val('has_dist',c['distortion'] is not None);val('has_ca',c['ca'] is not None)
   if c['distortion']:arr('dist',c['distortion'])
   if c['ca']:arr('ca',c['ca'])
  else:
   val('has_warp',bool(c['warp']));val('has_vignette',bool(c['vignette']));val('planes',len(c['warp'] or []))
   for i,a in enumerate(c['warp'] or []):arr(f'cwarp[{i}]',a)
   if c['vignette']:arr('cvig',c['vignette'])
  line+=['float k[16]={},v[16]={},f[3][16]={},vk[16]={}; int n=_init_coeffs_md_v2(&img,&p,k,vk,f,v);']
  prefix=',' if num else ''
  line += ['printf("'+prefix+'{\\"fixture\\":%d,\\"width\\":%d,\\"height\\":%d,\\"flags\\":%d,\\"knots\\":[",'+f'{idx},{width},{height},{flags}'+');', 'for(int i=0;i<n;i++)printf("%s%.9g",i?",":"",k[i]);printf("],\\"factors\\":[");','for(int i=0;i<n;i++)printf("%s[%.9g,%.9g,%.9g]",i?",":"",f[0][i],f[1][i],f[2][i]);printf("]}");','}']
  body.extend(line);num+=1
body+=['puts("]");}']
(tmp/'reference.cpp').write_text(pre+interp+calc+'\n'.join(body))
subprocess.run(['clang++','-O2',str(tmp/'reference.cpp'),'-o',str(tmp/'reference')],check=True)
ref=json.loads(subprocess.check_output([str(tmp/'reference')]))
(root/'src/engine/fixtures/lens-reference.json').write_text(json.dumps(ref,indent=2)+'\n')
print('reference cases',len(ref))
