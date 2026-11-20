// Galaga Rev. B board. The three Z80s share work RAM and video RAM.
import Z80 from 'https://cdn.jsdelivr.net/gh/iapx86/JavaScript@9ca520534893f4348274aa24b979d99697f3102d/z80.js';
import Wavetable from 'https://cdn.jsdelivr.net/gh/iapx86/JavaScript@9ca520534893f4348274aa24b979d99697f3102d/pac-man_sound.js';
export class Board{
 constructor(files){
  this.ram=new Uint8Array(8192);this.cpus=Array.from({length:3},()=>new Z80(3072000));
  this.irq=[false,false,false];this.command=16;this.switches=false;this.credits=0;this.startEnabled=true;this.startPending=false;this.controls=255;this.stars=new Uint8Array(8);this.scroll=0;
  this.sound=new Wavetable({SND:files['prom-1.1d']});
  const programs=[['gg1_1b.3p','gg1_2b.3m','gg1_3.2m','gg1_4b.2l'],['gg1_5b.3f'],['gg1_7b.2c']];
  this.cpus.forEach((cpu,i)=>{
   programs[i].forEach((name,bank)=>{for(let p=0;p<16;p++)cpu.memorymap[bank*16+p].base=files[name].subarray(p*256,(p+1)*256)});
   for(let p=0;p<32;p++){let page=cpu.memorymap[128+p];page.base=this.ram.subarray(p*256,(p+1)*256);page.write=null}
   for(let p of [0x68,0x70,0x71,0xa0]){let page=cpu.memorymap[p];page.write=(addr,v)=>this.write(addr,v);page.read=addr=>this.read(addr)}
  });
  this.cpus[0].reset();
  this.char=files['gg1_9.4l'];this.obj=new Uint8Array(8192);this.obj.set(files['gg1_11.4d']);this.obj.set(files['gg1_10.4f'],4096);
  this.charLut=files['prom-4.2n'];this.objLut=files['prom-3.1c'];
  this.pal=Array.from(files['prom-5.5n'],v=>{const lev=n=>33*(n&1)+71*((n>>1)&1)+151*((n>>2)&1);return (0xff000000|lev(v)|(lev(v>>3)<<8)|(lev((v>>6)<<1)<<16))>>>0});
  this.pixels=new Uint32Array(224*288);this.starPoints=[];
  let shift=0;for(let y=0;y<256;y++)for(let x=511;x>=0;x--){shift=(shift*2+(((~shift>>16)^(shift>>4))&1))&0x3ffff;if(!(shift&65536)&&(shift&255)===255)this.starPoints.push([x,y,(~shift>>8)&63])}
 }
 read(a){
  if((a>>8)===0x68)return [3,3,3,1,3,2,2,3][a&7];
  if((a>>8)===0x71)return this.command;
  if((a>>8)!==0x70||!(this.command&1))return 255;
  if((a&15)===0){
   if(this.switches)return 255;
   if(this.startPending&&this.startEnabled&&this.credits){this.credits--;this.startEnabled=false}
   this.startPending=false;return (Math.floor(this.credits/10)<<4)|(this.credits%10);
  }
  return (a&15)===1?this.controls:255;
 }
 write(a,v){
  if(a>=0x6800&&a<0x6820)this.sound.write(a,v);
  else if(a>=0x6820&&a<=0x6822)this.irq[a-0x6820]=a===0x6822?!(v&1):!!(v&1);
  else if(a===0x6823)for(const c of this.cpus.slice(1))v&1?c.enable():c.disable();
  else if((a>>8)===0x71){this.command=v;if(v===0xe1)this.ram.fill(0,0x11b5,0x11b9)}
  else if((a>>8)===0x70&&(this.command&1)&&!(a&15)){
   switch(v&15){case 1:this.credits=0;this.switches=false;this.startEnabled=true;break;case 2:this.startEnabled=true;break;case 3:this.switches=true;break;case 4:this.switches=false;break;case 5:this.switches=true;this.startEnabled=false;break}
  }else if((a>>8)===0xa0)this.stars[a&7]=v&1;
 }
 input(id,down){
  if(id===2&&down)this.credits=Math.min(99,this.credits+1);
  if(id===3&&down)this.startPending=true;
  const mask=({0:48,6:8,7:2})[id];if(mask)this.controls=down?this.controls&~mask:this.controls|mask;
 }
 frame(){
  const samples=new Float32Array(800);
  for(let n=0;n<800;n++){for(const cpu of this.cpus)cpu.execute(48000);
   if(this.command!==16&&this.command&&(n%3===0))this.cpus[0].non_maskable_interrupt();
   if(this.irq[2]&&n%400===0)this.cpus[2].non_maskable_interrupt();
   this.sound.execute(48000);this.sound.update();samples[n]=this.sound.output;
  }
  for(let i=0;i<2;i++)if(this.irq[i])this.cpus[i].interrupt();
  this.scroll=(this.scroll+[2,3,4,0,-4,-3,-2,0][this.stars[0]+2*this.stars[1]+4*this.stars[2]]+131072)%131072;return samples;
 }
 drawTile(code,color,sx,sy,sprite,fx=false,fy=false){
  const n=sprite?16:8,rom=sprite?this.obj:this.char,lut=sprite?this.objLut:this.charLut;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
   let x=fx?n-1-i:i,y=fy?n-1-j:j;
   const off=sprite?(code&127)*64+(y>>3)*32+(y&7)+(x>>2)*8:code*16+y+(x<4?8:0);
   const byte=rom[off],bit=3-(x&3),pen=((byte>>(bit+4))&1)*2+((byte>>bit)&1);
   const ink=lut[(color&63)*4+pen]&15,dx=sx+i,dy=sy+j;
   if(ink===15||dx<0||dy<0||dx>=288||dy>=224)continue;
   this.pixels[dx*224+(223-dy)]=this.pal[ink+(sprite?0:16)];
  }
 }
 render(){
  this.pixels.fill(0xff000000);
  if(this.stars[5])for(const [x,y,c] of this.starPoints){const dx=((x+this.scroll)&511)>>1,dy=(y+((x+this.scroll)>>9))&255;if(dy<224)this.pixels[(dx+16)*224+223-dy]=0xff000000|((c&3)*80)|(((c>>2)&3)*80<<8)|(((c>>4)&3)*80<<16)}
  const r=this.ram;
  for(let k=0;k<128;k+=2){let a=r[0x1b80+k],b=r[0x1b81+k];if(b&2)continue;const wide=(a&4)?2:1,high=(a&8)?2:1;
   let code=r[0xb80+k]&~((wide-1)|((high-1)<<1));const x=r[0x1381+k]-40+256*(b&1),y=224-r[0x1380+k]-16*(high-1);
   for(let j=0;j<high;j++)for(let i=0;i<wide;i++)this.drawTile(code+((a&1)?wide-1-i:i)+2*((a&2)?high-1-j:j),r[0xb81+k],x+16*i,y+16*j,true,a&1,a&2);
  }
  for(let k=0;k<1024;k++){const col=k&31,row=k>>5;const x=row<2?row+34:row>=30?row-30:col+2;const y=row<2||row>=30?col-2:row-2;this.drawTile(r[k],r[1024+k],8*x,8*y,false)}
  return this.pixels;
 }
}
