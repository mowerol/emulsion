# SPDX-License-Identifier: GPL-3.0-or-later
# Native reference harness for the pinned RawTherapee DCP port; see README.md.
import re
from pathlib import Path
import sys
root=Path(sys.argv[1])/'rtengine'
out=Path(sys.argv[2])
s=(root/'dcp.cc').read_text();h=(root/'dcp.h').read_text();color=(root/'color.h').read_text();curve=(root/'curves.h').read_text();math=(root/'rt_math.h').read_text();raw=(root/'rawimagesource.cc').read_text();icc=(root/'iccmatrices.h').read_text()
icc=re.sub(r'/\*.*?\*/','',icc,flags=re.S)
def fun(text,signature):
 a=text.index(signature);b=text.index('{',a);depth=1;i=b+1
 while depth:
  depth+=(text[i]=='{')-(text[i]=='}');i+=1
 return text[a:i]+'\n'
code='''// Reference extraction from RawTherapee b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c.
// Copyright (c) 2012 Oliver Duis <www.oliverduis.de>
// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// GPL-3.0-or-later. Numeric function bodies below are copied unchanged from upstream.
// Only dependency shells, stdin/output, and extracting matrix constants are local harness code.
#include <array>
#include <vector>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <iomanip>
#include <cassert>
#include <cstdint>
using std::min; using std::max;
template<class T> T min(T a,T b,T c){return std::min(a,std::min(b,c));}
template<class T> T max(T a,T b,T c){return std::max(a,std::max(b,c));}
'''
code+='template<typename T>\n'+fun(math,'bool invertMatrix(')
for name in ['xyz_sRGB','xyz_prophoto','prophoto_xyz']:
 a=icc.index('constexpr double '+name+'[3][3] =',0);b=icc.index(';',a)+1;code+=icc[a:b]+'\n'
code+='''struct ColorTemp { std::array<double,3> rgb; double temperature; void getMultipliers(double&r,double&g,double&b)const{r=rgb[0];g=rgb[1];b=rgb[2];}double getTemp()const{return temperature;} };
struct RawImageSource {static void inverse33(const double(*)[3],double(*)[3]);};
struct DCPProfile {
 using Triple=std::array<double,3>;using Matrix=std::array<Triple,3>;
 struct HsbModify{float hue_shift,sat_scale,val_scale;};
 struct HsdTableInfo{int hue_divisions,sat_divisions,val_divisions,hue_step,val_step;unsigned array_count;bool srgb_gamma;struct{float h_scale,s_scale,v_scale;int max_hue_index0,max_sat_index0,max_val_index0,hue_step,val_step;}pc;};
 Matrix color_matrix_1{},color_matrix_2{},forward_matrix_1{},forward_matrix_2{};
 bool has_color_matrix_1=true,has_color_matrix_2=false,has_forward_matrix_1=false,has_forward_matrix_2=false;
 double temperature_1=5000,temperature_2=6500;std::vector<HsbModify>deltas_1,deltas_2;HsdTableInfo delta_info{};
 Matrix findXyztoCamera(const std::array<double,2>&,int)const;
 std::array<double,2> neutralToXy(const Triple&,int)const;
 Matrix makeXyzCam(const ColorTemp&,const Triple&,const Matrix&,int)const;
 std::vector<HsbModify> makeHueSatMap(const ColorTemp&,int)const;
 void hsdApply(const HsdTableInfo&,const std::vector<HsbModify>&,float&,float&,float&)const;
};
'''
# Gamma LUT shell follows RT LUT<float> interpolation (clip flags zero for these gamma tables).
code+='''struct GammaLut {std::vector<float> data; float operator[](float index)const {int idx=(int)index;if(index<0)idx=0;else if(index>65534.f)idx=65534;float diff=index-idx;return data[idx]+(data[idx+1]-data[idx])*diff;} };
struct Color{static constexpr double sRGBGammaCurve=2.4;static GammaLut gammatab_srgb1,igammatab_srgb1;
'''
for sig in ['static inline double gamma2 ', 'static inline double igamma2 ', 'static inline bool rgb2hsvdcp(', 'static inline void rgb2hsvtc(', 'static inline void hsv2rgbdcp ']:code+=fun(color,sig)
code+='};\nGammaLut Color::gammatab_srgb1,Color::igammatab_srgb1;\n'
code+=fun(raw,'void RawImageSource::inverse33(')
for sig in ['DCPProfile::Matrix invert3x3(', 'DCPProfile::Matrix multiply3x3(', 'DCPProfile::Triple multiply3x3_v3(', 'DCPProfile::Matrix mix3x3(', 'DCPProfile::Matrix mapWhiteMatrix(', 'std::array<double, 2> xyzToXy(', 'DCPProfile::Triple xyToXyz(', 'double calibrationIlluminantToTemperature(', 'double xyCoordToTemperature(', 'DCPProfile::Matrix DCPProfile::findXyztoCamera(', 'std::array<double, 2> DCPProfile::neutralToXy(', 'DCPProfile::Matrix DCPProfile::makeXyzCam(', 'std::vector<DCPProfile::HsbModify> DCPProfile::makeHueSatMap(', 'inline void DCPProfile::hsdApply(']: code+=fun(s,sig)
code+='''
void initGamma(){for(int i=0;i<65536;i++){Color::gammatab_srgb1.data.push_back(Color::gamma2(i/65535.0));Color::igammatab_srgb1.data.push_back(Color::igamma2(i/65535.0));}}
void printTriple(const DCPProfile::Triple&a){std::cout<<'['<<a[0]<<','<<a[1]<<','<<a[2]<<']';}
void printMatrix(const DCPProfile::Matrix&a){std::cout<<'[';for(int i=0;i<3;i++){if(i)std::cout<<',';printTriple(a[i]);}std::cout<<']';}
int main(){std::cout<<std::setprecision(17);initGamma();std::string mode;std::cin>>mode;DCPProfile p;
 if(mode=="matrix"){
  std::cin>>p.has_color_matrix_1>>p.has_color_matrix_2>>p.has_forward_matrix_1>>p.has_forward_matrix_2>>p.temperature_1>>p.temperature_2;
  for(auto m:{&p.color_matrix_1,&p.color_matrix_2,&p.forward_matrix_1,&p.forward_matrix_2})for(auto&r:*m)for(double&v:r)std::cin>>v;
  DCPProfile::Triple neutral;for(double&v:neutral)std::cin>>v;double temperature;int preferred;std::cin>>temperature>>preferred;
  DCPProfile::Matrix cam;for(int i=0;i<3;i++)for(int j=0;j<3;j++)cam[i][j]=xyz_sRGB[i][j];
  ColorTemp wb{neutral,temperature};auto xy=p.neutralToXy(neutral,preferred);std::cout<<"{\\"whiteXY\\":["<<xy[0]<<','<<xy[1]<<"],\\"temperature\\":"<<xyCoordToTemperature(xy)<<",\\"cameraToXyzD50\\":";printMatrix(p.makeXyzCam(wb,{1,1,1},cam,preferred));std::cout<<"}\\n";
 }else if(mode=="hsd"){
  DCPProfile::HsdTableInfo info{};std::cin>>info.hue_divisions>>info.sat_divisions>>info.val_divisions>>info.srgb_gamma;
  info.array_count=info.hue_divisions*info.sat_divisions*info.val_divisions;info.pc.h_scale=info.hue_divisions<2?0.f:info.hue_divisions/6.f;info.pc.s_scale=info.sat_divisions-1;info.pc.v_scale=info.val_divisions-1;info.pc.max_hue_index0=info.hue_divisions-1;info.pc.max_sat_index0=info.sat_divisions-2;info.pc.max_val_index0=info.val_divisions-2;info.pc.hue_step=info.sat_divisions;info.pc.val_step=info.hue_divisions*info.pc.hue_step;
  std::vector<DCPProfile::HsbModify> table(info.array_count);for(auto&t:table)std::cin>>t.hue_shift>>t.sat_scale>>t.val_scale;
  int count;std::cin>>count;std::cout<<'[';for(int i=0;i<count;i++){float h,s,v;std::cin>>h>>s>>v;p.hsdApply(info,table,h,s,v);if(i)std::cout<<',';printTriple({h,s,v});}std::cout<<"]\\n";
 }
}
'''
(out/'dcp-core.cpp').write_text(code)
print(out/'dcp-core.cpp')
