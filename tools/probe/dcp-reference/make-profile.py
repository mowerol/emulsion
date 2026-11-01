# SPDX-License-Identifier: GPL-3.0-or-later
# Native reference harness for the pinned RawTherapee DCP port; see README.md.
import sys
import struct,json
from pathlib import Path
n=json.loads(Path(sys.argv[1]).read_text())
t=n['tables'][2]
strings={50708:'Test Camera',50936:'Camera Standard',50942:'Synthetic test profile (GPL-3.0-or-later)'}
tags=[]
for tag,text in strings.items():tags.append((tag,2,len(text)+1,text.encode()+b'\0'))
for tag,v in [(50778,17),(50779,21)]:tags.append((tag,3,1,struct.pack('<H',v)))
for tag,m in [(50721,n['matrix1']),(50722,n['matrix2']),(50964,n['forward1']),(50965,n['forward2'])]:
 data=b''.join(struct.pack('<ii',round(v*1000000),1000000)for row in m for v in row);tags.append((tag,10,9,data))
for tag in [50937,50981]:tags.append((tag,4,3,struct.pack('<III',*t['dims'])))
for tag in [50938,50982]:tags.append((tag,11,len(t['data']),struct.pack('<'+'f'*len(t['data']),*t['data'])))
for tag in [51107,51108]:tags.append((tag,4,1,struct.pack('<I',1)))
p=n['step2'][0]['points'];tags.append((50940,11,len(p),struct.pack('<'+'f'*len(p),*p)))
tags.append((51109,12,1,struct.pack('<d',.25)))
tags.sort();offset=8+2+len(tags)*12+4;header=bytearray(b'II*\0\x08\0\0\0'+struct.pack('<H',len(tags)));data=bytearray()
for tag,typ,count,raw in tags:
 inline=raw.ljust(4,b'\0')if len(raw)<=4 else struct.pack('<I',offset+len(data));header+=struct.pack('<HHI',tag,typ,count)+inline
 if len(raw)>4:data+=raw
header+=bytes(4);Path(sys.argv[2]).write_bytes(header+data)
