import {describe,it,expect} from 'vitest';
import {constructionIssues} from './construction';
import {connectionPairs,frame} from './connections';
import {popularMold} from './popular-molds';
import {BULK_PROFILE_MOLDS} from './bulk-profile-molds';
import type {Build,Placed} from './bricks';

const curve='mold93606-2x4-azure';
const build=(parts:Placed[]):Build=>({engine:'connections-v2',name:'93606 ordinary mounting',description:'Geometry fixture',steps:parts.map(p=>({caption:'Attach.',parts:[p]}))});
const issues=(ps:Placed[])=>constructionIssues(build(ps),ps.reduce<Record<string,number>>((a,p)=>(a[p.partId]=(a[p.partId]??0)+1,a),{}),24);
describe('93606 ordinary underside attachment',()=>{
 it.each([0,90,180,270])('mounts on a standard 2x4 plate at yaw %i with four front contacts',rot=>{
  const base:Placed={partId:'plate-2x4-black',x:2,y:2,z:0,rot:(rot+90)%360};
  const top:Placed={partId:curve,x:2,y:2,z:1,rot};
  expect(connectionPairs(frame(base),frame(top))).toHaveLength(4);
  expect(issues([base,top])).toEqual([]);
 });
 it('preserves clearance under the raised rear row without inventing a rear contact',()=>{
  const base:Placed={partId:'plate-2x4-black',x:2,y:2,z:0,rot:90};
  const rear:Placed={partId:'plate-1x2-dark-azure',x:2,y:5,z:1,rot:0};
  const top:Placed={partId:curve,x:2,y:2,z:1,rot:0};
  expect(connectionPairs(frame(rear),frame(top))).toHaveLength(0);
  expect(issues([base,rear,top])).toEqual([]);
 });
 it('still rejects body collisions and a floating curve',()=>{
  const base:Placed={partId:'plate-2x4-black',x:2,y:2,z:0,rot:90};
  expect(issues([base,{partId:curve,x:2,y:2,z:0,rot:0}]).length).toBeGreaterThan(0);
  expect(issues([base,{partId:curve,x:2,y:2,z:1.5,rot:0}]).length).toBeGreaterThan(0);
 });
 it('retains exact rendering, raised ports and the untouched raw catalog entry',()=>{
  const raw=BULK_PROFILE_MOLDS.find(m=>m.num==='93606')!;
  const active=popularMold({type:'mold93606',w:2,d:4})!;
  expect(active.renderHulls).toBe(raw.renderHulls);
  expect(active.sources).toBe(raw.sources);
  expect(active.ports.slice(0,raw.ports.length)).toEqual(raw.ports);
  expect(raw.ports).toHaveLength(5);
  expect(active.ports).toHaveLength(9);
 });
});
