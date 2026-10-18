import test from 'node:test';
import assert from 'node:assert/strict';
import {Controls} from '../src/controls.js';
function fixture(t){
 const oldWindow=globalThis.window,oldDocument=globalThis.document,win=new EventTarget(),doc=new EventTarget();doc.hidden=false;doc.querySelectorAll=()=>[];globalThis.window=win;globalThis.document=doc;
 t.after(()=>{globalThis.window=oldWindow;globalThis.document=oldDocument;});const c=new Controls();c.enabled=true;
 const key=(type,code,repeat=false)=>win.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{code,repeat}));return {c,win,doc,key};
}
test('a legacy auto-throttle setting cannot move a manual racing car',t=>{
 const {c,key}=fixture(t);c.autoThrottle=true;assert.equal(c.read().throttle,false);key('keydown','KeyW');assert.equal(c.read().throttle,true);key('keyup','KeyW');assert.equal(c.read().throttle,false);
});
test('one reset press survives frame and network sampling but keyboard repeat does not duplicate it',t=>{
 const {c,key}=fixture(t);key('keydown','KeyR');key('keydown','KeyR',true);key('keyup','KeyR');assert.equal(c.read().resetPress,1);assert.equal(c.read().resetPress,1);assert.equal(typeof c.requestReset,'function');c.requestReset();assert.equal(c.read().resetPress,2);
});
test('disabled or hidden controls apply parking rather than unattended reversing',t=>{
 const {c,doc}=fixture(t);c.enabled=false;assert.equal(c.read().park,true);assert.equal(c.read().throttle,false);c.enabled=true;doc.hidden=true;assert.equal(c.read().park,true);
});
