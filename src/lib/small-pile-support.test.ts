import {describe,expect,it} from 'vitest';
import {parsePartId,heightOf} from './bricks';
import {attachPart,definition,frame,connectionPairs} from './connections';
import {checkFeatures} from './identify';
import {outlineOptions,confirmOutlineObservation} from './specialty-review';
import {emptyInventory,counts,type OtherEntry} from './inventory';
import {partInfo,isMade} from './catalog';
const kind=(id:string)=>parsePartId(id)!;
describe('small-pile specialty parts',()=>{
 it('uses exact port coordinates for the extended side-stud variants',()=>{
  for(const [id,size,sideCount]of [['sidebrick-1x2-dark-azure',40,2],['sidebrick-1x4-dark-azure',80,4]] as const){
   const d=definition(kind(id));expect(d.boxes[0].max).toEqual([size,20,24]);expect(d.ports.filter(p=>p.id.startsWith('side:')).map(p=>p.point)).toEqual(Array.from({length:sideCount},(_,i)=>[10+i*20,0,14]));
   expect(d.ports.filter(p=>p.kind==='grip')).toHaveLength(sideCount);
  }
  const tall=definition(kind('sidebricktall-1x2-dark-blue'));expect(tall.boxes[0].max).toEqual([40,20,40]);expect(heightOf('sidebricktall')).toBe(5);
  expect(tall.ports.filter(p=>p.id.startsWith('side:')).map(p=>p.point)).toEqual([[10,0,10],[30,0,10],[10,0,30],[30,0,30]]);
  expect(definition(kind('sidebrickadjacent-1x1-dark-azure')).ports.filter(p=>p.id.startsWith('side:')).map(p=>p.normal)).toEqual([[0,-1,0],[1,0,0]]);
  expect(definition(kind('sidebrickall-1x1-dark-azure')).ports.filter(p=>p.id.startsWith('side:'))).toHaveLength(4);
 });
 it('attaches a real piece to every new side port without changing the parent',()=>{
  for(const id of ['sidebrick-1x2-dark-azure','sidebrick-1x4-dark-azure','sidebricktall-1x2-dark-blue','sidebrickadjacent-1x1-dark-azure','sidebrickall-1x1-dark-azure']){
   const parent={partId:id,x:4,y:4,z:4,rot:90},before={...parent};
   for(const port of definition(kind(id)).ports.filter(p=>p.id.startsWith('side:'))){const child=attachPart(parent,port.id,'plate-1x1-white','grip:0:0');expect(connectionPairs(frame(parent),frame(child))).toContainEqual([port.id,'grip:0:0']);}
   expect(parent).toEqual(before);
  }
 });
 it('gives the 2x2 jumper one center stud, four bottom grips and its real number',()=>{
  const k=kind('jumper-2x2-orange'),d=definition(k);expect(d.ports.filter(p=>p.kind==='stud').map(p=>p.point)).toEqual([[20,20,8]]);expect(d.ports.filter(p=>p.kind==='grip')).toHaveLength(4);expect(partInfo(k.partId)?.number).toBe('87580');expect(isMade(k.partId)).toBe(true);
 });
 it('requires direct feature evidence for open-stud rounded plates and jumpers',()=>{
  const f={outline:'capsule' as const,topShape:'flat' as const,studsOnTop:2,openStuds:true,heightPlates:1};expect(checkFeatures('roundendplate',1,2,f)).toEqual({type:'roundendplate',w:1,d:2});
  for(const wrong of [{...f,openStuds:false},{...f,heightPlates:3},{...f,outline:'rectangle' as const},{}])expect(checkFeatures('roundendplate',1,2,wrong)).toHaveProperty('other');
  const jumper={outline:'rectangle' as const,topShape:'flat' as const,studsOnTop:1,studLayout:'center' as const,heightPlates:1};expect(checkFeatures('jumper',2,2,jumper)).toEqual({type:'jumper',w:2,d:2});expect(checkFeatures('jumper',2,2,{...jumper,studsOnTop:4})).toHaveProperty('other');
  expect(checkFeatures('sidebrickall',1,1,{})).toHaveProperty('other');
 });
 it('never turns a four-side or adjacent-side observation into the one-side brick',()=>{
  const obs=(description:string):OtherEntry=>({description,color:'black',boxes:[{photo:1,box:[0,0,10,10]}]});
  for(const [text,id]of [['brick 1x1 with studs on four sides','sidebrickall-1x1-black'],['brick 1x1 with studs on two adjacent sides','sidebrickadjacent-1x1-black'],['brick 1x4 with four side studs','sidebrick-1x4-black'],['tall SNOT brick 1x2 with four side studs','sidebricktall-1x2-black']] as const){
   const o=obs(text),inv={...emptyInventory(),others:[o]};expect(outlineOptions(o).map(k=>k.partId)).toEqual([id]);const next=confirmOutlineObservation(inv,o,id);expect(counts(next)).toEqual({[id]:1});expect(confirmOutlineObservation(next,o,id)).toBe(next);
  }
  for(const text of ['brick 1x1 with studs on opposite sides','brick 1x1 with multiple side studs','brick 1x2 with unknown side studs'])expect(outlineOptions(obs(text))).toEqual([]);
 });
 it('keeps real purple inventory identities without remapping them to pink',()=>{expect(parsePartId('brick-2x2-dark-purple')?.color).toBe('dark-purple');expect(isMade('brick-2x2-dark-purple')).toBe(true);});
});
