import * as THREE from 'three';
import { BLOCKS, ITEMS } from './data.js';

export function blockGeometry(id,atlas,size=1){
  const geometry=new THREE.BoxGeometry(size,size,size);const uv=geometry.attributes.uv;
  for(let f=0;f<6;f++) {const rect=atlas.uvFor(id,f);for(let k=0;k<4;k++){const i=f*4+k;uv.setXY(i,rect[0]+uv.getX(i)*(rect[2]-rect[0]),rect[1]+uv.getY(i)*(rect[3]-rect[1]));}}
  return geometry;
}
export class Visuals {
  constructor(scene,camera,atlas){
    this.scene=scene;this.camera=camera;this.atlas=atlas;this.particles=[];this.drops=[];this.swing=0;this.time=0;
    this.material=new THREE.MeshLambertMaterial({map:atlas.texture,alphaTest:.15});
    this.outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006,1.006,1.006)),new THREE.LineBasicMaterial({color:0x111710,transparent:true,opacity:.8}));this.outline.visible=false;scene.add(this.outline);
    this.crackCanvas=document.createElement('canvas');this.crackCanvas.width=this.crackCanvas.height=32;this.crackTexture=new THREE.CanvasTexture(this.crackCanvas);this.crackTexture.magFilter=THREE.NearestFilter;this.crackTexture.minFilter=THREE.NearestFilter;
    this.cracks=new THREE.Mesh(new THREE.BoxGeometry(1.009,1.009,1.009),new THREE.MeshBasicMaterial({map:this.crackTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));this.cracks.visible=false;scene.add(this.cracks);this.crackStage=-1;
    this.handScene=new THREE.Scene();this.handCamera=new THREE.PerspectiveCamera(65,window.innerWidth/window.innerHeight,.01,10);this.handCamera.position.z=2;
    this.handScene.add(new THREE.HemisphereLight(0xffffff,0x5b4c40,2.4));const l=new THREE.DirectionalLight(0xffffff,2);l.position.set(-3,6,3);this.handScene.add(l);
    this.handGroup=new THREE.Group();this.handScene.add(this.handGroup);this.itemId=-1;
    this.torch=new THREE.PointLight(0xffb954,0,13,2);scene.add(this.torch);
    this.damageFlash=document.createElement('div');this.damageFlash.id='damage-flash';document.body.append(this.damageFlash);
  }
  target(hit,progress=0){
    this.outline.visible=!!hit;this.cracks.visible=!!hit&&progress>0;
    if(!hit)return;this.outline.position.set(hit.x+.5,hit.y+.5,hit.z+.5);this.cracks.position.copy(this.outline.position);
    const stage=Math.floor(progress*9);if(stage!==this.crackStage){this.crackStage=stage;const c=this.crackCanvas.getContext('2d');c.clearRect(0,0,32,32);c.strokeStyle='rgba(18,14,10,.78)';c.lineWidth=1.3;
      for(let i=0;i<stage+2;i++){let x=16,y=16;c.beginPath();c.moveTo(x,y);for(let n=0;n<4;n++){const a=(i*2.399+n*.7);x+=Math.cos(a)*(3+stage/2);y+=Math.sin(a)*(3+stage/2);c.lineTo(Math.round(x),Math.round(y));}c.stroke();}this.crackTexture.needsUpdate=true;}
  }
  setHeld(id){
    if(id===this.itemId)return;this.itemId=id;
    this.clearHand();
    if(id>0&&BLOCKS[id]&&!BLOCKS[id].cross){const m=new THREE.Mesh(blockGeometry(id,this.atlas,.45),this.material.clone());m.rotation.set(.1,-.6,.1);this.handGroup.add(m);}
    else if(id>0){
      const icon=this.atlas.icons[id];if(icon){const texture=new THREE.TextureLoader().load(icon);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;const mat=new THREE.MeshLambertMaterial({map:texture,transparent:true,alphaTest:.2,side:THREE.DoubleSide});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.65,.65),mat);mesh.rotation.z=-.25;this.handGroup.add(mesh);}
      else {const m=new THREE.Mesh(new THREE.BoxGeometry(.13,.6,.13),new THREE.MeshLambertMaterial({color:ITEMS[id]?.color||0x965f34}));m.rotation.z=-.45;this.handGroup.add(m);}
    }else{
      const skin=new THREE.Mesh(new THREE.BoxGeometry(.22,.64,.24),new THREE.MeshLambertMaterial({color:0xbf906d}));skin.rotation.z=.25;this.handGroup.add(skin);
      const sleeve=new THREE.Mesh(new THREE.BoxGeometry(.23,.3,.25),new THREE.MeshLambertMaterial({color:0x3c9ba4}));sleeve.position.set(.05,-.27,0);sleeve.rotation.z=.25;this.handGroup.add(sleeve);
    }
  }
  clearHand(){while(this.handGroup.children.length){const c=this.handGroup.children[0];this.handGroup.remove(c);c.geometry?.dispose();if(c.material?.map&&c.material.map!==this.atlas.texture)c.material.map.dispose();c.material?.dispose();}}
  swingHand(){this.swing=1;}
  flash(){this.damageFlash.classList.remove('hit');void this.damageFlash.offsetWidth;this.damageFlash.classList.add('hit');}
  spawnBreak(position,id,count=12){
    const color=new THREE.Color(ITEMS[id]?.color||'#999999');
    for(let i=0;i<count;i++){const m=new THREE.Mesh(new THREE.BoxGeometry(.07,.07,.07),new THREE.MeshLambertMaterial({color:color.clone().multiplyScalar(.7+Math.random()*.6)}));m.position.set(position.x+.5+(Math.random()-.5)*.7,position.y+.5+(Math.random()-.5)*.7,position.z+.5+(Math.random()-.5)*.7);this.scene.add(m);this.particles.push({mesh:m,velocity:new THREE.Vector3((Math.random()-.5)*4,2+Math.random()*3,(Math.random()-.5)*4),life:.5+Math.random()*.4});}
  }
  drop(id,count,position,durability){
    if(!id||count<=0)return;
    const geometry=BLOCKS[id]?blockGeometry(id,this.atlas,.23):new THREE.BoxGeometry(.15,.15,.04);
    const mesh=new THREE.Mesh(geometry,BLOCKS[id]?this.material:new THREE.MeshLambertMaterial({color:ITEMS[id]?.color||'#eeeeee'}));
    mesh.position.copy(position).add(new THREE.Vector3(0,.3,0));this.scene.add(mesh);this.drops.push({id,count,durability,mesh,age:0,velocity:new THREE.Vector3((Math.random()-.5)*1.5,2,(Math.random()-.5)*1.5)});
  }
  serializeDrops(){return this.drops.map(d=>({id:d.id,count:d.count,durability:d.durability,position:d.mesh.position.toArray(),age:d.age,velocity:d.velocity.toArray()}));}
  restoreDrops(drops=[]){for(const d of drops||[]){if(!ITEMS[d.id]||!d.count||!Array.isArray(d.position)||d.position.length!==3||!d.position.every(Number.isFinite))continue;this.drop(d.id,d.count,new THREE.Vector3(...d.position).add(new THREE.Vector3(0,-.3,0)),d.durability);const latest=this.drops.at(-1);latest.age=Math.max(0,Number(d.age)||0);if(Array.isArray(d.velocity)&&d.velocity.length===3&&d.velocity.every(Number.isFinite))latest.velocity.set(...d.velocity);}}
  update(dt,player,world,inventory,audio){
    this.time+=dt;this.swing=Math.max(0,this.swing-dt*3.6);
    const t=Math.sin(this.swing*Math.PI);this.handGroup.position.set(.62-t*.2,-.46+t*.14,.1-t*.25);this.handGroup.rotation.set(t*-.65,0,-.22+t*.55);
    if(player.settings.bob&&player.grounded)this.handGroup.position.y+=Math.sin(player.bob)*.018;
    this.torch.position.copy(player.camera.position);this.torch.intensity=this.itemId===32?14:this.itemId===21?9:0;
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;p.velocity.y-=12*dt;p.mesh.position.addScaledVector(p.velocity,dt);p.mesh.rotation.x+=dt*5;if(p.life<=0){this.scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();this.particles.splice(i,1);}}
    for(let i=this.drops.length-1;i>=0;i--){const d=this.drops[i];d.age+=dt;const p=d.mesh.position;d.velocity.y-=12*dt;const next=p.y+d.velocity.y*dt;if(BLOCKS[world.getBlock(Math.floor(p.x),Math.floor(next-.12),Math.floor(p.z))]?.solid&&d.velocity.y<0){d.velocity.set(0,0,0);p.y=Math.floor(next-.12)+1.14;}else p.addScaledVector(d.velocity,dt);d.mesh.rotation.y+=dt*1.5;
      const distance=p.distanceTo(player.position.clone().add(new THREE.Vector3(0,.7,0)));if(d.age>.7&&distance<2){p.lerp(player.position.clone().add(new THREE.Vector3(0,.8,0)),Math.min(1,dt*8));if(distance<1.2){const left=inventory.add(d.id,d.count,d.durability);if(left!==d.count){audio.play('click');d.count=left;}}}
      if(!d.count||d.age>300){this.scene.remove(d.mesh);d.mesh.geometry.dispose();if(d.mesh.material!==this.material)d.mesh.material.dispose();this.drops.splice(i,1);}
    }
  }
  renderHand(renderer,visible){if(!visible)return;renderer.clearDepth();this.handCamera.aspect=this.camera.aspect;this.handCamera.updateProjectionMatrix();renderer.render(this.handScene,this.handCamera);}
  dispose(){this.clearHand();this.scene.remove(this.outline,this.cracks,this.torch);for(const p of [...this.particles,...this.drops]){this.scene.remove(p.mesh);p.mesh.geometry.dispose();if(p.mesh.material!==this.material)p.mesh.material.dispose();}this.outline.geometry.dispose();this.outline.material.dispose();this.cracks.geometry.dispose();this.cracks.material.dispose();this.crackTexture.dispose();this.material.dispose();this.damageFlash.remove();}
}
