import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { Player } from '../src/player.js';
import { B } from '../src/data.js';

const emptyKeys=new Set();
const floor=(_x,y,_z)=>y<=0?B.STONE:B.AIR;
function playerAt(position=[.5,1,.5],getBlock=floor,options={}){
  return new Player(new PerspectiveCamera(75,1,.1,100),{getBlock},{position,...options});
}
function run(player,seconds,keys=emptyKeys,dt=1/60){for(let t=0;t<seconds-dt/2;t+=dt)player.update(dt,keys);}

test('gravity settles feet on a floor and movement cannot penetrate a wall',()=>{
  const p=playerAt([.5,4,.5],(x,y,z)=>floor(x,y,z)||x===2&&y<5?B.STONE:B.AIR);
  run(p,1);assert.ok(Math.abs(p.position.y-1)<.002);assert.equal(p.grounded,true);
  run(p,2,new Set(['KeyD']));assert.ok(p.position.x<=1.7001&&p.position.x>1.69);assert.equal(p.collides(p.position),false);
});

test('jump clears a one-block ledge and lands without accumulated fall injury',()=>{
  const p=playerAt();run(p,.1);p.update(1/60,new Set(['Space']));
  let peak=p.position.y;for(let i=0;i<120;i++){p.update(1/60,emptyKeys);peak=Math.max(peak,p.position.y);}
  assert.ok(peak>2.25&&peak<2.6,`jump peak ${peak}`);assert.ok(Math.abs(p.position.y-1)<.002);assert.equal(p.health,20);
});

test('sneaking stops at a ledge while normal walking falls',()=>{
  const platform=(x,y,z)=>x===0&&z===0&&y<=0?B.STONE:B.AIR;
  const careful=playerAt([.5,1,.5],platform);run(careful,.1);run(careful,2,new Set(['ShiftLeft','KeyD']));
  assert.ok(careful.position.x<=1.3);assert.ok(careful.position.y>.99);assert.equal(careful.grounded,true);
  const walking=playerAt([.5,1,.5],platform);run(walking,.1);run(walking,.7,new Set(['KeyD']));assert.ok(walking.position.y<.8);
});

test('releasing crouch in midair beneath a ceiling never embeds the player',()=>{
  const p=playerAt([.5,1.4,.5],(x,y,z)=>y===3?B.STONE:floor(x,y,z));p.crouching=true;
  p.update(1/60,emptyKeys);assert.equal(p.collides(p.position),false);assert.equal(p.crouching,true);
  run(p,.5);assert.equal(p.crouching,false);assert.ok(Math.abs(p.position.y-1)<.002);
});

test('long falls hurt survival players but not creative players',()=>{
  const survivor=playerAt([.5,10,.5]);run(survivor,1.5);assert.ok(survivor.health<20&&survivor.health>0);assert.ok(Math.abs(survivor.position.y-1)<.002);
  const builder=playerAt([.5,10,.5],floor,{mode:'creative'});run(builder,1.5);assert.equal(builder.health,20);
});

test('a fast fall landing in one-block-deep water has no fall damage',()=>{
  const pool=(_x,y,_z)=>y<=0?B.STONE:y===1?B.WATER:B.AIR;
  const p=playerAt([.5,2.3,.5],pool);p.fallStart=20;p.velocity.y=-40;p.update(.05,emptyKeys);
  assert.ok(p.position.y>=.999);assert.equal(p.health,20);
});

test('swimming rises in water; drowning and damage cooldown behave independently',()=>{
  const water=(_x,y,_z)=>y<=0?B.STONE:y<10?B.WATER:B.AIR;
  const p=playerAt([.5,1,.5],water);run(p,1,new Set(['Space']));assert.ok(p.position.y>3);assert.equal(p.underwater,true);
  p.oxygen=0;run(p,1.2);assert.equal(p.health,18);assert.equal(p.damage(5),false);
  const creative=playerAt([.5,1,.5],water,{mode:'creative'});creative.oxygen=0;run(creative,2);assert.equal(creative.health,20);
});

test('creative double jump toggles flight and survival cannot enable flight',()=>{
  const p=playerAt([.5,5,.5],floor,{mode:'creative'});p.jumpPress(10);p.jumpPress(10.2);assert.equal(p.flying,true);
  run(p,.3,new Set(['Space']));assert.ok(p.position.y>7);
  p.jumpPress(11);p.jumpPress(11.2);assert.equal(p.flying,false);
  const s=playerAt();s.jumpPress(10);s.jumpPress(10.2);assert.equal(s.flying,false);
});

test('invalid damage and food cannot poison health or hunger',()=>{
  const p=playerAt();p.hunger=10;assert.equal(p.damage(-3),false);assert.equal(p.damage(NaN),false);assert.equal(p.health,20);
  assert.equal(p.eat(-2),false);assert.equal(p.eat(Infinity),false);assert.equal(p.hunger,10);
  assert.equal(p.eat(4),true);assert.equal(p.hunger,14);
});
