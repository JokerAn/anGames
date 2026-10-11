// Hardware hints select the first frame; sustained render timing makes the decision.
// Missing Safari memory/core hints deliberately do not imply a low-end phone.
export const QUALITY_LEVELS = [
  {name:'流畅',pixelRatio:.72,maxPixels:650000,shadows:false,shadowSize:512,particles:18,detail:false,fps:30},
  {name:'均衡',pixelRatio:1,maxPixels:1250000,shadows:false,shadowSize:512,particles:36,detail:false,fps:60},
  {name:'高清',pixelRatio:1.5,maxPixels:2400000,shadows:true,shadowSize:1024,particles:64,detail:true,fps:60},
  {name:'精细',pixelRatio:2,maxPixels:3600000,shadows:true,shadowSize:2048,particles:96,detail:true,fps:60},
];
export function deviceBudget(nav={}) {
  const cores=Number(nav.hardwareConcurrency)||0,memory=Number(nav.deviceMemory)||0;
  if((cores>0&&cores<=2)||(memory>0&&memory<=2))return {level:0,ceiling:1};
  if(cores>0&&cores<=4&&memory>0&&memory<=4)return {level:1,ceiling:2};
  return {level:cores>=8&&memory>=8?2:1,ceiling:3};
}
export function renderRatio(level,width,height,dpr=1) {
  const p=QUALITY_LEVELS[level];
  return Math.min(dpr||1,p.pixelRatio,Math.sqrt(p.maxPixels/Math.max(1,width*height)));
}
export class AdaptiveQuality {
  constructor(nav={}) {
    const budget=deviceBudget(nav);this.level=budget.level;this.ceiling=budget.ceiling;
    this.reset();this.fps=0;this.frameMs=0;
  }
  get profile(){return QUALITY_LEVELS[this.level];}
  reset(){this.elapsed=0;this.frames=0;this.cost=0;this.slow=0;this.fast=0;this.warmup=3;}
  observe(seconds,drawMs) {
    // Tab restoration and first shader compilations are not device measurements.
    if(!Number.isFinite(seconds)||seconds<=0||seconds>.25)return false;
    if(this.warmup>0){this.warmup-=seconds;return false;}
    this.elapsed+=seconds;this.frames++;this.cost+=drawMs;
    if(this.elapsed<2)return false;
    this.frameMs=this.elapsed/this.frames*1000;this.fps=1000/this.frameMs;
    const cost=this.cost/this.frames,budget=1000/this.profile.fps;
    const slow=this.frameMs>budget*1.32||cost>budget*.88;
    const fast=this.frameMs<budget*1.09&&cost<10;
    this.slow=slow?this.slow+this.elapsed:0;this.fast=fast?this.fast+this.elapsed:0;
    this.elapsed=0;this.frames=0;this.cost=0;
    const next=this.slow>=4?Math.max(0,this.level-1):this.fast>=12?Math.min(this.ceiling,this.level+1):this.level;
    if(next===this.level)return false;
    this.level=next;this.reset();return true;
  }
}
