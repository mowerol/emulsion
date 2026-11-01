# SPDX-License-Identifier: GPL-3.0-or-later
# Native reference harness for the pinned RawTherapee DCP port; see README.md.
from pathlib import Path
import sys
root=Path(sys.argv[1])/'rtengine'
code=(Path(sys.argv[2])/'dcp-core.cpp').read_text()
def fun(s,sig):
 a=s.index(sig);b=s.index('{',a);depth=1;i=b+1
 while depth:
  if s[i]=='{':depth+=1
  elif s[i]=='}':depth-=1
  i+=1
 return s[a:i]+'\n'
curve=(root/'curves.h').read_text();diag=(root/'diagonalcurves.cc').read_text();dcp=(root/'dcp.cc').read_text()
insert='''
#include <cassert>
#define CLIP(a) ((a)>0.f?((a)<65535.f?(a):65535.f):0.f)
#define CLIPD(a) ((a)>0.0?((a)<1.0?(a):1.0):0.0)
template<class T>bool OOG(T v){return v<0||v>65535;}
'''
insert+=fun(curve,'inline void setUnlessOOG(float &r,')
insert+='''struct DiagonalCurve {
 int N,kind;double*x,*y,*ypp=nullptr;
 DiagonalCurve(const std::vector<double>&p){N=p.size()/2;x=new double[N];y=new double[N];for(int i=0;i<N;i++){x[i]=p[2*i];y[i]=p[2*i+1];}kind=N>2?1:0;if(N>2)spline_cubic_set();}
 ~DiagonalCurve(){delete[]x;delete[]y;delete[]ypp;}
 void spline_cubic_set();double getVal(double t)const;
};
'''
insert+=fun(diag,'void DiagonalCurve::spline_cubic_set ()')
a=diag.index('    case DCT_Linear :',diag.index('double DiagonalCurve::getVal'));b=diag.index('    case DCT_CatumullRom:',a)
insert+='enum {DCT_Linear=0,DCT_Spline=1};\ndouble DiagonalCurve::getVal(double t)const {switch(kind){\n'+diag[a:b]+'default:return t;}}\n'
insert+='''struct AdobeToneCurve {GammaLut lutToneCurve;void Set(const DiagonalCurve&p){lutToneCurve.data.resize(65536);for(int i=0;i<65536;i++)lutToneCurve.data[i]=(float)p.getVal(float(i)/65535.f)*65535.f;}void Apply(float&,float&,float&)const;void RGBTone(float&,float&,float&)const;};
'''
insert+=fun(curve,'inline void AdobeToneCurve::Apply(')+fun(curve,'inline void AdobeToneCurve::RGBTone (float&')
code=code.replace('struct GammaLut {std::vector<float> data;', 'struct GammaLut {std::vector<float> data;explicit operator bool()const{return !data.empty();}')
code=code.replace('struct DCPProfile {','struct AdobeToneCurve;struct DCPProfileApplyState;\nstruct DCPProfile {')
code=code.replace('double temperature_1=5000,temperature_2=6500;', 'AdobeToneCurve* tone_curve_ptr=nullptr;std::vector<HsbModify>look_table;HsdTableInfo look_info{};void step2ApplyTile(float*,float*,float*,int,int,int,const DCPProfileApplyState&)const;\n double temperature_1=5000,temperature_2=6500;')
insert+='''struct DCPProfileApplyState {struct Data{bool use_tone_curve=false,apply_look_table=false,already_pro_photo=true;float bl_scale=1;float pro_photo[3][3]{},work[3][3]{};};Data*data;DCPProfileApplyState(){data=new Data;}~DCPProfileApplyState(){delete data;}};
'''
insert+=fun(dcp,'void DCPProfile::step2ApplyTile(').replace('tone_curve.Apply(','tone_curve_ptr->Apply(')
code=code.replace('void initGamma()',insert+'\nvoid initGamma()')
branch=''' }else if(mode=="step2"){
 bool tone,look;float scale;std::cin>>tone>>look>>scale;int np;std::cin>>np;std::vector<double>points(np*2);for(double&v:points)std::cin>>v;DiagonalCurve spline(points);AdobeToneCurve tc;tc.Set(spline);p.tone_curve_ptr=&tc;
 auto&info=p.look_info;std::cin>>info.hue_divisions>>info.sat_divisions>>info.val_divisions>>info.srgb_gamma;info.array_count=info.hue_divisions*info.sat_divisions*info.val_divisions;info.pc.h_scale=info.hue_divisions<2?0.f:info.hue_divisions/6.f;info.pc.s_scale=info.sat_divisions-1;info.pc.v_scale=info.val_divisions-1;info.pc.max_hue_index0=info.hue_divisions-1;info.pc.max_sat_index0=info.sat_divisions-2;info.pc.max_val_index0=info.val_divisions-2;info.pc.hue_step=info.sat_divisions;info.pc.val_step=info.hue_divisions*info.pc.hue_step;
 p.look_table.resize(info.array_count);for(auto&t:p.look_table)std::cin>>t.hue_shift>>t.sat_scale>>t.val_scale;
 DCPProfileApplyState state;state.data->use_tone_curve=tone;state.data->apply_look_table=look;state.data->bl_scale=scale;int n;std::cin>>n;std::vector<float>r(n),g(n),b(n);for(int i=0;i<n;i++){std::cin>>r[i]>>g[i]>>b[i];r[i]*=65535.f;g[i]*=65535.f;b[i]*=65535.f;}p.step2ApplyTile(r.data(),g.data(),b.data(),n,1,n,state);std::cout<<'[';for(int i=0;i<n;i++){if(i)std::cout<<',';printTriple({r[i]/65535.f,g[i]/65535.f,b[i]/65535.f});}std::cout<<"]\\n";
'''
code=code.replace(' }else if(mode=="hsd")',branch+' }else if(mode=="hsd")')
(Path(sys.argv[2])/'dcp-core.cpp').write_text(code)
