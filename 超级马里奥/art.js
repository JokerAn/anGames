const TAU=Math.PI*2;
export function rounded(ctx,x,y,w,h,r,fill,stroke) {ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function ellipse(c,x,y,rx,ry,color,rotation=0){c.beginPath();c.ellipse(x,y,rx,ry,rotation,0,TAU);c.fillStyle=color;c.fill();}
function path(c,points,fill,stroke){c.beginPath();points(c);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}}
export function star(c,x,y,r,color,rotation=0){c.beginPath();for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2+rotation,rr=i%2?r*.46:r;c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}c.closePath();c.fillStyle=color;c.fill();}
// Pre-render articulated character frames at 2x; runtime drawing is a single blit.
export function createFoxFrames(){
  const frames=[];
  for(let frame=0;frame<12;frame++){
    const canvas=document.createElement('canvas');canvas.width=208;canvas.height=208;
    const c=canvas.getContext('2d');c.scale(2,2);c.translate(52,82);
    const run=frame<8,phase=frame/8*TAU,step=run?Math.sin(phase)*8:0,bob=run?Math.abs(Math.sin(phase))*2:frame===9?2:0;
    c.translate(0,-bob);
    // Bushy tail: layered ochre silhouette, cream tip and a fine highlight.
    path(c,p=>{p.moveTo(-12,-13);p.bezierCurveTo(-33,-8,-46,-22,-41,-42);p.bezierCurveTo(-29,-31,-18,-42,-10,-21);p.closePath();},'#be7040');
    path(c,p=>{p.moveTo(-41,-42);p.bezierCurveTo(-33,-32,-31,-35,-27,-32);p.lineTo(-31,-22);p.lineTo(-38,-25);p.bezierCurveTo(-42,-31,-42,-37,-41,-42);},'#f8e3b6');
    path(c,p=>{p.moveTo(-29,-26);p.quadraticCurveTo(-21,-28,-16,-18);},null,'#df9557');
    // Boots and gait.
    rounded(c,-14+step*.6,-6,12,17,5,'#405a4b');rounded(c,1-step*.65,-6,12,17,5,'#334e42');
    rounded(c,-15+step*.6,5,17,8,4,'#6e503c');rounded(c,1-step*.65,5,17,8,4,'#76543d');
    rounded(c,-15+step*.6,10,17,3,1,'#b9a07a');rounded(c,1-step*.65,10,17,3,1,'#b9a07a');
    // Explorer jacket and leather satchel.
    rounded(c,-15,-32,31,32,10,'#608572');
    path(c,p=>{p.moveTo(-7,-28);p.lineTo(-3,-2);p.lineTo(7,-2);p.lineTo(11,-29);},'#789883');
    rounded(c,-18,-26,9,22,4,'#486b57');rounded(c,-19,-23,10,13,3,'#b18452');rounded(c,-18,-25,10,5,2,'#d3a26a');
    c.strokeStyle='#d3ae78';c.lineWidth=3;c.beginPath();c.moveTo(10,-29);c.lineTo(-9,-2);c.stroke();
    ellipse(c,3,-10,1.3,1.3,'#f0d39e');
    c.save();c.translate(11,-24);c.rotate(run?Math.sin(phase)*.3:-.2);rounded(c,0,0,9,19,4,'#71917a');ellipse(c,5,18,5,5,'#e9a562');c.restore();
    // Ears and face, outlined softly rather than pixelated.
    path(c,p=>{p.moveTo(-23,-46);p.lineTo(-23,-70);p.quadraticCurveTo(-14,-70,-7,-56);p.lineTo(8,-58);p.quadraticCurveTo(15,-73,22,-69);p.lineTo(26,-43);p.lineTo(10,-28);p.lineTo(-9,-29);p.closePath();},'#dd9453');
    path(c,p=>{p.moveTo(-20,-65);p.lineTo(-17,-49);p.lineTo(-9,-54);p.closePath();},'#775d49');
    path(c,p=>{p.moveTo(19,-65);p.lineTo(10,-54);p.lineTo(22,-48);p.closePath();},'#805944');
    path(c,p=>{p.moveTo(-22,-45);p.quadraticCurveTo(-11,-49,1,-39);p.quadraticCurveTo(13,-48,26,-44);p.lineTo(22,-33);p.quadraticCurveTo(11,-22,-2,-27);p.lineTo(-15,-31);p.closePath();},'#fae9c6');
    path(c,p=>{p.moveTo(-23,-45);p.lineTo(-28,-41);p.lineTo(-22,-38);p.lineTo(-25,-34);p.lineTo(-16,-32);},'#fae9c6');
    ellipse(c,-7,-45,2.3,3.2,'#304b41');ellipse(c,15,-45,2.5,3.4,'#304b41');
    ellipse(c,-6.4,-46.1,.8,1,'#fff9e6');ellipse(c,15.7,-46.2,.8,1,'#fff9e6');
    ellipse(c,5,-35,4,2.8,'#374f43');
    c.strokeStyle='#8e6549';c.lineWidth=1;c.beginPath();c.moveTo(5,-33);c.quadraticCurveTo(5,-29,10,-31);c.stroke();
    ellipse(c,-12,-37,3.8,2,'#e6b48b');ellipse(c,19,-37,3,1.8,'#e6b48b');
    // Red scarf with a fluttering end.
    path(c,p=>{p.moveTo(-12,-29);p.quadraticCurveTo(3,-24,15,-30);p.lineTo(12,-22);p.quadraticCurveTo(1,-18,-12,-23);p.closePath();},'#c66948');
    path(c,p=>{p.moveTo(-10,-25);p.lineTo(-28,-22+Math.sin(phase)*3);p.lineTo(-22,-16+Math.sin(phase)*3);p.lineTo(-6,-20);},'#dc8054');
    // Alpine cap, braided band, feather.
    path(c,p=>{p.moveTo(-21,-57);p.quadraticCurveTo(-22,-70,-10,-75);p.quadraticCurveTo(-2,-79,9,-69);p.lineTo(17,-56);p.closePath();},'#496d58');
    path(c,p=>{p.moveTo(-18,-63);p.quadraticCurveTo(-3,-70,13,-60);p.lineTo(15,-56);p.lineTo(-20,-55);},'#6c8c67');
    ellipse(c,-1,-56,27,5,'#3e604e',-.08);
    path(c,p=>{p.moveTo(-13,-63);p.quadraticCurveTo(-31,-75,-24,-86);p.quadraticCurveTo(-12,-82,-13,-63);},'#f0ca86');
    c.strokeStyle='#b58b53';c.lineWidth=1;c.beginPath();c.moveTo(-14,-64);c.lineTo(-24,-82);c.stroke();
    frames.push(canvas);
  }
  return frames;
}
export class Artwork {
  constructor(){this.fox=createFoxFrames();this.cache=new Map();}
  sprite(key,w,h,draw){if(!this.cache.has(key)){const cv=document.createElement('canvas');cv.width=w*2;cv.height=h*2;const c=cv.getContext('2d');c.scale(2,2);draw(c);this.cache.set(key,cv);}return this.cache.get(key);}
  drawFox(c,x,y,{frame=8,facing=1,scale=1,crouch=false,alpha=1}={}){c.save();c.translate(x,y);c.scale(facing*scale,scale*(crouch?.7:1));c.globalAlpha=alpha;c.drawImage(this.fox[frame%12],-52,-95,104,104);c.restore();}
  tree(c,x,y,s,t,variant=0){const key=`tree${t.name}${variant}`;const img=this.sprite(key,250,330,p=>{
    p.lineCap='round';p.lineWidth=18;p.strokeStyle='#7c8161';p.beginPath();p.moveTo(120,329);p.bezierCurveTo(116,266,132,209,115,143);p.stroke();
    p.lineWidth=7;p.beginPath();p.moveTo(122,260);p.lineTo(76,208);p.moveTo(123,226);p.lineTo(171,179);p.stroke();
    ellipse(p,128,162,78,97,t.leafDark);ellipse(p,72,172,59,66,t.leaf);ellipse(p,169,146,62,70,t.leaf);ellipse(p,112,99,70,64,t.leaf);ellipse(p,112,67,48,45,t.leaf);ellipse(p,78,132,42,48,t.grass);ellipse(p,146,108,35,45,t.grass);ellipse(p,103,55,29,25,t.grass);
    p.globalAlpha=.22;for(let i=0;i<24;i++){const xx=52+(Math.sin(i*12.989)*.5+.5)*137,yy=65+(Math.sin(i*4.32)*.5+.5)*130;ellipse(p,xx,yy,3,6,t.grassLight,-.6);}p.globalAlpha=1;
  });c.drawImage(img,x-125*s,y-330*s,250*s,330*s);}
  bush(c,x,y,s,t){const im=this.sprite(`bush${t.name}`,140,65,p=>{ellipse(p,70,51,65,16,t.leafDark);ellipse(p,33,40,28,25,t.leaf);ellipse(p,70,27,33,27,t.leaf);ellipse(p,105,41,31,25,t.leaf);ellipse(p,58,21,24,17,t.grass);for(let i=0;i<7;i++)ellipse(p,24+i*15,36+Math.sin(i*2)*11,2.5,4,t.grassLight,-.3);});c.drawImage(im,x-70*s,y-65*s,140*s,65*s);}
  ground(c,g,t){
    const img=this.sprite(`ground${t.name}`,128,256,p=>{
      p.fillStyle=t.soil;p.fillRect(0,0,128,256);
      p.fillStyle=t.soilDark;p.globalAlpha=.26;for(let i=0;i<36;i++){const x=(i*67)%128,y=28+(i*41)%225;rounded(p,x,y,3+i%4,2,1,t.soilDark);}p.globalAlpha=1;
      p.fillStyle=t.grass;p.fillRect(0,0,128,15);p.fillStyle=t.grassLight;p.fillRect(0,0,128,4);
      path(p,q=>{q.moveTo(0,12);for(let x=0;x<=128;x+=8)q.lineTo(x,14+(Math.sin(x*1.2)*.5+.5)*10);q.lineTo(128,0);q.lineTo(0,0);},t.grass);
      p.strokeStyle=t.grassLight;p.lineWidth=1.5;for(let i=0;i<13;i++){const x=i*11;p.beginPath();p.moveTo(x,5);p.lineTo(x-2,-1);p.stroke();}
    });
    c.save();c.beginPath();c.rect(g.x,g.y,g.w,g.h);c.clip();
    const start=Math.max(g.x,Math.floor((this.cameraX||0)/128)*128);
    c.fillStyle=t.soil;c.fillRect(g.x,g.y,g.w,g.h);
    for(let x=start;x<Math.min(g.x+g.w,(this.cameraX||0)+this.viewWidth+128);x+=128)c.drawImage(img,0,0,256,512,x,g.y,128,256);
    c.fillStyle=t.soilDark;c.globalAlpha=.3;c.fillRect(g.x,g.y+18,4,g.h);c.fillRect(g.x+g.w-5,g.y+18,5,g.h);c.restore();
  }
  block(c,b,t){const y=b.y-Math.sin(b.bump*Math.PI)*9;const key=`block${b.kind}${b.used}${t.name}`;
    const img=this.sprite(key,46,46,p=>{
      if(b.kind==='question'&&!b.used){rounded(p,1,1,42,42,7,'#d6a05c','#af7b43');rounded(p,4,3,36,35,5,'#e9bc76');p.strokeStyle='#f7dba2';p.lineWidth=1.5;p.strokeRect(7,6,30,29);p.fillStyle='#fff0c8';p.font='bold 28px Georgia';p.textAlign='center';p.fillText('?',23,31);for(const [x,y]of [[7,7],[37,7],[7,36],[37,36]])ellipse(p,x,y,1.3,1.3,'#ad8045');}
      else{rounded(p,1,1,42,42,4,b.used?'#a99572':'#b6916c');p.strokeStyle=b.used?'#928363':'#e0bd8a';p.lineWidth=2;p.beginPath();p.moveTo(2,21);p.lineTo(43,21);p.moveTo(23,2);p.lineTo(23,20);p.moveTo(12,22);p.lineTo(12,42);p.moveTo(35,22);p.lineTo(35,42);p.stroke();p.fillStyle='#fff0c322';p.fillRect(3,3,38,4);}
    });c.drawImage(img,b.x,y,46,46);}
  coin(c,x,y,time,phase=0){const scale=.75+Math.sin(time*3+phase)*.25;c.save();c.translate(x,y+Math.sin(time*2+phase)*3);c.scale(scale,1);ellipse(c,0,0,11,14,'#bf903e');ellipse(c,0,-1,9,12,'#f0c367');ellipse(c,0,-2,6.2,9,'#f8d887');c.fillStyle='#c19545';c.fillRect(-1.2,-8,2.4,13);c.restore();}
  enemy(c,e,time){const im=this.sprite('enemy',64,52,p=>{ellipse(p,17,43,12,5,'#625443');ellipse(p,46,43,12,5,'#625443');rounded(p,17,22,30,22,10,'#f0dfb8');path(p,q=>{q.moveTo(4,28);q.bezierCurveTo(7,-4,51,-5,60,28);q.quadraticCurveTo(31,38,4,28);},'#b77156');ellipse(p,20,15,6,4,'#e4ad7d',-.4);ellipse(p,43,14,5,3.5,'#e4ad7d',.4);ellipse(p,30,6,3,2,'#e4ad7d');ellipse(p,25,35,2,3,'#4b5745');ellipse(p,39,35,2,3,'#4b5745');p.strokeStyle='#635740';p.lineWidth=1.5;p.beginPath();p.moveTo(22,29);p.lineTo(27,31);p.moveTo(37,31);p.lineTo(42,29);p.stroke();});c.drawImage(im,e.x-10,e.y-10+Math.sin(time*10+e.phase)*2,58,47);}
  ammoPickup(c,x,y,time){
    const image=this.sprite('ammo-pickup',48,48,p=>{
      ellipse(p,24,26,23,22,'#fff3ce35');
      rounded(p,8,14,33,27,8,'#a87c4e','#8e7048');rounded(p,10,13,29,24,6,'#d5a96b');
      for(const xx of [17,28]){
        rounded(p,xx,8,7,20,[4,4,1,1],'#f6d789');rounded(p,xx,22,7,3,1,'#ba8949');
        p.fillStyle='#fff1bd';p.fillRect(xx+1,13,2,7);
      }
      rounded(p,9,27,31,10,4,'#c29356');star(p,24,32,4,'#fff0b8');
      p.strokeStyle='#f4d5a0';p.lineWidth=1; p.beginPath();p.moveTo(12,38);p.lineTo(36,38);p.stroke();
    });
    c.drawImage(image,x-24,y-24+Math.sin(time*2.8+x)*3,48,48);
  }
  bullet(c,b){
    const direction=Math.sign(b.vx);
    c.save();c.translate(b.x,b.y);c.scale(direction,1);
    rounded(c,-23,-2,21,4,2,'#f9dfa360');rounded(c,-9,-4,16,8,4,'#e7ad55');rounded(c,-5,-2,10,4,2,'#fff1be');c.restore();
  }
  blaster(c,x,y,direction,flash){
    c.save();c.translate(x,y);c.scale(direction,1);
    rounded(c,9,1,7,12,3,'#946743');rounded(c,8,-5,21,10,4,'#627f62');rounded(c,24,-5,7,10,2,'#d9b575');
    c.fillStyle='#edf0c0';c.fillRect(12,-3,8,2);ellipse(c,10,6,4,4,'#e9a562');
    if(flash){star(c,37,0,10,'#ffe6a5',.25);ellipse(c,35,0,4,3,'#fff8d9');}
    c.restore();
  }
  spikes(c,h){
    const image=this.sprite(`spikes${h.w}`,h.w,26,p=>{
      rounded(p,0,21,h.w,5,2,'#8b6c60');
      const count=Math.round(h.w/16),width=h.w/count;
      for(let i=0;i<count;i++){
        const x=i*width;
        path(p,q=>{q.moveTo(x+1,22);q.lineTo(x+width*.52,1);q.lineTo(x+width-1,22);q.closePath();},'#b36557');
        path(p,q=>{q.moveTo(x+width*.52,1);q.lineTo(x+width*.52,20);q.lineTo(x+width-1,22);q.closePath();},'#d79274');
      }
    });
    c.drawImage(image,h.x,h.y-2,h.w,26);
  }
  spring(c,s){const q=s.bounce>0?Math.sin(s.bounce*16)*5:0;rounded(c,s.x+17,s.y+7+q,16,25-q,5,'#ece1bc');ellipse(c,s.x+25,s.y+10+q,28,12,'#b96045');ellipse(c,s.x+24,s.y+5+q,26,13,'#db8d63');ellipse(c,s.x+12,s.y+2+q,5,3,'#ffdfa4');ellipse(c,s.x+31,s.y+3+q,5,3,'#ffdfa4');}
  gate(c,x,y,t,time){
    ellipse(c,x,y+2,65,10,'#36543c25');rounded(c,x-42,y-111,16,111,6,'#c2ba96');rounded(c,x+28,y-111,16,111,6,'#a6a781');
    c.strokeStyle='#c2ba96';c.lineWidth=17;c.beginPath();c.arc(x+1,y-105,35,Math.PI,0);c.stroke();
    const g=c.createLinearGradient(x,y-120,x,y);g.addColorStop(0,'#f9e5a95a');g.addColorStop(1,'#fff2beaa');rounded(c,x-27,y-112,56,112,[28,28,0,0],g);
    c.strokeStyle=t.leafDark;c.lineWidth=3;c.beginPath();c.moveTo(x-42,y);c.bezierCurveTo(x-20,y-55,x-67,y-63,x-31,y-124);c.stroke();for(let i=0;i<7;i++)ellipse(c,x-38+Math.sin(i*2)*8,y-15-i*15,8,4,t.leaf,-.5);
    star(c,x+1,y-83+Math.sin(time*2)*4,16,'#fff5cd');c.fillStyle='#f6e6b8';c.font='9px sans-serif';c.textAlign='center';c.fillText('下一阵风',x+2,y-151);
  }
  sign(c,x,y,text){rounded(c,x-3,y-60,7,60,2,'#8d815b');path(c,p=>{p.moveTo(x-35,y-69);p.lineTo(x+29,y-69);p.lineTo(x+43,y-55);p.lineTo(x+28,y-41);p.lineTo(x-35,y-41);p.closePath();},'#d9bd88');c.fillStyle='#7b7353';c.font='10px sans-serif';c.textAlign='center';c.fillText(text,x,y-51);}
  background(c,w,h,t,time,camera,portrait){
    const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,t.sky[0]);g.addColorStop(1,t.sky[1]);c.fillStyle=g;c.fillRect(0,0,w,h);
    // Sun with two translucent halos.
    const sunX=w*.76,sunY=portrait?230:160;
    ellipse(c,sunX,sunY,67,67,t.night?'#e9e5bd0b':'#fff5d619');ellipse(c,sunX,sunY,48,48,'#fff5d633');ellipse(c,sunX,sunY,33,33,t.night?'#eee4c7':'#fbf0c8');
    if(t.night){for(let i=0;i<38;i++){const x=(i*137.5)%w,y=65+(i*43.7)%270;c.globalAlpha=.35+Math.sin(time+i)*.2;ellipse(c,x,y,1.2,1.2,'#fff6cb');}c.globalAlpha=1;}
    // Broad hand-shaped clouds; deterministic placement and restrained parallax.
    for(let i=0;i<6;i++){let x=((i*337-camera*.06+time*3)%(w+500)+w+500)%(w+500)-160;const y=110+(i%3)*66;c.globalAlpha=.36;ellipse(c,x,y,62,12,'#fffcdf');ellipse(c,x-21,y-9,29,15,'#fffcdf');ellipse(c,x+15,y-15,33,20,'#fffcdf');c.globalAlpha=1;}
    const base=portrait?610:h<650?395:485;
    for(let layer=0;layer<3;layer++){
      const stride=layer===0?690:530,off=camera*[.12,.2,.32][layer];
      c.fillStyle=[t.mountainBack,t.mountain,t.hill][layer];
      for(let i=-2;i<w/stride+3;i++){
        const x=i*stride-((off%stride)+stride)%stride,peak=base-[230,170,100][layer];
        path(c,p=>{p.moveTo(x-80,base+80);p.bezierCurveTo(x+50,base-20,x+95,peak,x+210,peak+12);p.bezierCurveTo(x+310,peak-30,x+350,base-15,x+stride+100,base+80);p.closePath();},[t.mountainBack,t.mountain,t.hill][layer]);
      }
    }
    // Little far-away pines create scale, with a final low meadow ridge.
    c.fillStyle=t.hillFront;c.globalAlpha=.36;
    for(let i=0;i<22;i++){const x=i*101-(camera*.3%101),y=base-17+Math.sin(i*1.8)*20;path(c,p=>{p.moveTo(x-10,y);p.lineTo(x,y-37);p.lineTo(x+10,y);p.closePath();},t.hillFront);c.fillRect(x-1,y-1,2,12);}c.globalAlpha=1;
    path(c,p=>{p.moveTo(0,h);p.lineTo(0,base+55);p.bezierCurveTo(w*.28,base-5,w*.58,base+80,w,base+9);p.lineTo(w,h);p.closePath();},t.hillFront);
    for(let i=0;i<5;i++){const x=((i*173+time*9-camera*.1)%(w+100)+w+100)%(w+100),y=200+(i*51)%115;c.strokeStyle=t.leafDark;c.globalAlpha=.3;c.lineWidth=1.5;c.beginPath();c.moveTo(x-6,y+Math.sin(time*2+i)*2);c.quadraticCurveTo(x-3,y-3,x,y);c.quadraticCurveTo(x+3,y-3,x+6,y+Math.sin(time*2+i)*2);c.stroke();c.globalAlpha=1;}
  }
  flowers(c,x,y,seed,t){for(let i=0;i<4;i++){const xx=x+i*15,hh=8+(i*7+seed)%12;c.strokeStyle=t.leafDark;c.lineWidth=1.5;c.beginPath();c.moveTo(xx,y);c.quadraticCurveTo(xx+4,y-hh*.5,xx+1,y-hh);c.stroke();ellipse(c,xx+1,y-hh,3,3,i%2?'#f5ddb0':'#e5b489');ellipse(c,xx+1,y-hh,1.1,1.1,'#c29156');}}
}
