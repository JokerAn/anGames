export class AudioEngine {
  constructor(){this.enabled=false;this.ctx=null;this.lastHit=0;this.lastBoost=false;}
  async unlock(){try{if(!this.ctx){const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)return;this.ctx=new AudioContext();this.master=this.ctx.createGain();
    // Start audible as soon as the user interacts: the race begins on a click, so
    // the engine should be heard without a separate trip to the sound button.
    this.enabled=true;this.master.gain.value=.22;this.master.connect(this.ctx.destination);
    // Layered engine: a sawtooth body + a square sub-harmonic through a low-pass,
    // which reads like a small high-revving (Ferrari-ish) motor rather than a drone.
    this.motor=this.ctx.createOscillator();this.motor.type='sawtooth';
    this.motorSub=this.ctx.createOscillator();this.motorSub.type='square';
    this.motorSubGain=this.ctx.createGain();this.motorSubGain.gain.value=.5;
    this.filter=this.ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=300;this.filter.Q.value=6;
    this.motorGain=this.ctx.createGain();this.motorGain.gain.value=0;
    this.motor.connect(this.filter);this.motorSub.connect(this.motorSubGain);this.motorSubGain.connect(this.filter);this.filter.connect(this.motorGain);this.motorGain.connect(this.master);
    this.motor.start();this.motorSub.start();}if(this.ctx.state==='suspended')await this.ctx.resume();}catch{}}
  async toggle(){await this.unlock();this.enabled=!this.enabled;if(this.master)this.master.gain.setTargetAtTime(this.enabled?.22:0,this.ctx.currentTime,.05);return this.enabled;}
  // Explicit state used by the start button so a race always has sound.
  enable(){if(this.ctx){this.enabled=true;this.master.gain.setTargetAtTime(.22,this.ctx.currentTime,.05);}}
  update(racer,active){
    if(!this.ctx)return;
    const v=racer?.v||0,t=this.ctx.currentTime;
    const base=42+v*2.6;
    this.motor.frequency.setTargetAtTime(base,t,.06);
    this.motorSub.frequency.setTargetAtTime(base/2,t,.06);
    // Open the filter under nitro/boost for a bright, aggressive growl.
    this.filter.frequency.setTargetAtTime(racer?.boosting?1500:Math.min(900,340+v*7),t,.08);
    this.motorGain.gain.setTargetAtTime(active?.14:0,t,.08);
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
      case 'boost': this.tone(220,.5,'sawtooth',.26,0,1400);this.tone(440,.4,'square',.12,.02,2600);break;
      case 'drift': this.tone(520,.28,'triangle',.16,0,900);break;
      case 'pickup': [784,1046,1318].forEach((n,i)=>this.tone(n,.14,'square',.16,i*.05));break;
      case 'finish': [659,784,988,1318].forEach((n,i)=>this.tone(n,.3,'square',.2,i*.13));break;
      case 'count': this.tone(660,.22,'square',.22);break;
      case 'wrong': this.tone(220,.3,'square',.16,0,120);break;
      default: this.tone(880,.18,'square',.2,0,1320);
    }
  }
}
