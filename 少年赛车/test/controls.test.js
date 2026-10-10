import test from 'node:test';
import assert from 'node:assert/strict';
import {Controls} from '../src/controls.js';
import {createRace,stepRace,cleanInput} from '../src/simulation.js';
function fixture(t) {
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  const win=new EventTarget(),doc=new EventTarget();doc.hidden=false;
  const buttons=Object.fromEntries(['left','right','item','drift','nitro'].map(name=>{
    const button=new EventTarget(),classes=new Set();button.dataset={control:name};button.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)};button.setPointerCapture=()=>{};return [name,button];
  }));
  doc.querySelectorAll=()=>Object.values(buttons);globalThis.window=win;globalThis.document=doc;
  t.after(()=>{globalThis.window=oldWindow;globalThis.document=oldDocument;});
  const controls=new Controls();controls.enabled=true;
  const emit=(target,type,data={})=>target.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),data));
  return {controls,win,doc,buttons,emit};
}
test('极短键盘道具点击跨渲染／发送间隔仍会执行，重复快照不重复使用',t=>{
  const {controls,win,emit}=fixture(t);emit(win,'keydown',{code:'KeyE'});emit(win,'keyup',{code:'KeyE'});
  const input=controls.read();assert.equal(input.item,false);assert.equal(input.itemPress,1);
  const race=createRace();race.time=1;const me=race.racers[0];me.item='shield';me.input=cleanInput(input);stepRace(race,1/60);assert.ok(me.shield>0);assert.equal(me.item,null);
  me.item='nitro';me.input=cleanInput(controls.read());stepRace(race,1/60);assert.equal(me.item,'nitro');
  emit(win,'keydown',{code:'KeyE'});emit(win,'keyup',{code:'KeyE'});me.input=cleanInput(controls.read());stepRace(race,1/60);assert.equal(me.item,null);assert.ok(me.boost>0);
});
test('手机短按道具不会丢失，多指操作和失去焦点均能正确释放',t=>{
  const {controls,win,buttons,emit}=fixture(t);
  emit(buttons.item,'pointerdown',{pointerId:1});emit(buttons.item,'pointerup',{pointerId:1});assert.equal(controls.read().itemPress,1);assert.equal(controls.read().item,false);
  emit(buttons.right,'pointerdown',{pointerId:2});emit(buttons.drift,'pointerdown',{pointerId:3});emit(buttons.nitro,'pointerdown',{pointerId:4});const input=controls.read();assert.equal(input.steer,-1);assert.equal(input.drift,true);assert.equal(input.nitro,true);
  emit(win,'blur');assert.equal(controls.read().steer,0);assert.equal(controls.read().drift,false);assert.equal(controls.read().nitro,false);
  emit(buttons.item,'pointerdown',{pointerId:5});assert.equal(controls.read().itemPress,2);
});
test('键盘自动重复不重复记为点击；隐藏页面停止自动油门',t=>{
  const {controls,win,doc,emit}=fixture(t);emit(win,'keydown',{code:'KeyE'});emit(win,'keydown',{code:'KeyE',repeat:true});assert.equal(controls.read().itemPress,1);
  doc.hidden=true;emit(doc,'visibilitychange');const input=controls.read();assert.equal(input.throttle,false);assert.equal(input.brake,true);assert.equal(input.steer,0);
});
