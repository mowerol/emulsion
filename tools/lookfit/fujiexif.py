# SPDX-License-Identifier: GPL-3.0-or-later
# Minimal EXIF and Fujifilm maker-note reading (tag numbers from ExifTool's FujiFilm table), shared by
# the X RAW Studio scripts here. exif_from(jpeg bytes) -> TIFF bytes; ifd/u read directories and values.
import struct
def exif_from(buf):
    i=2
    while i<len(buf)-4:
        if buf[i]!=0xFF: return None
        m=buf[i+1]; L=struct.unpack('>H',buf[i+2:i+4])[0]
        if m==0xE1 and buf[i+4:i+10]==b'Exif\0\0': return buf[i+10:i+2+L]
        i+=2+L
def ifd(t,off,e):
    n=struct.unpack(e+'H',t[off:off+2])[0]; return {struct.unpack(e+'H',t[off+2+12*k:off+4+12*k])[0]:t[off+2+12*k:off+14+12*k] for k in range(n)}
def u(t,ent,e):
    typ,cnt=struct.unpack(e+'HI',ent[2:8])
    if typ==3: return struct.unpack(e+'H',ent[8:10])[0]
    if typ==8: return struct.unpack(e+'h',ent[8:10])[0]
    if typ==9 and cnt==1: return struct.unpack(e+'i',ent[8:12])[0]
    if typ==9: o=struct.unpack(e+'I',ent[8:12])[0]; return struct.unpack(e+'%di'%cnt,t[o:o+4*cnt])
    if typ in (4,7): return struct.unpack(e+'I',ent[8:12])[0]
    o=struct.unpack(e+'I',ent[8:12])[0]
    if typ==5: a,b=struct.unpack(e+'II',t[o:o+8]); return a/b
    if typ==10: a,b=struct.unpack(e+'ii',t[o:o+8]); return a/b
FILM={0:'Provia',0x200:'Velvia',0x400:'Velvia',0x120:'Astia',0x300:'Astia',0x500:'ProNegStd',0x501:'ProNegHi',0x600:'ClassicChrome',0x700:'Eterna',0x800:'ClassicNeg',0x900:'BleachBypass',0xa00:'NostalgicNeg',0xb00:'RealaAce'}
