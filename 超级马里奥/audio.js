// All sounds are synthesized locally: no downloads, samples or autoplay requests.
export class Soundscape {
  constructor(enabled = true) { this.enabled = enabled; this.context = null; this.nextBeat = 0; this.beat = 0; this.music = true; this.musicNext = 0; this.musicBeat = 0; }
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
  toggleMusic() { this.music = !this.music; if (!this.music) this.musicNext = 0; return this.music; }
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
      case 'shoot': this.tone(1200,.06,'square',.2,0,320); this.tone(600,.05,'square',.12,0,200); break;
      case 'hit': this.tone(1046,.07,'square',.2,0,392); this.tone(1568,.1,'square',.14,.05); break;
      case 'ammo': [784,988,1318].forEach((n,i)=>this.tone(n,.14,'square',.18,i*.05)); break;
      case 'empty': this.tone(180,.06,'square',.12,0,120); break;
      case 'jump': this.tone(392, .16, 'square', .26, 0, 784); break;
      case 'coin': this.tone(1318, .07, 'square', .24); this.tone(1976, .18, 'square', .18, .06); break;
      case 'star': [659,784,988,1318,1568].forEach((n,i)=>this.tone(n,.3,'square',.2,i*.06)); break;
      case 'stomp': this.tone(320,.12,'square',.32,0,90); this.tone(880,.1,'square',.16,.04,330); break;
      case 'hurt': this.tone(330,.32,'square',.12,0,80); break;
      case 'dash': this.tone(260,.16,'square',.26,0,1320); break;
      case 'block': this.tone(220,.08,'square',.16,0,110); break;
      case 'spring': this.tone(220,.32,'square',.3,0,1500); break;
      case 'checkpoint': [523,659,784,1046].forEach((n,i)=>this.tone(n,.26,'square',.22,i*.09)); break;
      case 'win': [523,659,784,1046,1318,1046,1318,1568].forEach((n,i)=>this.tone(n,.34,'square',.22,i*.13)); break;
      case 'lose': [392,330,262,196].forEach((n,i)=>this.tone(n,.4,'square',.18,i*.18)); break;
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
  // A persistent, looping background melody (chiptune-style) that plays for the
  // whole session -- not just during play -- and can be muted on its own.
  musicTrack() {
    if (!this.context || !this.enabled || !this.music || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (this.musicNext < now - .1) this.musicNext = now;
    // A classic, driving 16-step platformer loop (Mario-style vamp): a brisk
    // marching bassline under a playful hop-along lead and a steady hat.
    const lead =  [76,76,0,76,0,72,76,0,79,0,0,0,67,0,0,0];
    const bass =  [48,0,48,0,43,0,48,0,45,0,52,0,43,0,50,0];
    const beatLen = .19;
    while (this.musicNext < now + .14) {
      const i = this.musicBeat % lead.length, delay = this.musicNext - now;
      const note = lead[i];
      if (note) { this.tone(440 * 2 ** ((note - 69) / 12), beatLen * .92, 'square', .034, delay); this.tone(880 * 2 ** ((note - 69) / 12), beatLen * .5, 'square', .012, delay); }
      const low = bass[i];
      if (low) this.tone(440 * 2 ** ((low - 69) / 12), beatLen * 1.05, 'triangle', .055, delay);
      this.tone(6600, .022, 'square', .006, delay);
      this.musicBeat++; this.musicNext += beatLen;
    }
  }
  suspend() { if (this.context?.state === 'running') this.context.suspend().catch(() => {}); this.nextBeat = 0; this.musicNext = 0; }
}
