// All sounds are synthesized locally: no downloads, samples or autoplay requests.
export class Soundscape {
  constructor(enabled = true) { this.enabled = enabled; this.context = null; this.nextBeat = 0; this.beat = 0; this.music = false; }
  unlock() {
    if(this.unavailable)return;
    if(!this.context){
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio){this.unavailable=true;return;}
      let context;
      try{
        context=new Audio();const master=context.createGain();
        master.gain.value=this.enabled ? .32 : 0;master.connect(context.destination);
        this.context=context;this.master=master;
      }catch{
        this.unavailable=true;
        try{context?.close()?.catch(()=>{});}catch{}
        return;
      }
    }
    if(this.context.state==='suspended'){
      // Audio restrictions must never prevent the game from starting.
      try{Promise.resolve(this.context.resume()).catch(()=>{});}catch{}
    }
  }
  toggle() { this.enabled = !this.enabled; if (this.master) this.master.gain.setTargetAtTime(this.enabled ? .32 : 0, this.context.currentTime, .04); return this.enabled; }
  tone(freq, duration = .15, type = 'sine', volume = .2, delay = 0, endFreq = freq) {
    if (!this.context || !this.enabled || this.context.state !== 'running') return;
    const t = this.context.currentTime + delay, osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t); osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t + duration);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(volume, t + .012); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(t); osc.stop(t + duration + .02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  play(name) {
    switch (name) {
      case 'shoot': this.tone(720,.09,'triangle',.23,0,180); this.tone(140,.055,'sine',.13); break;
      case 'hit': this.tone(960,.11,'sine',.2,0,300); break;
      case 'ammo': [659,880,1108].forEach((n,i)=>this.tone(n,.18,'sine',.2,i*.055)); break;
      case 'empty': this.tone(120,.055,'triangle',.1,0,90); break;
      case 'jump': this.tone(300, .19, 'triangle', .3, 0, 720); break;
      case 'coin': this.tone(1046, .1, 'sine', .3); this.tone(1568, .22, 'sine', .2, .065); break;
      case 'star': [523,659,784,1046,1318].forEach((n,i)=>this.tone(n,.35,'sine',.25,i*.07)); break;
      case 'stomp': this.tone(210,.16,'triangle',.4,0,70); this.tone(650,.12,'sine',.2,.05,260); break;
      case 'hurt': this.tone(220,.3,'sawtooth',.12,0,65); break;
      case 'dash': this.tone(190,.18,'triangle',.3,0,1050); break;
      case 'block': this.tone(160,.09,'square',.15,0,95); break;
      case 'spring': this.tone(160,.35,'triangle',.35,0,1200); break;
      case 'checkpoint': [392,523,659].forEach((n,i)=>this.tone(n,.3,'sine',.24,i*.1)); break;
      case 'win': [523,659,784,1046,784,1046].forEach((n,i)=>this.tone(n,.4,'triangle',.25,i*.15)); break;
      case 'lose': [330,294,220,165].forEach((n,i)=>this.tone(n,.45,'triangle',.2,i*.2)); break;
    }
  }
  update(active) {
    if (!this.context || !this.enabled || this.context.state !== 'running') return;
    if (!active) { this.nextBeat = 0; return; }
    const now = this.context.currentTime;
    if (this.nextBeat < now - .1) this.nextBeat = now;
    const tune = [76,0,79,0,81,79,76,74,72,0,74,76,79,0,76,0,74,0,72,0,69,72,74,0,76,0,74,72,67,0,72,0];
    while (this.nextBeat < now + .12) {
      const note = tune[this.beat % tune.length];
      if (note) this.tone(440 * 2 ** ((note - 69) / 12), .26, 'sine', .065, this.nextBeat - now);
      if (this.beat % 4 === 0) this.tone([130.81,110,146.83,98][Math.floor(this.beat / 8) % 4], .55, 'triangle', .075, this.nextBeat - now);
      this.beat++; this.nextBeat += .22;
    }
  }
  suspend() { if (this.context?.state === 'running') this.context.suspend().catch(() => {}); this.nextBeat = 0; }
}
