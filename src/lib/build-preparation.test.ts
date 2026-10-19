import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Build} from './bricks';
import {PartsList} from '../components/PartsList';
import {PieceEditor} from '../components/PieceEditor';
import {Instructions} from '../screens/Instructions';
import {parsePartId} from './bricks';
vi.mock('./render',async original=>({...await original<typeof import('./render')>(),partIcon:()=> 'data:image/png;base64,AA=='}));
const build:Build={name:'Test',description:'',steps:[{caption:'Base',parts:[{partId:'plate-1x2-red',x:0,y:0,z:0,rot:0}]},{caption:'Top',parts:[{partId:'plate-1x2-red',x:0,y:0,z:1,rot:0}]}],engine:'connections-v2'};
const noop=()=>{};
describe('review and build preparation',()=>{
 it('lists every required copy even when the bucket already covers everything',()=>{
  const html=renderToStaticMarkup(createElement(PartsList,{build,bucket:{'plate-1x2-red':20},preparation:true,onClose:noop,onStart:noop,onMissing:noop}));
  expect(html).toContain('Gather all 2 pieces in 1 types');expect(html).toContain('Set aside 2 Plate 1 × 2 in red');expect(html).toContain('Some pieces are missing');expect(html).toContain('Start instructions');expect(html).not.toContain('already yours');
 });
 it('opens instructions behind the mandatory preparation sheet',()=>{
  const html=renderToStaticMarkup(createElement(Instructions,{build,bucketTotal:20,model:'test',onBack:noop}));
  expect(html).toContain('Before you build');expect(html).toContain('Gather all 2 pieces');expect(html).toContain('Parts checklist');
 });
 it('does not confirm an unsupported current shape as buildable stock',()=>{
  const kind=parsePartId('plate-3x8-dark-gray')!;
  const html=renderToStaticMarkup(createElement(PieceEditor,{current:{kind,description:kind.partId,color:kind.color},onApply:noop,onClose:noop}));
  expect(html).toMatch(/disabled=""[^>]*>Confirm this piece/);
 });
 it('allows confirmation of the same scanner guess and offers a path to the full catalog',()=>{
  const kind=parsePartId('brick-1x2-red')!;
  const html=renderToStaticMarkup(createElement(PieceEditor,{current:{kind,description:kind.partId,color:'red'},onApply:noop,onClose:noop}));
  expect(html).toContain('Confirm this piece');expect(html).toContain('Compare likely matches');expect(html).toContain('Matching catalog pieces');expect(html).toContain('None of these? Search all pieces');expect(html).toContain('Observed color');expect(html).toContain('Leave unconfirmed');expect(html).toContain('Not a part');expect(html).not.toMatch(/disabled=""[^>]*>Confirm this piece/);
 });
});
