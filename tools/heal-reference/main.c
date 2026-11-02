#include <stdio.h>
#include <stdlib.h>
#include "heal.h"
/* reads: w h maxiter, then src (w*h*4), dest (w*h*4), mask (w*h) floats from stdin; writes dest */
int main(){int w,h,it; if(scanf("%d %d %d",&w,&h,&it)!=3) return 1; size_t n=(size_t)w*h;
float*s=malloc(n*16),*d=malloc(n*16),*m=malloc(n*4);
for(size_t i=0;i<n*4;i++)scanf("%f",&s[i]); for(size_t i=0;i<n*4;i++)scanf("%f",&d[i]); for(size_t i=0;i<n;i++)scanf("%f",&m[i]);
dt_heal(s,d,m,w,h,4,it); for(size_t i=0;i<n*4;i++)printf("%.9g\n",d[i]); return 0;}
