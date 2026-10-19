import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Parts,type Scan} from '../screens/Parts';
import {addPart,counts,emptyInventory,type Inventory} from './inventory';
import {parsePartId} from './bricks';
vi.mock('./render',async original=>({...await original<typeof import('./render')>(),partIcon:()=> 'data:image/png;base64,AA=='}));
const noop=()=>{};
function mixed(n=20):Inventory{
 let inv=addPart(emptyInventory(),parsePartId('brick-1x2-red')!,n);
 inv=addPart(inv,parsePartId('plate-1x2-blue')!,3,undefined,.42,undefined,false);
 inv.others=[{description:'unidentified shape',color:'white',unknown:true,boxes:[]},{description:'special mold',color:'red',catalog:{num:'3004pr0001',name:'Printed brick',color:'red'},confirmed:true,boxes:[]}];
 return inv;
}
function render(inv:Inventory,scans:Scan[]=[]){
 return renderToStaticMarkup(createElement(Parts,{inv,scans,onCount:noop,onAddPart:noop,onPhoto:noop,onRetry:noop,onNext:noop,onRequest:noop,onBench:noop,onAnglePhoto:noop,onResolve:noop,onConfirmOutline:noop,onReviewType:noop,onReviewOther:noop}));
}
const button=(html:string,label:string)=>{const found=html.match(new RegExp(`<button([^>]*)>${label}`));expect(found,`Missing ${label} button`).not.toBeNull();return found![1];};
describe('building from usable pieces while optional review remains',()=>{
 it('enables discovery and a named request with unresolved and unsupported observations still present',()=>{
  const inv=mixed(),before=JSON.stringify(inv),html=render(inv);
  expect(button(html,'Build with available pieces')).not.toContain('disabled');
  expect(html).toContain('id="request-input"');
  expect(html).toContain('Review uncertain pieces');expect(html).toContain('Review or correct');
  expect(counts(inv)).toEqual({'brick-1x2-red':20});expect(JSON.stringify(inv)).toBe(before);
 });
 it('retains the 20-usable-piece minimum even when observations exceed it',()=>{
  const html=render(mixed(19));
  expect(button(html,'Build with available pieces')).toContain('disabled');expect(html).not.toContain('id="request-input"');
 });
 it('keeps discovery, named requests and the workbench unavailable while scanning',()=>{
  const scan:Scan={photo:1,status:'scanning',startedAt:Date.now(),phase:'survey',tiles:[],estimate:100};
  const html=render(mixed(),[scan]);
  expect(button(html,'Build with available pieces')).toContain('disabled');expect(button(html,'Build it yourself')).toContain('disabled');expect(html).not.toContain('id="request-input"');
 });
 it('allows a one-piece workbench while unrelated observations remain unresolved',()=>{
  const html=render(mixed(1));expect(button(html,'Build it yourself')).not.toContain('disabled');expect(button(html,'Build with available pieces')).toContain('disabled');
 });
});
