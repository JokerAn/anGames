export class Controls {
  constructor(){
    this.keys=new Set();this.pointers=new Map();this.enabled=false;this.autoThrottle=false;this.itemPress=0;this.stickAxis=0;this.stickId=null;
    this.bindings={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'throttle',KeyW:'throttle',ArrowDown:'brake',KeyS:'brake',Space:'drift',ShiftLeft:'nitro',ShiftRight:'nitro',KeyE:'item'};
    window.addEventListener('keydown',e=>{if(!this.enabled||!this.bindings[e.code])return;e.preventDefault();if(this.bindings[e.code]==='item'&&!this.keys.has(e.code))this.itemPress++;this.keys.add(e.code);});
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>this.reset());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.reset();});
    document.querySelectorAll('[data-control]').forEach(button=>{
      button.addEventListener('pointerdown',e=>{if(!this.enabled)return;e.preventDefault();button.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,button.dataset.control);if(button.dataset.control==='item')this.itemPress++;button.classList.add('pressed');});
      const release=e=>{this.pointers.delete(e.pointerId);if(![...this.pointers.values()].includes(button.dataset.control))button.classList.remove('pressed');};
      button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);button.addEventListener('contextmenu',e=>e.preventDefault());
    });
    // Analog steering stick replaces the old left/right buttons. It reports a
    // continuous steer value in [-1, 1] and clears the moment the finger lifts.
    this.stick=document.getElementById?.('joy-steer');this.knob=document.getElementById?.('joy-steer-knob');
    if(this.stick){
      this.stick.addEventListener('pointerdown',e=>{if(!this.enabled||this.stickId!==null)return;e.preventDefault();this.stick.setPointerCapture(e.pointerId);this.stickId=e.pointerId;this.stick.classList.add('active');this.updateStick(e);});
      this.stick.addEventListener('pointermove',e=>{if(e.pointerId===this.stickId)this.updateStick(e);});
      const release=e=>{if(e.pointerId!==this.stickId&&e.type!=='lostpointercapture')return;this.stickId=null;this.stickAxis=0;this.stick.classList.remove('active');this.knob.style.transform='';};
      for(const type of ['pointerup','pointercancel','lostpointercapture'])this.stick.addEventListener(type,release);
      this.stick.addEventListener('contextmenu',e=>e.preventDefault());
    }
  }
  updateStick(e){
    const rect=this.stick.getBoundingClientRect(),radius=rect.width*.42;
    const dx=e.clientX-(rect.left+rect.width/2);
    const clamped=Math.max(-radius,Math.min(radius,dx));
    this.knob.style.transform=`translate(${clamped}px,0)`;
    // Dead-zone keeps a resting thumb from steering; beyond it, scale to full lock.
    const raw=dx/radius;
    this.stickAxis=Math.abs(raw)<.14?0:Math.max(-1,Math.min(1,(raw-(raw<0?-.14:.14))/(1-.14)));
  }
  reset(){this.keys.clear();this.pointers.clear();this.stickId=null;this.stickAxis=0;if(this.knob)this.knob.style.transform='';this.stick?.classList.remove('active');document.querySelectorAll('.control.pressed').forEach(b=>b.classList.remove('pressed'));}
  // itemPress is cumulative so a quick tap survives both animation and network sampling.
  // 赛道横向坐标的正方向在跟车视角中向左；触控和键盘统一转换。
  read(){if(!this.enabled||document.hidden)return {steer:0,throttle:false,brake:true,itemPress:this.itemPress};const actions=new Set([...this.pointers.values(),...[...this.keys].map(k=>this.bindings[k])]);const keySteer=Number(actions.has('left'))-Number(actions.has('right'));return {steer:keySteer||-this.stickAxis||0,throttle:!actions.has('brake')&&(this.autoThrottle||actions.has('throttle')),brake:actions.has('brake'),drift:actions.has('drift'),nitro:actions.has('nitro'),item:actions.has('item'),itemPress:this.itemPress};}
}
