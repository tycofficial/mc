import * as THREE from 'three';
import { B, BLOCKS } from './data.js';
import { createTextureAtlas } from './textures.js';
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, createTerrain, indexOf, voxelRaycast } from './terrain.js';
export { WORLD_HEIGHT, SEA_LEVEL, CHUNK_SIZE } from './terrain.js';

const FACES=[
  {n:[1,0,0],v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]],shade:.83,axes:[1,2]},
  {n:[-1,0,0],v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],shade:.75,axes:[1,2]},
  {n:[0,1,0],v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],shade:1,axes:[0,2]},
  {n:[0,-1,0],v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],shade:.55,axes:[0,2]},
  {n:[0,0,1],v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],shade:.9,axes:[0,1]},
  {n:[0,0,-1],v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]],shade:.7,axes:[0,1]},
];
for(const f of FACES)f.ao=f.v.map(v=>{
  const a=[...f.n],b=[...f.n],c=[...f.n],aa=f.axes[0],bb=f.axes[1],sa=v[aa]?1:-1,sb=v[bb]?1:-1;
  a[aa]+=sa;b[bb]+=sb;c[aa]+=sa;c[bb]+=sb;return [a,b,c];
});
const keyOf=(cx,cz)=>`${cx},${cz}`;
const opaque=id=>!!BLOCKS[id]?.solid && !BLOCKS[id]?.transparent;
const meshBuffer=()=>({p:[],n:[],uv:[],c:[],i:[]});
function geometryFor(b){
  if(!b.p.length)return null;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));
  geometry.setIndex(b.i);geometry.computeBoundingSphere();return geometry;
}

/** Chunked voxel renderer. Only exposed faces are uploaded; edited chunks rebuild on a budget. */
export class World {
  constructor(scene,{seed='方块世界',renderDistance=4,edits=[],atlas=null}={}) {
    this.scene=scene;this.seed=String(seed);this.renderDistance=renderDistance;this.terrain=createTerrain(seed);
    this.chunks=new Map();this.edits=new Map();this.editsByChunk=new Map();this.dirty=new Set();this.queue=[];
    this.lastCX=NaN;this.lastCZ=NaN;this.lastDistance=0;this.totalFaces=0;
    this.atlas=atlas||createTextureAtlas();
    this.material=new THREE.MeshLambertMaterial({map:this.atlas.texture,vertexColors:true,alphaTest:.4,side:THREE.DoubleSide});
    this.waterMaterial=new THREE.MeshLambertMaterial({map:this.atlas.texture,vertexColors:true,transparent:true,opacity:.65,depthWrite:false,side:THREE.DoubleSide});
    this.glowMaterial=new THREE.MeshBasicMaterial({map:this.atlas.texture,vertexColors:true,alphaTest:.4,side:THREE.DoubleSide});
    if(Array.isArray(edits))for(const e of edits){
      if(Array.isArray(e)&&e.length>=4)this._recordEdit(...e);
      else if(e && typeof e==='object')this._recordEdit(e.x,e.y,e.z,e.id);
    }
    else if(edits&&typeof edits==='object')for(const [k,id] of Object.entries(edits)){const xyz=k.split(',').map(Number);if(xyz.length===3)this._recordEdit(...xyz,id);}
  }
  _recordEdit(x,y,z,id){
    if(![x,y,z,id].every(Number.isInteger)||y<0||y>=WORLD_HEIGHT||!BLOCKS[id])return false;
    const cx=Math.floor(x/16),cz=Math.floor(z/16),key=keyOf(cx,cz);
    this.edits.set(`${x},${y},${z}`,id);
    if(!this.editsByChunk.has(key))this.editsByChunk.set(key,new Map());
    this.editsByChunk.get(key).set(indexOf(x-cx*16,y,z-cz*16),id);return true;
  }
  _chunk(cx,cz){
    const key=keyOf(cx,cz);
    let chunk=this.chunks.get(key);
    if(!chunk){
      const {data,heights}=this.terrain.fillChunk(cx,cz);
      const changes=this.editsByChunk.get(key);if(changes)for(const [i,id]of changes)data[i]=id;
      chunk={cx,cz,key,data,heights,group:null,faces:0};this.chunks.set(key,chunk);
    }
    return chunk;
  }
  getBlock(x,y,z){
    x=Math.floor(x);y=Math.floor(y);z=Math.floor(z);
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return B.AIR;
    if(y<0)return B.BEDROCK;if(y>=WORLD_HEIGHT)return B.AIR;
    const cx=Math.floor(x/16),cz=Math.floor(z/16);
    return this._chunk(cx,cz).data[indexOf(x-cx*16,y,z-cz*16)];
  }
  setBlock(x,y,z,id){
    x=Math.floor(x);y=Math.floor(y);z=Math.floor(z);
    if(![x,y,z,id].every(Number.isInteger)||y<0||y>=WORLD_HEIGHT||!BLOCKS[id])return false;
    const cx=Math.floor(x/16),cz=Math.floor(z/16),lx=x-cx*16,lz=z-cz*16;
    const chunk=this._chunk(cx,cz),index=indexOf(lx,y,lz);
    if(chunk.data[index]===id)return false;
    chunk.data[index]=id;this._recordEdit(x,y,z,id);this.dirty.add(chunk.key);
    // Ambient occlusion also samples diagonally across chunk edges.
    const xs=lx===0?[-1,0]:lx===15?[0,1]:[0],zs=lz===0?[-1,0]:lz===15?[0,1]:[0];
    for(const dx of xs)for(const dz of zs){const key=keyOf(cx+dx,cz+dz);if(this.chunks.get(key)?.group)this.dirty.add(key);}
    return true;
  }
  getHeight(x,z){return this.terrain.getHeight(x,z);}
  getBiome(x,z){return this.terrain.getBiome(x,z);}
  raycast(origin,direction,maxDistance=6){return voxelRaycast(this.getBlock.bind(this),origin,direction,maxDistance);}
  getEdits(){return Array.from(this.edits,([key,id])=>[...key.split(',').map(Number),id]);}
  ensureAround(px,pz,radius=1){
    const cx=Math.floor(px/16),cz=Math.floor(pz/16),list=[];
    for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++)list.push([cx+dx,cz+dz,dx*dx+dz*dz]);
    list.sort((a,b)=>a[2]-b[2]);for(const [x,z]of list){const chunk=this._chunk(x,z);if(!chunk.group||this.dirty.has(chunk.key))this._build(chunk);}
  }
  update(px,pz,budget=2){
    const cx=Math.floor(px/16),cz=Math.floor(pz/16),r=Math.max(1,Math.min(10,Math.floor(this.renderDistance)));
    if(cx!==this.lastCX||cz!==this.lastCZ||r!==this.lastDistance){
      this.lastCX=cx;this.lastCZ=cz;this.lastDistance=r;this.queue=[];
      for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){
        if(dx*dx+dz*dz>(r+.5)*(r+.5))continue;
        const key=keyOf(cx+dx,cz+dz),existing=this.chunks.get(key);
        if(!existing?.group)this.queue.push({cx:cx+dx,cz:cz+dz,d:dx*dx+dz*dz});
      }
      this.queue.sort((a,b)=>a.d-b.d);
      for(const [key,chunk]of this.chunks){
        if(Math.max(Math.abs(chunk.cx-cx),Math.abs(chunk.cz-cz))>r+2){this._disposeChunk(chunk);this.chunks.delete(key);this.dirty.delete(key);}
      }
    }
    let used=0;
    // Changes under the crosshair are always rebuilt before distant scenery.
    for(const key of this.dirty){
      if(used>=budget)break;
      const chunk=this.chunks.get(key);this.dirty.delete(key);
      if(chunk&&Math.max(Math.abs(chunk.cx-cx),Math.abs(chunk.cz-cz))<=r){this._build(chunk);used++;}
    }
    while(used<budget&&this.queue.length){
      const next=this.queue.shift(),chunk=this._chunk(next.cx,next.cz);
      if(!chunk.group){this._build(chunk);used++;}
    }
    return this.queue.length===0&&this.dirty.size===0;
  }
  _build(chunk){
    const solid=meshBuffer(),water=meshBuffer(),glow=meshBuffer(),ox=chunk.cx*16,oz=chunk.cz*16;
    const neighbors=new Map([[keyOf(0,0),chunk]]);
    const sample=(x,y,z)=>{
      if(y<0)return B.BEDROCK;if(y>=WORLD_HEIGHT)return B.AIR;
      if(x>=0&&x<16&&z>=0&&z<16)return chunk.data[indexOf(x,y,z)];
      const dx=Math.floor(x/16),dz=Math.floor(z/16),key=keyOf(dx,dz);
      let c=neighbors.get(key);if(!c){c=this._chunk(chunk.cx+dx,chunk.cz+dz);neighbors.set(key,c);}
      return c.data[indexOf(x-dx*16,y,z-dz*16)];
    };
    let faceCount=0;
    const append=(target,vertices,normal,uv,colors)=>{
      const start=target.p.length/3;
      for(let i=0;i<4;i++){target.p.push(...vertices[i]);target.n.push(...normal);target.c.push(colors[i],colors[i],colors[i]);}
      const[u0,v0,u1,v1]=uv;target.uv.push(u0,v0,u1,v0,u1,v1,u0,v1);
      // Alternate the diagonal for smoother ambient occlusion in concave corners.
      if(colors[0]+colors[2]>colors[1]+colors[3])target.i.push(start,start+1,start+3,start+1,start+2,start+3);
      else target.i.push(start,start+1,start+2,start,start+2,start+3);
      faceCount++;
    };
    for(let y=0;y<WORLD_HEIGHT;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++){
      const id=chunk.data[indexOf(x,y,z)];if(!id)continue;
      const block=BLOCKS[id],depth=Math.max(.38,1-Math.max(0,chunk.heights[x+z*16]-y-2)*.07);
      if(block.cross){
        const target=block.emissive?glow:solid,shade=block.emissive?1:depth*.92;
        append(target,[[x+.12,y,z+.12],[x+.88,y,z+.88],[x+.88,y+1,z+.88],[x+.12,y+1,z+.12]],[-.707,0,.707],this.atlas.uvFor(id,0),[shade,shade,shade,shade]);
        append(target,[[x+.88,y,z+.12],[x+.12,y,z+.88],[x+.12,y+1,z+.88],[x+.88,y+1,z+.12]],[-.707,0,-.707],this.atlas.uvFor(id,0),[shade,shade,shade,shade]);
        continue;
      }
      const liquid=id===B.WATER||id===B.ICE,target=liquid?water:block.emissive?glow:solid;
      for(let f=0;f<6;f++){
        const {n,v,shade,ao:corners}=FACES[f],neighbor=sample(x+n[0],y+n[1],z+n[2]);
        if(opaque(neighbor))continue;
        if(neighbor===id&&block.transparent)continue;
        if(id===B.WATER&&(neighbor===B.ICE||BLOCKS[neighbor]?.solid))continue;
        const colors=[],start=target.p.length/3;
        const lowerWater=id===B.WATER&&sample(x,y+1,z)!==B.WATER?.12:0;
        for(let corner=0;corner<4;corner++){
          const vertex=v[corner],[a,b,c]=corners[corner];
          const s1=opaque(sample(x+a[0],y+a[1],z+a[2]))?1:0,s2=opaque(sample(x+b[0],y+b[1],z+b[2]))?1:0,diag=opaque(sample(x+c[0],y+c[1],z+c[2]))?1:0;
          const ao=s1&&s2?3:s1+s2+diag;
          const color=block.emissive?1:shade*depth*(1-ao*.13);colors.push(color);
          target.c.push(color,color,color);target.n.push(n[0],n[1],n[2]);
          // The upper surface sits below the block grid, as visible water should.
          target.p.push(x+vertex[0],y+vertex[1]-(vertex[1]===1?lowerWater:0),z+vertex[2]);
        }
        const [u0,v0,u1,v1]=this.atlas.uvFor(id,f);target.uv.push(u0,v0,u1,v0,u1,v1,u0,v1);
        if(colors[0]+colors[2]>colors[1]+colors[3])target.i.push(start,start+1,start+3,start+1,start+2,start+3);
        else target.i.push(start,start+1,start+2,start,start+2,start+3);
        faceCount++;
      }
    }
    this._disposeChunk(chunk);
    chunk.group=new THREE.Group();chunk.group.position.set(ox,0,oz);chunk.group.name=`chunk:${chunk.cx},${chunk.cz}`;
    for(const [buffer,material,order]of [[solid,this.material,0],[glow,this.glowMaterial,0],[water,this.waterMaterial,1]]){
      const geometry=geometryFor(buffer);if(!geometry)continue;
      const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=false;mesh.receiveShadow=true;mesh.renderOrder=order;chunk.group.add(mesh);
    }
    chunk.faces=faceCount;this.totalFaces+=faceCount;this.scene.add(chunk.group);this.dirty.delete(chunk.key);
  }
  _disposeChunk(chunk){
    if(chunk.group){this.scene.remove(chunk.group);for(const mesh of chunk.group.children)mesh.geometry.dispose();chunk.group=null;this.totalFaces-=chunk.faces;chunk.faces=0;}
  }
  dispose(){
    for(const chunk of this.chunks.values())this._disposeChunk(chunk);
    this.chunks.clear();this.queue=[];this.dirty.clear();this.material.dispose();this.waterMaterial.dispose();this.glowMaterial.dispose();
  }
}
