import {soundFrame,createRandom} from './presentation.js';
import {clamp,getTrack,shortDistance} from './tracks.js';

export class AudioEngine {
  constructor(){this.enabled=false;this.ctx=null;this.previous=null;this.nodes=[];this.lastImpact=-10;this.random=createRandom(3107);}
  createGraph(context){
    this.ctx=context;this.nodes=[];
    const own=node=>{this.nodes.push(node);return node;};
    this.master=own(context.createGain());this.master.gain.value=this.enabled?.55:0;
    const compressor=own(context.createDynamicsCompressor());compressor.threshold.value=-14;compressor.knee.value=12;compressor.ratio.value=4;compressor.attack.value=.005;compressor.release.value=.16;
    this.mix=own(context.createGain());this.mix.connect(compressor);compressor.connect(this.master);this.master.connect(context.destination);
    this.noiseBuffer=context.createBuffer(1,context.sampleRate*2,context.sampleRate);const samples=this.noiseBuffer.getChannelData(0),random=createRandom(9113);
    for(let i=0;i<samples.length;i++)samples[i]=(random()*2-1)*.72;
    // Combustion pulses: fundamental follows firing events per crank revolution.
    this.waves={};
    for(const engine of ['balanced','turbo']){
      const real=new Float32Array(18),imag=new Float32Array(18);
      for(let n=1;n<18;n++)imag[n]=(engine==='turbo'?(n%2?.9:.55):1)/Math.pow(n,1.35);
      this.waves[engine]=context.createPeriodicWave(real,imag);
    }
    this.filter=own(context.createBiquadFilter());this.filter.type='lowpass';this.filter.Q.value=.65;
    this.motorGain=own(context.createGain());this.motorGain.gain.value=0;
    this.shiftGain=own(context.createGain());this.shiftGain.gain.value=1;
    this.filter.connect(this.motorGain);this.motorGain.connect(this.shiftGain);this.shiftGain.connect(this.mix);
    this.motor=own(context.createOscillator());this.motor.setPeriodicWave(this.waves.balanced);this.motor.connect(this.filter);this.motor.start();
    this.motorSub=own(context.createOscillator());this.motorSub.type='triangle';const sub=own(context.createGain());sub.gain.value=.34;this.motorSub.connect(sub);sub.connect(this.filter);this.motorSub.start();
    const oscillator=(type)=>{const source=own(context.createOscillator()),gain=own(context.createGain());source.type=type;gain.gain.value=0;source.connect(gain);gain.connect(this.mix);source.start();return {source,gain};};
    this.electric=oscillator('sine');this.electricHarmonic=oscillator('sine');this.turbo=oscillator('sine');
    const noise=(type,frequency,offset)=>{
      const source=own(context.createBufferSource()),filter=own(context.createBiquadFilter()),gain=own(context.createGain());
      source.buffer=this.noiseBuffer;source.loop=true;filter.type=type;filter.frequency.value=frequency;filter.Q.value=.65;gain.gain.value=0;
      source.connect(filter);filter.connect(gain);gain.connect(this.mix);source.start(context.currentTime,offset);return {source,filter,gain};
    };
    this.air=noise('lowpass',700,.1);this.road=noise('bandpass',190,.4);this.intake=noise('bandpass',620,.8);
    this.tyres=noise('bandpass',1200,1.2);this.curb=noise('lowpass',135,1.6);this.boost=noise('bandpass',1100,.6);
    this.opponents=Array.from({length:2},()=>{
      const source=own(context.createOscillator()),filter=own(context.createBiquadFilter()),gain=own(context.createGain()),pan=context.createStereoPanner?own(context.createStereoPanner()):null;
      source.type='triangle';filter.type='lowpass';filter.frequency.value=750;gain.gain.value=0;source.connect(filter);filter.connect(gain);gain.connect(pan||this.mix);pan?.connect(this.mix);source.start();return {source,filter,gain,pan};
    });
    this.previous=null;this.lastImpact=-10;return this;
  }
  async unlock(){
    try{
      if(!this.ctx){const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;this.createGraph(new Context());}
      if(this.ctx.state==='suspended')await this.ctx.resume();
    }catch{
      const context=this.ctx;for(const node of this.nodes){try{node.stop?.();node.disconnect();}catch{}}
      this.nodes=[];this.ctx=null;this.master=null;try{void context?.close?.().catch(()=>{});}catch{}
    }
  }
  async toggle(){
    // User preference is immediate even when audio permission never resolves.
    this.enabled=!this.enabled;
    if(this.master)this.master.gain.setTargetAtTime(this.enabled?.55:0,this.ctx.currentTime,.035);
    if(this.enabled)void this.unlock();return this.enabled;
  }
  update(racer,active,options={}){
    if(!this.ctx||!this.master)return;
    const t=options.at??this.ctx.currentTime,frame=soundFrame(racer,active,options),engine=racer?.engine||'balanced';
    const target=(param,value,seconds=.055)=>param.setTargetAtTime(value,t,seconds);
    if(this.engine!==engine){this.engine=engine;this.motor.setPeriodicWave(this.waves[engine==='turbo'?'turbo':'balanced']);}
    target(this.motor.frequency,frame.frequency);target(this.motorSub.frequency,frame.frequency*.5,.075);
    target(this.filter.frequency,frame.filterFrequency);target(this.motorGain.gain,frame.combustionGain);
    target(this.electric.source.frequency,frame.frequency);target(this.electricHarmonic.source.frequency,frame.frequency*2.02);
    target(this.electric.gain.gain,frame.electricGain);target(this.electricHarmonic.gain.gain,frame.electricGain*.18);
    target(this.turbo.source.frequency,frame.turboFrequency,.13);target(this.turbo.gain.gain,frame.turboGain,active?.12:.025);
    for(const [layer,key] of [[this.air,'windGain'],[this.road,'roadGain'],[this.intake,'intakeGain'],[this.tyres,'tyreGain'],[this.curb,'curbGain'],[this.boost,'boostGain']])target(layer.gain.gain,frame[key],active?.065:.035);
    target(this.air.filter.frequency,450+(racer?.v||0)*15,.12);target(this.tyres.filter.frequency,frame.tyreFrequency);
    const powered=racer?.boosting===true||(options.throttle??(racer?.acceleration||0)>1);
    if(active&&this.previous?.id===racer?.id&&this.previous.engine===engine){
      if(engine!=='electric'&&racer.gear>this.previous.gear&&(racer.v||0)>6){
        this.shiftGain.gain.cancelScheduledValues(t);this.shiftGain.gain.setTargetAtTime(.32,t,.009);this.shiftGain.gain.setTargetAtTime(1,t+.065,.035);
        this.noise(.055,.055,t,500);
      }
      if(engine==='turbo'&&this.previous.powered&&!powered&&(racer.rpm||0)>2800){this.noise(.18,.075,t,1900);this.tone(1450,.15,'sine',.025,0,470,t);}
    }
    this.previous=active&&racer?{id:racer.id,engine,gear:racer.gear,powered}:null;
    const nearby=[];
    if(active&&options.race&&racer){
      const track=getTrack(options.race.trackId);
      for(const other of options.race.racers){if(other.id===racer.id||other.finishTime!==null)continue;
        const longitudinal=shortDistance(other.s,racer.s,track.length),distance=Math.hypot(longitudinal,other.x-racer.x);
        if(distance<55)nearby.push({other,distance,pan:clamp(-(other.x-racer.x)/7,-.95,.95),relative:(other.v-racer.v)*Math.sign(longitudinal)});
      }
      nearby.sort((a,b)=>a.distance-b.distance);
    }
    this.opponents.forEach((voice,i)=>{
      const entry=nearby[i];target(voice.gain.gain,entry?.other.v>1?.048/Math.pow(1+entry.distance/9,1.5):0,.12);
      if(entry){const other=soundFrame(entry.other,true);target(voice.source.frequency,other.frequency*clamp(1-entry.relative/343,.85,1.15),.09);if(voice.pan)target(voice.pan.pan,entry.pan,.1);}
    });
    this.frame=frame;
  }
  tone(freq,duration,type,volume,delay=0,endFreq=freq,at=this.ctx?.currentTime){
    if(!this.ctx||!this.enabled)return;
    const now=at+delay,osc=this.ctx.createOscillator(),gain=this.ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,now);
    if(endFreq!==freq)osc.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq),now+duration);
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(volume,now+.006);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    osc.connect(gain);gain.connect(this.mix);osc.start(now);osc.stop(now+duration+.02);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  noise(duration,volume,at=this.ctx?.currentTime,frequency=1200){
    if(!this.ctx||!this.enabled)return;
    const source=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),gain=this.ctx.createGain();source.buffer=this.noiseBuffer;
    filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=.6;gain.gain.setValueAtTime(volume,at);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    source.connect(filter);filter.connect(gain);gain.connect(this.mix);source.start(at,this.random()*.9);source.stop(at+duration);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  effect(type){
    if(!this.ctx||!this.enabled||this.ctx.state!=='running')return;
    switch(type){
      case 'hit':case 'crash':
        if(this.ctx.currentTime-this.lastImpact<.18)return;this.lastImpact=this.ctx.currentTime;
        this.tone(95,.22,'triangle',.22,0,32);this.noise(.17,.23,undefined,650);this.noise(.08,.09,undefined,2600);break;
      case 'boost':this.noise(.3,.08,undefined,950);break;
      case 'drift':break; // Continuous slip already describes tyre traction.
      case 'pickup':this.tone(740,.12,'sine',.11,0,1020);break;
      case 'finish':[440,660].forEach((n,i)=>this.tone(n,.25,'sine',.12,i*.18));break;
      case 'count':this.tone(780,.12,'sine',.13);break;
      case 'wrong':this.tone(220,.3,'triangle',.13,0,120);break;
      default:this.tone(880,.14,'sine',.09,0,1120);
    }
  }
  get diagnostics(){return {enabled:this.enabled,state:this.ctx?.state||'unavailable',engine:this.engine||'balanced',...this.frame};}
}
