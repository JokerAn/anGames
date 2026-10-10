import test from 'node:test';
import assert from 'node:assert/strict';
import {Soundscape} from '../audio.js';

async function withAudio(Audio,check){
  const original=globalThis.window;globalThis.window={AudioContext:Audio};
  try{await check();}finally{if(original===undefined)delete globalThis.window;else globalThis.window=original;}
}
test('missing audio API degrades to silent play',()=>withAudio(undefined,()=>{
  const sound=new Soundscape();assert.doesNotThrow(()=>sound.unlock());assert.equal(sound.unavailable,true);
  assert.doesNotThrow(()=>sound.play('shoot'));assert.equal(sound.toggle(),false);
}));
test('audio constructor failure never escapes or repeatedly allocates',()=>{
  let attempts=0;
  return withAudio(class{constructor(){attempts++;throw new Error('audio unavailable');}},()=>{
    const sound=new Soundscape();assert.doesNotThrow(()=>sound.unlock());assert.doesNotThrow(()=>sound.unlock());
    assert.equal(sound.context,null);assert.equal(attempts,1);
  });
});
test('partial audio initialization failure closes the orphaned context',()=>{
  let closed=0;
  return withAudio(class{createGain(){throw new Error('device unavailable');}close(){closed++;return Promise.resolve();}},()=>{
    const sound=new Soundscape();assert.doesNotThrow(()=>sound.unlock());assert.equal(closed,1);assert.equal(sound.context,null);
  });
});
for(const rejection of ['sync','async'])test(`${rejection} audio resume failure is nonfatal`,()=>withAudio(class{
  state='suspended';createGain(){return{gain:{},connect(){}};}
  resume(){if(rejection==='sync')throw new Error('gesture denied');return Promise.reject(new Error('gesture denied'));}
},async()=>{const sound=new Soundscape();assert.doesNotThrow(()=>sound.unlock());await Promise.resolve();assert.ok(sound.context);}));
