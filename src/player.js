import { Vector3, Euler } from 'three';
import { B, isSolid } from './data.js';

const RADIUS=.3, HEIGHT=1.8, EYES=1.62, EPS=.00001;
export class Player {
  constructor(camera,world,{position,yaw=0,pitch=0,mode='survival',health=20,hunger=20,xp=0}={}) {
    this.camera=camera; this.world=world; this.position=new Vector3(...(position||[0,45,0]));
    this.velocity=new Vector3(); this.yaw=yaw; this.pitch=pitch; this.mode=mode;
    this.health=health; this.hunger=hunger; this.xp=xp; this.oxygen=20;
    this.grounded=false; this.flying=false; this.inWater=false; this.underwater=false;
    this.crouching=false; this.sprinting=false; this.distance=0; this.bob=0;
    this.fallStart=this.position.y; this.damageCooldown=0; this.exhaustion=0; this.regenTimer=0;
    this.starveTimer=0; this.drownTimer=0; this.lastSpace=-1; this.onDamage=()=>{};
    this.onStep=()=>{}; this.stepDistance=0; this.settings={sensitivity:1,bob:true,fov:75};
    this.syncCamera();
  }
  look(dx,dy) { const s=.0021*this.settings.sensitivity; this.yaw-=dx*s; this.pitch=Math.max(-Math.PI/2+.01,Math.min(Math.PI/2-.01,this.pitch-dy*s)); }
  jumpPress(now) { if(this.mode==='creative' && now-this.lastSpace<.28) {this.flying=!this.flying;this.velocity.set(0,0,0);} this.lastSpace=now; }
  bounds(position=this.position) {return {minX:position.x-RADIUS,maxX:position.x+RADIUS,minY:position.y,maxY:position.y+(this.crouching?1.5:HEIGHT),minZ:position.z-RADIUS,maxZ:position.z+RADIUS};}
  intersectsBlock(x,y,z) {const a=this.bounds();return a.minX<x+1&&a.maxX>x&&a.minY<y+1&&a.maxY>y&&a.minZ<z+1&&a.maxZ>z;}
  collides(position) {
    const a=this.bounds(position);
    for(let x=Math.floor(a.minX+EPS);x<=Math.floor(a.maxX-EPS);x++)
      for(let y=Math.floor(a.minY+EPS);y<=Math.floor(a.maxY-EPS);y++)
        for(let z=Math.floor(a.minZ+EPS);z<=Math.floor(a.maxZ-EPS);z++) if(isSolid(this.world.getBlock(x,y,z))) return true;
    return false;
  }
  supported(x,z) {return this.collides(new Vector3(x,this.position.y-.1,z));}
  moveAxis(axis,amount) {
    if(!amount)return;
    const old=this.position[axis]; this.position[axis]+=amount;
    if(!this.collides(this.position))return;
    // Sweep back to the last non-intersecting point, independently on each axis.
    let lo=0,hi=1;
    for(let i=0;i<12;i++){let f=(lo+hi)/2;this.position[axis]=old+amount*f;if(this.collides(this.position))hi=f;else lo=f;}
    this.position[axis]=old+amount*lo;
    if(axis==='y') {
      if(amount<0) {
        this.grounded=true;
        const fallen=this.fallStart-this.position.y;
        // A fast fall can enter a shallow pool and reach its floor within one frame.
        const landedInWater=this.world.getBlock(Math.floor(this.position.x),Math.floor(this.position.y+.1),Math.floor(this.position.z))===B.WATER;
        if(!this.inWater&&!landedInWater&&!this.flying&&fallen>3.5)this.damage(Math.floor(fallen-3),'摔落');
        this.fallStart=this.position.y;
      }
      else this.fallStart=this.position.y;
    }
    this.velocity[axis]=0;
  }
  update(dt,keys) {
    dt=Number.isFinite(dt)?Math.max(0,Math.min(dt,.05)):0; this.damageCooldown=Math.max(0,this.damageCooldown-dt);
    const feetId=this.world.getBlock(Math.floor(this.position.x),Math.floor(this.position.y+.6),Math.floor(this.position.z));
    this.inWater=feetId===B.WATER;
    this.underwater=this.world.getBlock(Math.floor(this.position.x),Math.floor(this.position.y+EYES),Math.floor(this.position.z))===B.WATER;
    const wasCrouching=this.crouching;
    this.crouching=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&!this.flying;
    if(wasCrouching&&!this.crouching&&this.collides(this.position))this.crouching=true;
    this.sprinting=(keys.has('ControlLeft')||keys.has('ControlRight'))&&!this.crouching&&this.hunger>6;
    let forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    let strafe=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    const len=Math.hypot(forward,strafe)||1;forward/=len;strafe/=len;
    const speed=this.flying?(this.sprinting?20:10):this.inWater?2.7:this.crouching?1.4:this.sprinting?5.8:4.3;
    const tx=(strafe*Math.cos(this.yaw)-forward*Math.sin(this.yaw))*speed;
    const tz=(-strafe*Math.sin(this.yaw)-forward*Math.cos(this.yaw))*speed;
    const blend=1-Math.exp(-dt*(this.grounded?18:this.inWater?8:7));
    this.velocity.x+=(tx-this.velocity.x)*blend;this.velocity.z+=(tz-this.velocity.z)*blend;
    if(this.flying&&this.mode!=='creative')this.flying=false;
    if(this.flying) {this.velocity.y=(Number(keys.has('Space'))-Number(keys.has('ShiftLeft')||keys.has('ShiftRight')))*speed;this.fallStart=this.position.y;}
    else if(this.inWater){this.velocity.y-=5*dt;this.velocity.y*=Math.exp(-3*dt);if(keys.has('Space'))this.velocity.y=3.6;this.fallStart=this.position.y;}
    else {if(this.grounded&&keys.has('Space')){this.velocity.y=8.2;this.grounded=false;this.exhaustion+=.08;}this.velocity.y=Math.max(-45,this.velocity.y-24*dt);}
    const oldX=this.position.x,oldZ=this.position.z;
    const steps=Math.max(1,Math.ceil(this.velocity.length()*dt/.22));
    this.grounded=false;
    for(let i=0;i<steps;i++) {
      const dx=this.velocity.x*dt/steps,dz=this.velocity.z*dt/steps;
      if(!this.crouching||this.inWater||!this.supported(this.position.x,this.position.z)||this.supported(this.position.x+dx,this.position.z))this.moveAxis('x',dx);
      if(!this.crouching||this.inWater||!this.supported(this.position.x,this.position.z)||this.supported(this.position.x,this.position.z+dz))this.moveAxis('z',dz);
      this.moveAxis('y',this.velocity.y*dt/steps);
    }
    this.fallStart=Math.max(this.fallStart,this.position.y);
    const travel=Math.hypot(this.position.x-oldX,this.position.z-oldZ);this.distance+=travel;
    if(this.grounded||this.inWater){this.stepDistance+=travel;if(this.stepDistance>.95){this.stepDistance=0;this.onStep(this.inWater?'splash':'step',this.world.getBlock(Math.floor(this.position.x),Math.floor(this.position.y-.15),Math.floor(this.position.z)));}}
    this.bob+=(this.grounded?travel:0)*9;
    if(this.mode==='survival') {
      this.exhaustion+=travel*(this.sprinting?.09:.012);
      if(this.exhaustion>=4){this.hunger=Math.max(0,this.hunger-1);this.exhaustion-=4;}
      if(this.hunger>=18&&this.health<20){this.regenTimer+=dt;if(this.regenTimer>4){this.health=Math.min(20,this.health+1);this.exhaustion+=.7;this.regenTimer=0;}}else this.regenTimer=0;
      if(this.hunger<=0){this.starveTimer+=dt;if(this.starveTimer>4){if(this.health>1)this.damage(1,'饥饿');this.starveTimer=0;}}else this.starveTimer=0;
      if(this.underwater){this.oxygen=Math.max(0,this.oxygen-dt*1.25);if(this.oxygen===0){this.drownTimer+=dt;if(this.drownTimer>1){this.damage(2,'溺水');this.drownTimer=0;}}}else{this.oxygen=Math.min(20,this.oxygen+dt*5);this.drownTimer=0;}
      if(feetId===B.CACTUS)this.damage(1,'仙人掌');
    }
    if(this.position.y<-10)this.damage(100,'虚空');
    this.syncCamera();
  }
  syncCamera() {
    const bob=this.settings.bob&&this.grounded&&!this.flying?Math.sin(this.bob)*.035:0;
    this.camera.position.copy(this.position).add(new Vector3(0,(this.crouching?1.35:EYES)+bob,0));
    this.camera.quaternion.setFromEuler(new Euler(this.pitch,this.yaw,0,'YXZ'));
    const fov=Number(this.settings.fov||75)+(this.sprinting?5:0);
    if(Math.abs(this.camera.fov-fov)>.05){this.camera.fov+=(fov-this.camera.fov)*.15;this.camera.updateProjectionMatrix();}
  }
  damage(amount,reason='伤害') {if(!Number.isFinite(amount)||amount<=0||this.mode==='creative'||this.damageCooldown>0||this.health<=0)return false;this.health=Math.max(0,this.health-amount);this.damageCooldown=.65;this.onDamage(amount,reason);return true;}
  eat(food){if(!Number.isFinite(food)||food<=0||this.hunger>=20)return false;this.hunger=Math.min(20,this.hunger+food);return true;}
  serialize(){return {position:this.position.toArray(),yaw:this.yaw,pitch:this.pitch,health:this.health,hunger:this.hunger,xp:this.xp,mode:this.mode,flying:this.flying};}
}
