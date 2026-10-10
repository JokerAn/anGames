import { clamp } from './simulation.js';
export class Controls {
  constructor({onPause,onSwitch,onJump}){
    this.onPause=onPause;this.onSwitch=onSwitch;this.onJump=onJump;this.active=false;this.touch=matchMedia('(pointer:coarse)').matches;this.sensitivity=.7;this.keys=new Set();this.yaw=0;this.pitch=-.12;this.freeLook=false;this.orbitYaw=0;this.orbitPitch=-.12;this.eyeId=null;this.aim=false;this.fire=false;this.jump=false;this.moveX=0;this.moveZ=0;this.stickId=null;this.lookId=null;this.fireId=null;
    this.zone=document.querySelector('#look-zone');this.stick=document.querySelector('#joystick');this.knob=document.querySelector('#joystick-knob');this.fireButton=document.querySelector('#fire-button');this.aimButton=document.querySelector('#aim-button');this.jumpButton=document.querySelector('#jump-button');this.eyeButton=document.querySelector('#freelook-button');
    this.bind();this.setTouchMode('auto');
  }
  setTouchMode(mode){this.touch=mode==='on'||mode==='auto'&&(matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0);document.body.classList.toggle('touch',this.touch);}
  get viewAspect(){return clamp(innerWidth/Math.max(1,innerHeight),.4,3);}
  get viewYaw(){return this.freeLook?this.orbitYaw:this.yaw;}
  get viewPitch(){return this.freeLook?this.orbitPitch:this.pitch;}
  setFreeLook(active){
    if(active===this.freeLook)return;
    if(active){this.orbitYaw=this.yaw;this.orbitPitch=this.pitch;}this.freeLook=active;
    this.eyeButton.classList.toggle('active',active);document.body.classList.toggle('free-looking',active);
  }
  look(dx,dy){
    const factor=this.aim&&!this.freeLook?.5:1;
    if(this.freeLook){this.orbitYaw-=dx*.006*this.sensitivity;this.orbitPitch=clamp(this.orbitPitch-dy*.0035*this.sensitivity,-.95,1);}
    else{this.yaw-=dx*.004*this.sensitivity*factor;this.pitch=clamp(this.pitch-dy*.0035*this.sensitivity*factor,-1,1.05);}
  }
  reset(){this.setFreeLook(false);this.eyeId=null;this.keys.clear();this.fire=false;this.jump=false;this.moveX=0;this.moveZ=0;this.stickId=this.lookId=this.fireId=null;this.knob.style.transform='';this.fireButton.classList.remove('active');}
  setActive(active){this.active=active;this.reset();if(!active){this.aim=false;this.aimButton.classList.remove('active');document.body.classList.remove('aiming');if(document.pointerLockElement)document.exitPointerLock();}}
  toggleAim(){this.aim=!this.aim;this.aimButton.classList.toggle('active',this.aim);document.body.classList.toggle('aiming',this.aim);}
  lock(){if(!this.touch&&this.active&&this.zone.requestPointerLock){const p=this.zone.requestPointerLock();p?.catch?.(()=>{});}}
  bind(){
    const capture=(el,e)=>{e.preventDefault();el.setPointerCapture(e.pointerId);};
    this.stick.addEventListener('pointerdown',e=>{if(!this.active||this.stickId!==null)return;capture(this.stick,e);this.stickId=e.pointerId;this.updateStick(e);});
    this.stick.addEventListener('pointermove',e=>{if(e.pointerId===this.stickId)this.updateStick(e);});
    const releaseStick=e=>{if(e.pointerId!==this.stickId)return;this.stickId=null;this.moveX=0;this.moveZ=0;this.knob.style.transform='';};
    for(const event of ['pointerup','pointercancel','lostpointercapture'])this.stick.addEventListener(event,releaseStick);
    this.zone.addEventListener('pointerdown',e=>{
      if(!this.active)return;if(e.pointerType==='mouse'&&!this.touch){this.lock();if(e.button===0)this.fire=true;if(e.button===2)this.toggleAim();return;}
      if(this.lookId!==null)return;capture(this.zone,e);this.lookId=e.pointerId;this.lookLast={x:e.clientX,y:e.clientY};
    });
    this.zone.addEventListener('pointermove',e=>{if(!this.active||e.pointerId!==this.lookId)return;this.look(e.clientX-this.lookLast.x,e.clientY-this.lookLast.y);this.lookLast={x:e.clientX,y:e.clientY};});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])this.zone.addEventListener(event,e=>{if(e.pointerId===this.lookId)this.lookId=null;});
    this.fireButton.addEventListener('pointerdown',e=>{if(!this.active||this.fireId!==null)return;capture(this.fireButton,e);this.fireId=e.pointerId;this.fire=true;this.fireLast={x:e.clientX,y:e.clientY};this.fireButton.classList.add('active');});
    this.fireButton.addEventListener('pointermove',e=>{if(e.pointerId===this.fireId){this.look(e.clientX-this.fireLast.x,e.clientY-this.fireLast.y);this.fireLast={x:e.clientX,y:e.clientY};}});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])this.fireButton.addEventListener(event,e=>{if(e.pointerId===this.fireId){this.fire=false;this.fireId=null;this.fireButton.classList.remove('active');}});
    this.eyeButton.addEventListener('pointerdown',e=>{if(!this.active||this.eyeId!==null)return;capture(this.eyeButton,e);this.eyeId=e.pointerId;this.eyeLast={x:e.clientX,y:e.clientY};this.setFreeLook(true);});
    this.eyeButton.addEventListener('pointermove',e=>{if(e.pointerId!==this.eyeId)return;this.look(e.clientX-this.eyeLast.x,e.clientY-this.eyeLast.y);this.eyeLast={x:e.clientX,y:e.clientY};});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])this.eyeButton.addEventListener(event,e=>{if(e.pointerId===this.eyeId){this.eyeId=null;this.setFreeLook(false);}});
    this.aimButton.addEventListener('pointerdown',e=>{e.preventDefault();if(this.active)this.toggleAim();});
    this.jumpButton.addEventListener('pointerdown',e=>{if(!this.active)return;capture(this.jumpButton,e);this.jump=true;this.onJump();});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])this.jumpButton.addEventListener(event,()=>this.jump=false);
    document.addEventListener('mousemove',e=>{if(this.active&&document.pointerLockElement===this.zone)this.look(e.movementX,e.movementY);});
    document.addEventListener('mousedown',e=>{if(!this.active||document.pointerLockElement!==this.zone||e.target!==this.zone)return;if(e.button===0)this.fire=true;});
    document.addEventListener('mouseup',e=>{if(e.button===0&&e.pointerType!=='touch')this.fire=false;});
    this.zone.addEventListener('contextmenu',e=>e.preventDefault());
    document.addEventListener('pointerlockchange',()=>{if(this.active&&!this.touch&&!document.pointerLockElement)this.onPause();});
    document.addEventListener('keydown',e=>{if(!this.active)return;if(['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.code))e.preventDefault();this.keys.add(e.code);if(e.code==='AltLeft'||e.code==='AltRight'){e.preventDefault();this.setFreeLook(true);}if(e.repeat)return;if(e.code==='Escape'){e.preventDefault();e.stopPropagation();this.onPause();}if(e.code==='KeyQ')this.onSwitch();if(/^Digit[1-4]$/.test(e.code))this.onSwitch(Number(e.code.slice(-1))-1);if(e.code==='Space')this.onJump();});
    document.addEventListener('keyup',e=>{this.keys.delete(e.code);if(e.code==='AltLeft'||e.code==='AltRight'){e.preventDefault();this.setFreeLook(false);}});
    window.addEventListener('blur',()=>{this.reset();if(this.active)this.onPause();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.reset();if(this.active)this.onPause();}});
  }
  updateStick(e){const rect=this.stick.getBoundingClientRect(),radius=rect.width*.35;let x=e.clientX-(rect.left+rect.width/2),y=e.clientY-(rect.top+rect.height/2),len=Math.hypot(x,y);if(len>radius){x=x/len*radius;y=y/len*radius;}this.moveX=x/radius;this.moveZ=y/radius;this.knob.style.transform=`translate(${x}px,${y}px)`;}
  input(weapon){if(!this.active)return {yaw:this.yaw,pitch:this.pitch,weapon,viewAspect:this.viewAspect};const down=k=>this.keys.has(k)?1:0;return {moveX:clamp(this.moveX+down('KeyD')-down('KeyA')+down('ArrowRight')-down('ArrowLeft'),-1,1),moveZ:clamp(this.moveZ+down('KeyS')-down('KeyW')+down('ArrowDown')-down('ArrowUp'),-1,1),yaw:this.yaw,pitch:this.pitch,fire:this.fire,jump:this.jump||this.keys.has('Space'),aim:this.aim,sprint:this.keys.has('ShiftLeft'),weapon,viewAspect:this.viewAspect};}
}
