// SPDX-License-Identifier: GPL-3.0-or-later
// Build with native/perspective.cpp to regenerate the checked-in native fixture.
#include <cstdio>
extern "C" void emulsion_perspective_matrix(int, int, const double *, float *);
int main() {
  const double cases[][4]={{0,0,0,28},{3,15,0,28},{-4,-12,18,50},{7,30,-25,24}};
  printf("[\n");
  for(int j=0;j<4;j++) {
    float m[9]; emulsion_perspective_matrix(600,400,cases[j],m);
    printf("{\"params\":[%.9g,%.9g,%.9g,%.9g],\"matrix\":[",cases[j][0],cases[j][1],cases[j][2],cases[j][3]);
    for(int i=0;i<9;i++) printf("%s%.9g",i?",":"",m[i]);
    printf("]}%s\n",j<3?",":"");
  }
  printf("]\n");
}
