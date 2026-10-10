import { WEAPONS, clamp } from './simulation.js';
export class GameAudio {
  constructor(){this.volume=.65;this.muted=false;this.music=true;this.playing=false;this.beat=0;this.lastStep=0;this.timer=null;}
  async unlock(){
    try{
      if(!this.ctx){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;this.ctx=new Audio();this.master=this.ctx.createGain();const compressor=this.ctx.createDynamicsCompressor();compressor.threshold.value=-18;compressor.ratio.value=5;this.master.connect(compressor);compressor.connect(this.ctx.destination);this.master.gain.value=this.muted?0:this.volume*.48;
        this.noise=this.ctx.createBuffer(1,this.ctx.sampleRate*.35,this.ctx.sampleRate);const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
        this.timer=setInterval(()=>this.musicTick(),260);
      }
      if(this.ctx.state==='suspended')await this.ctx.resume();
    }catch{/* Audio availability must never prevent play. */}
  }
  setVolume(v){this.volume=clamp(v,0,1);if(this.ctx)this.master.gain.setTargetAtTime(this.muted?0:this.volume*.48,this.ctx.currentTime,.05);}
  toggle(){this.muted=!this.muted;this.setVolume(this.volume);return this.muted;}
  tone(freq,duration=.12,{type='sine',gain=.15,end=freq,delay=0,pan=0}={}){
    if(!this.ctx||this.muted||this.ctx.state!=='running')return;
    const t=this.ctx.currentTime+delay,osc=this.ctx.createOscillator(),amp=this.ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,t);osc.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+duration);amp.gain.setValueAtTime(0,t);amp.gain.linearRampToValueAtTime(gain,t+.008);amp.gain.exponentialRampToValueAtTime(.001,t+duration);osc.connect(amp);
    if(this.ctx.createStereoPanner){const p=this.ctx.createStereoPanner();p.pan.value=clamp(pan,-1,1);amp.connect(p);p.connect(this.master);}else amp.connect(this.master);
    osc.start(t);osc.stop(t+duration+.02);osc.onended=()=>{osc.disconnect();amp.disconnect();};
  }
  puff(freq,gain=.07,duration=.1){
    if(!this.ctx||this.muted||this.ctx.state!=='running')return;
    const t=this.ctx.currentTime,source=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),amp=this.ctx.createGain();source.buffer=this.noise;filter.type='bandpass';filter.frequency.value=freq;filter.Q.value=.8;amp.gain.setValueAtTime(gain,t);amp.gain.exponentialRampToValueAtTime(.001,t+duration);source.connect(filter);filter.connect(amp);amp.connect(this.master);source.start(t);source.stop(t+duration);source.onended=()=>{source.disconnect();filter.disconnect();amp.disconnect();};
  }
  shot(weapon,volume=1,pan=0){const w=WEAPONS[weapon];if(!w)return;this.tone(w.sound,.12,{gain:.24*volume,end:w.sound*.35,type:'triangle',pan});this.tone(w.sound*2,.065,{gain:.08*volume,end:w.sound*.8,pan});this.puff(weapon==='shotgun'?450:1300,.14*volume,weapon==='shotgun'?.2:.07);}
  hit(){this.tone(950,.075,{gain:.13,end:1400});this.tone(1500,.1,{gain:.08,delay:.03,end:1800});}
  pop(){[660,880,1320].forEach((f,i)=>this.tone(f,.2,{gain:.18,delay:i*.055,type:'triangle'}));this.puff(2200,.13,.15);}
  hurt(){this.tone(220,.15,{gain:.15,end:150});}
  click(){this.tone(750,.06,{gain:.1,end:1000});}
  jump(){this.tone(300,.17,{gain:.09,end:650});}
  respawn(){[392,494,587,784].forEach((f,i)=>this.tone(f,.2,{gain:.12,delay:i*.07}));}
  victory(){[523,659,784,1046,784,1046].forEach((f,i)=>this.tone(f,.3,{gain:.23,delay:i*.15,type:'triangle'}));}
  step(time){if(time-this.lastStep<.36)return;this.lastStep=time;this.puff(180,.07,.05);this.tone(95,.05,{gain:.05,end:60});}
  musicTick(){if(!this.music||!this.ctx||this.muted||document.hidden||this.ctx.state!=='running')return;const notes=[262,0,330,392,0,330,294,0,220,0,262,330,0,294,262,0];const f=notes[this.beat++%notes.length];if(f)this.tone(f,.42,{gain:this.playing?.018:.045,type:'sine'});if(this.beat%4===0)this.tone(this.beat%16<8?131:110,.6,{gain:.035});}
}
