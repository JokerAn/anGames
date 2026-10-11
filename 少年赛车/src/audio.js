export class AudioEngine {
  constructor(){this.enabled=false;this.ctx=null;this.lastHit=0;this.lastBoost=false;}
  async unlock(){try{if(!this.ctx){const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return;this.ctx=new AudioContext();this.master=this.ctx.createGain();
    this.master.gain.value=this.enabled?.3:0;this.master.connect(this.ctx.destination);
    // RPM harmonics plus a quiet wind/tyre layer. No recordings or network assets.
    this.motor=this.ctx.createOscillator();this.motor.type='sawtooth';
    this.motorSub=this.ctx.createOscillator();this.motorSub.type='square';
    this.motorSubGain=this.ctx.createGain();this.motorSubGain.gain.value=.2;
    this.filter=this.ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=300;this.filter.Q.value=.8;
    this.motorGain=this.ctx.createGain();this.motorGain.gain.value=0;
    this.motor.connect(this.filter);this.motorSub.connect(this.motorSubGain);this.motorSubGain.connect(this.filter);this.filter.connect(this.motorGain);this.motorGain.connect(this.master);
    this.motor.start();this.motorSub.start();
    const buffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    this.air=this.ctx.createBufferSource();this.air.buffer=buffer;this.air.loop=true;
    this.airFilter=this.ctx.createBiquadFilter();this.airFilter.type='lowpass';this.airFilter.frequency.value=500;
    this.airGain=this.ctx.createGain();this.airGain.gain.value=0;this.air.connect(this.airFilter);this.airFilter.connect(this.airGain);this.airGain.connect(this.master);this.air.start();
    this.tyres=this.ctx.createBufferSource();this.tyres.buffer=buffer;this.tyres.loop=true;
    this.tyreFilter=this.ctx.createBiquadFilter();this.tyreFilter.type='bandpass';this.tyreFilter.frequency.value=1400;this.tyreFilter.Q.value=.8;
    this.tyreGain=this.ctx.createGain();this.tyreGain.gain.value=0;this.tyres.connect(this.tyreFilter);this.tyreFilter.connect(this.tyreGain);this.tyreGain.connect(this.master);this.tyres.start();}if(this.ctx.state==='suspended')await this.ctx.resume();}catch{}}
  async toggle(){await this.unlock();this.enabled=!this.enabled;if(this.master)this.master.gain.setTargetAtTime(this.enabled?.3:0,this.ctx.currentTime,.05);if(this.ctx&&!this.enabled)await this.ctx.suspend();return this.enabled;}
  update(racer,active){
    if(!this.ctx)return;
    const v=racer?.v||0,t=this.ctx.currentTime,rpm=racer?.rpm||900,electric=racer?.engine==='electric';
    this.motor.type=electric?'sine':'sawtooth';this.motorSub.type=electric?'sine':'triangle';
    const base=electric?90+v*8:rpm/60*(racer?.engine==='turbo'?4:3);
    this.motor.frequency.setTargetAtTime(base,t,.055);this.motorSub.frequency.setTargetAtTime(base*.5,t,.06);
    this.filter.frequency.setTargetAtTime(electric?2200:300+rpm*.16+(racer?.boosting?200:0),t,.08);
    const load=racer?.braking?.055:.09;
    this.motorGain.gain.setTargetAtTime(active?(electric?.09:load):0,t,.07);
    this.airGain.gain.setTargetAtTime(active?Math.min(.09,v*v*.000018):0,t,.12);
    this.airFilter.frequency.setTargetAtTime(300+v*12,t,.12);
    this.tyreGain.gain.setTargetAtTime(active&&v>12?(racer?.drifting?.085:Math.max(0,(racer?.gripUsage||0)-.9)*.045):0,t,.07);
  }
  tone(freq,duration,type,volume,delay=0,endFreq=freq){
    if(!this.ctx||!this.enabled)return;
    const now=this.ctx.currentTime+delay,osc=this.ctx.createOscillator(),gain=this.ctx.createGain();
    osc.type=type;osc.frequency.setValueAtTime(freq,now);
    if(endFreq!==freq)osc.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq),now+duration);
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(volume,now+.01);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    osc.connect(gain);gain.connect(this.master);osc.start(now);osc.stop(now+duration+.02);
    osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  // Short noise burst, for crashes and tyre scuff.
  noise(duration,volume,delay=0){
    if(!this.ctx||!this.enabled)return;
    const now=this.ctx.currentTime+delay,frames=Math.max(1,Math.floor(this.ctx.sampleRate*duration));
    const buffer=this.ctx.createBuffer(1,frames,this.ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<frames;i++)data[i]=(Math.random()*2-1)*(1-i/frames);
    const src=this.ctx.createBufferSource();src.buffer=buffer;
    const gain=this.ctx.createGain();gain.gain.value=volume;
    const filter=this.ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1600;
    src.connect(filter);filter.connect(gain);gain.connect(this.master);src.start(now);
    src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect();};
  }
  effect(type){
    if(!this.ctx||!this.enabled)return;
    switch(type){
      case 'hit': this.tone(140,.28,'square',.3,0,40);this.noise(.3,.32);break;
      case 'crash': this.tone(90,.42,'sawtooth',.3,0,32);this.noise(.42,.42);break;
      case 'boost': this.noise(.35,.055);break;
      case 'drift': this.tone(420,.1,'sine',.09);break;
      case 'pickup': this.tone(700,.11,'sine',.12);break;
      case 'finish': [440,660].forEach((n,i)=>this.tone(n,.25,'sine',.12,i*.18));break;
      case 'count': this.tone(780,.12,'sine',.16);break;
      case 'wrong': this.tone(220,.3,'square',.16,0,120);break;
      default: this.tone(880,.18,'square',.2,0,1320);
    }
  }
}
