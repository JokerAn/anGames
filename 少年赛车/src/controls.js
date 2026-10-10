export class Controls {
  constructor(){
    this.keys=new Set();this.pointers=new Map();this.enabled=false;this.autoThrottle=true;this.itemPress=0;
    this.bindings={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'throttle',KeyW:'throttle',ArrowDown:'brake',KeyS:'brake',Space:'drift',ShiftLeft:'nitro',ShiftRight:'nitro',KeyE:'item'};
    window.addEventListener('keydown',e=>{if(!this.enabled||!this.bindings[e.code])return;e.preventDefault();if(this.bindings[e.code]==='item'&&!this.keys.has(e.code))this.itemPress++;this.keys.add(e.code);});
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>this.reset());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.reset();});
    document.querySelectorAll('[data-control]').forEach(button=>{
      button.addEventListener('pointerdown',e=>{if(!this.enabled)return;e.preventDefault();button.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,button.dataset.control);if(button.dataset.control==='item')this.itemPress++;button.classList.add('pressed');});
      const release=e=>{this.pointers.delete(e.pointerId);if(![...this.pointers.values()].includes(button.dataset.control))button.classList.remove('pressed');};
      button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);button.addEventListener('contextmenu',e=>e.preventDefault());
    });
  }
  reset(){this.keys.clear();this.pointers.clear();document.querySelectorAll('.control.pressed').forEach(b=>b.classList.remove('pressed'));}
  // itemPress is cumulative so a quick tap survives both animation and network sampling.
  // 赛道横向坐标的正方向在跟车视角中向左；触控和键盘统一转换。
  read(){if(!this.enabled||document.hidden)return {steer:0,throttle:false,brake:true,itemPress:this.itemPress};const actions=new Set([...this.pointers.values(),...[...this.keys].map(k=>this.bindings[k])]);return {steer:Number(actions.has('left'))-Number(actions.has('right')),throttle:this.autoThrottle||actions.has('throttle'),brake:actions.has('brake'),drift:actions.has('drift'),nitro:actions.has('nitro'),item:actions.has('item'),itemPress:this.itemPress};}
}
