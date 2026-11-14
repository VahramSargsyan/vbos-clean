import {deflateSync} from 'node:zlib';

function crc32(bytes) {
 let crc = 0xffffffff;
 for(const b of bytes){crc ^= b;for(let i=0;i<8;i++) crc=(crc>>>1)^(crc&1?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
const chunk=(name,buffer)=>{const t=Buffer.from(name);const out=Buffer.alloc(12+buffer.length);out.writeUInt32BE(buffer.length,0);t.copy(out,4);buffer.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([t,buffer])),8+buffer.length);return out;};
function icon(size) {
 const lineBytes = size*4+1, bytes=Buffer.alloc(size*lineBytes);
 const fill=(x,y,r,g,b)=>{const p=y*lineBytes+1+x*4;bytes[p]=r;bytes[p+1]=g;bytes[p+2]=b;bytes[p+3]=255;};
 const scale=size/100;
 const px=(x,y,w,h,r,g,b)=>{const minX=Math.max(0,Math.round(x*scale)),maxX=Math.min(size,Math.round((x+w)*scale));const minY=Math.max(0,Math.round(y*scale)),maxY=Math.min(size,Math.round((y+h)*scale));for(let yy=minY;yy<maxY;yy++)for(let xx=minX;xx<maxX;xx++)fill(xx,yy,r,g,b);};
 const glyphs={
 V:['10001','10001','10001','10001','10001','01010','00100'],
 B:['11110','10001','10001','11110','10001','10001','11110'],
 O:['01110','10001','10001','10001','10001','10001','01110'],
 S:['01111','10000','10000','01110','00001','00001','11110']
 };
 for(let y=0;y<size;y++){bytes[y*lineBytes]=0;for(let x=0;x<size;x++){const X=(x+.5)/scale, Y=(y+.5)/scale;
  const radius=20,dx=Math.max(14-X,0,X-86),dy=Math.max(14-Y,0,Y-86),rounded=(dx*dx+dy*dy>radius*radius);
  const border=(X<16||X>84||Y<16||Y>84);
  const bg=rounded?[10,17,29]:border?[16,34,54]:[15,27,44];
  fill(x,y,...bg);
 }}
 function paintLetter(ch,x,y,s=4.1){
  glyphs[ch].forEach((row,ry)=>[...row].forEach((cell,rx)=>{if(cell==='1')px(x+rx*s,y+ry*s,s*.86,s*.86,241,246,250);}));
 }
 paintLetter('V',21,31);paintLetter('B',55,31);
 // Mint trend/energy line along the bottom edge
 const pts=[[23,75],[37,68],[51,73],[63,62],[77,59]];
 for(let i=1;i<pts.length;i++){
  const a=pts[i-1],b=pts[i],steps=100;
  for(let t=0;t<=steps;t++){const k=t/steps,x=a[0]+(b[0]-a[0])*k,y=a[1]+(b[1]-a[1])*k;px(x,y,1.8,1.8,103,228,185);}
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(bytes,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
export const ICON_192=icon(192);
export const ICON_512=icon(512);
