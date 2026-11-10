import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { B } from '../src/data.js';
import { createTerrain, indexOf, voxelRaycast, WORLD_HEIGHT, SEA_LEVEL } from '../src/terrain.js';
import { World } from '../src/world.js';

const headlessAtlas={texture:null,uvFor:()=>[0,0,1,1]};
const makeWorld=options=>new World(new THREE.Scene(),{atlas:headlessAtlas,...options});

test('same seed reproduces complete chunks, including trees and ores',()=>{
  const a=createTerrain('保存的中文种子'),b=createTerrain('保存的中文种子'),other=createTerrain('另一个种子');
  assert.deepEqual(a.fillChunk(-3,2).data,b.fillChunk(-3,2).data);
  assert.notDeepEqual(a.fillChunk(-3,2).data,other.fillChunk(-3,2).data);
  assert.equal(a.fillChunk(0,0).data.length,16*16*WORLD_HEIGHT);
});

test('spawn is above sea level and broad terrain includes six biomes',()=>{
  const terrain=createTerrain('方块世界'),biomes=new Set();
  assert.ok(terrain.getHeight(0,0)>SEA_LEVEL);
  for(let z=-1000;z<=1000;z+=50)for(let x=-1000;x<=1000;x+=50){
    const c=terrain.column(x,z);biomes.add(c.biome);
    assert.ok(c.height>=1&&c.height<WORLD_HEIGHT-8);
  }
  for(const biome of ['草原','森林','沙漠','雪山','海洋','沙滩'])assert.ok(biomes.has(biome),biome);
});

test('neighboring chunks preserve deterministic canopy across their seam',()=>{
  const t=createTerrain('边界上的森林');let tested=false;
  for(let gz=-30;gz<30&&!tested;gz++)for(let gx=-30;gx<30&&!tested;gx++){
    const tree=t.treeAt(gx,gz);if(!tree)continue;
    const lx=((tree.x%16)+16)%16;if(lx!==0&&lx!==15)continue;
    const x=tree.x+(lx===0?-1:1),z=tree.z,y=tree.y+tree.height-1;
    const cx=Math.floor(x/16),cz=Math.floor(z/16),data=t.fillChunk(cx,cz).data;
    assert.ok([B.LEAVES,B.BIRCH_LEAVES,B.LOG,B.BIRCH_LOG].includes(data[indexOf(x-cx*16,y,z-cz*16)]));tested=true;
  }
  assert.ok(tested,'seed must exercise a cross-chunk tree');
});

test('raycast gives correct entered face and adjacent placement cell',()=>{
  const map=new Map([['2,5,0',B.STONE],['-3,5,0',B.LOG],['0,7,0',B.DIRT]]);
  const get=(x,y,z)=>map.get(`${x},${y},${z}`)||B.AIR;
  const east=voxelRaycast(get,{x:.5,y:5.5,z:.5},{x:1,y:0,z:0},6);
  assert.equal(east.x,2);assert.equal(east.distance,1.5);assert.deepEqual(east.normal,{x:-1,y:0,z:0});assert.deepEqual(east.previous,{x:1,y:5,z:0});
  const west=voxelRaycast(get,{x:.5,y:5.5,z:.5},{x:-1,y:0,z:0},6);
  assert.equal(west.x,-3);assert.deepEqual(west.normal,{x:1,y:0,z:0});
  const up=voxelRaycast(get,{x:.5,y:5.5,z:.5},{x:0,y:2,z:0},6);
  assert.equal(up.y,7);assert.deepEqual(up.normal,{x:0,y:-1,z:0});
  assert.equal(voxelRaycast(get,{x:.5,y:5.5,z:.5},{x:1,y:0,z:0},1),null);
  assert.equal(voxelRaycast(get,{x:0,y:0,z:0},{x:0,y:0,z:0}),null);
});

test('water is traversed by selection ray and exact negative boundaries remain finite',()=>{
  const hit=voxelRaycast((x,y,z)=>x===0?B.WATER:x===-1?B.STONE:0,{x:0,y:1.5,z:.5},{x:-1,y:0,z:0},4);
  assert.equal(hit.x,-1);assert.equal(hit.distance,0);assert.deepEqual(hit.normal,{x:1,y:0,z:0});
});

test('edits round-trip across negative chunk boundaries and invalid save data is ignored',()=>{
  const world=makeWorld({seed:'save-test'});
  assert.equal(world.setBlock(-16,75,-1,B.GLASS),true);
  assert.equal(world.setBlock(-17,74,16,B.PLANKS),true);
  assert.equal(world.setBlock(0,-1,0,B.AIR),false);
  assert.equal(world.setBlock(0,WORLD_HEIGHT,0,B.STONE),false);
  assert.equal(world.setBlock(1,75,1,999),false);
  const restored=makeWorld({seed:'save-test',edits:[...world.getEdits(),[1,-8,0,3],[0,5,0,999]]});
  assert.equal(restored.getBlock(-16,75,-1),B.GLASS);
  assert.equal(restored.getBlock(-17,74,16),B.PLANKS);
  assert.deepEqual(restored.getEdits(),world.getEdits());
  world.dispose();restored.dispose();
});

test('chunk meshes have consistent normals, UVs, indices and release memory on travel',()=>{
  const world=makeWorld({seed:'mesh-test',renderDistance:1});world.ensureAround(0,0,0);
  const chunk=world.chunks.get('0,0');assert.ok(chunk.group.children.length>0);
  for(const mesh of chunk.group.children){
    const g=mesh.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv'),color=g.getAttribute('color'),indices=g.index.array;
    assert.equal(p.count,n.count);assert.equal(p.count,uv.count);assert.equal(p.count,color.count);assert.ok(indices.length%3===0);
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i],b=indices[i+1],c=indices[i+2];
      const ab=new THREE.Vector3().fromBufferAttribute(p,b).sub(new THREE.Vector3().fromBufferAttribute(p,a));
      const ac=new THREE.Vector3().fromBufferAttribute(p,c).sub(new THREE.Vector3().fromBufferAttribute(p,a));
      const normal=new THREE.Vector3().fromBufferAttribute(n,a);
      assert.ok(ab.cross(ac).dot(normal)>0,'triangle winding must face its normal');
    }
  }
  world.update(5000,5000,1);assert.equal(world.chunks.has('0,0'),false);
  world.dispose();assert.equal(world.chunks.size,0);assert.equal(world.scene.children.length,0);
});
