import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PieceEditor} from './PieceEditor';
import {parsePartId} from '../lib/bricks';
vi.mock('../lib/render',async original=>({...await original<typeof import('../lib/render')>(),partIcon:()=> 'data:image/png;base64,AA=='}));
const noop=()=>{};
const render=(current:Parameters<typeof PieceEditor>[0]['current'])=>renderToStaticMarkup(createElement(PieceEditor,{current,onApply:noop,onClose:noop}));
describe('tag-driven piece confirmation',()=>{
 it('keeps native feature filters unset while preserving the observed color and existing choice',()=>{
  const html=render({kind:parsePartId('headlight-1x1-red')!,description:'Headlight',color:'red'});
  for(const value of ['Observed color','Headlight','value="red" selected=""'])expect(html).toContain(value);
  expect(html).not.toContain('Tags start from the current match');expect(html).not.toContain('Remove Size');
  expect(html).toContain('Confirm this piece');expect(html).not.toMatch(/disabled=""[^>]*>Confirm this piece/);
 });
 it('does not derive features from a saved catalog identity',()=>{
  const html=render({description:'Saved exact number',color:'azure',catalog:{num:'92593',name:'Exact 92593',color:'azure'}});
  expect(html).toContain('value="azure" selected=""');expect(html).not.toContain('1 × 4');expect(html).not.toContain('End studs');
 });
 it('cannot confirm a restored catalog identity whose color differs from the displayed observation tags',()=>{
  const html=render({description:'Mixed old color record',color:'white',catalog:{num:'4070',name:'Brick Special 1 x 1 with Headlight',color:'red'}});
  expect(html).toContain('different color');expect(html).toMatch(/disabled=""[^>]*>Use selected piece/);
 });
 it('keeps an unknown color unselected instead of inventing a light-gray identity',()=>{
  const html=render({description:'Unknown physical piece',unknown:true,color:'unidentified'});
  expect(html).toMatch(/disabled=""[^>]*>Use selected piece/);expect(html).not.toContain('<b>Light gray</b>');expect(html).toContain('Not sure');
 });
 it('opens a compact comparison with full catalog search available on demand',()=>{
  const html=render({kind:parsePartId('plate-2x4-white')!,description:'Plate',color:'white'});
  expect(html).toContain('Matching catalog pieces');expect(html).toContain('Compare likely matches');expect(html).toContain('None of these? Search all pieces');
  expect(html).not.toContain('Matching piece pages');
 });
 it('does not turn recorded AI guesses into a preselected confirmed identity',()=>{
  const html=render({description:'Uncertain curved piece',color:'white',unknown:true,reviewEvidence:{size:'1x2',features:{topShape:'curved',heightPlates:1},tags:{family:['brick'],connections:['clip']}}});
  expect(html).not.toContain('Selected:');expect(html).toMatch(/disabled=""[^>]*>Use selected piece/);
 });
 it('does not revive stale scan guesses when reopening a human-confirmed correction',()=>{
  const html=render({description:'Corrected plate',color:'white',kind:parsePartId('plate-1x2-white')!,confirmed:true,reviewEvidence:{tags:{family:['brick'],size:['2x4'],profile:['curved']}}});
  expect(html).not.toContain('AI guess ·');expect(html).not.toContain('Remove size:');expect(html).toContain('Confirm this piece');
 });
});
