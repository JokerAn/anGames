#!/usr/bin/env node
// Project-local canvas-inspector runner. The vendored inspector is the
// threejs-qa-release script with one adaptation: its per-capture preparation
// budget is 20 s instead of 10 s, because the first cold shader compile of the
// layered premium world can exceed the starting-point default.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..','..');
const inspector=path.join(__dirname,'inspect-threejs-canvas.mjs');
const shim=path.join(__dirname,'qa-deps','node_modules');
const candidates=[process.env.PLAYWRIGHT_MODULE,
  '/Users/anshunli/gitHub/anGames/少年枪王/node_modules/playwright',
  'playwright'];
let playwright=null;
for(const candidate of candidates){
  if(!candidate)continue;
  try{
    const resolved=require.resolve(candidate,{paths:[root,process.cwd()]});
    playwright=path.dirname(resolved);
    if(playwright.endsWith('playwright-core'))playwright=path.dirname(playwright);
    break;
  }catch{}
}
if(!playwright){console.error('Cannot find Playwright. Set PLAYWRIGHT_MODULE to an installed playwright package directory.');process.exit(1);}
const nodePath=[shim,path.dirname(playwright),process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
const args=[inspector,...process.argv.slice(2)];
if(!args.includes('--manifest'))args.push('--manifest','artifacts/evidence.json');
if(!args.includes('--url'))args.push('--url','http://127.0.0.1:3210/?evidence=1');
const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,NODE_PATH:nodePath}});
process.exit(result.status??1);
