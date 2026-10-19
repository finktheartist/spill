import {describe,it,expect} from 'vitest';
import {COLORS,parsePartId} from './bricks';
import {initialPieceFilters,recolorPieceChoice,pieceChoiceResolution,pieceChoiceCatalog,type PiecePickerChoice} from './piece-picker-choice';
import {confirmedCatalogKind} from './inventory';
import rebrickable from '../data/rebrickable.json';

describe('manual picker color and identity',()=>{
 it('initializes only the observed color, for every selectable color',()=>{
  expect(Object.keys(COLORS)).toHaveLength(33);
  for(const color of Object.keys(COLORS))expect(initialPieceFilters(color)).toEqual({color:[color]});
  for(const color of ['unidentified','','toString','__proto__'])expect(initialPieceFilters(color)).toEqual({});
 });
 it('recolors a selected exact catalog mold without changing its identity',()=>{
  const choice={catalog:{num:'3001',name:'Brick 2 x 4',color:'red'}};
  const changed=recolorPieceChoice(choice,'blue');
  expect(changed).toEqual({catalog:{...choice.catalog,color:'blue'}});
  expect(pieceChoiceResolution(changed,'blue')).toEqual({kind:parsePartId('brick-2x4-blue')});
  expect(choice.catalog.color).toBe('red');
 });
 it('recolors a native mold directly without using its display-number alias',()=>{
  const choice={kind:parsePartId('tile-1x1-red')!};
  expect(pieceChoiceCatalog(choice)?.num).toBe('3070b');
  const changed=recolorPieceChoice(choice,'white');
  expect(changed).toEqual({kind:parsePartId('tile-1x1-white')});
 });
 it('keeps an unmanufactured color as catalog-only under the exact crosswalk mold',()=>{
  const entries=Object.entries(rebrickable.shapes).filter(([shape,v])=>shape.startsWith('tile-')&&v.colors.length>0&&v.colors.length<33);
  const [shape,value]=entries[0];
  const missing=Object.keys(COLORS).find(c=>!value.colors.includes(c))!;
  const original={kind:parsePartId(`${shape}-${value.colors[0]}`)!};
  const changed=recolorPieceChoice(original,missing);
  expect(changed).toEqual({catalog:{num:value.rebrickable,name:expect.any(String),color:missing}});
  const resolution=pieceChoiceResolution(changed,missing)!;
  expect(resolution).toHaveProperty('catalog.num',value.rebrickable);
  if(!('name'in resolution))throw Error('Expected catalog-only resolution');
  expect(confirmedCatalogKind({description:resolution.name,color:missing,catalog:resolution.catalog,boxes:[],confirmed:true})).toBeNull();
 });
 it('records unsupported molds in the selected color without inventing geometry',()=>{
  const changed=recolorPieceChoice({catalog:{num:'not-supported',name:'Special piece',color:'red'}},'azure');
  expect(pieceChoiceResolution(changed,'azure')).toEqual({name:'Special piece · not-supported',catalog:{num:'not-supported',name:'Special piece',color:'azure'}});
 });
 it('blocks restored color conflicts and unknown colors until explicitly corrected',()=>{
  const choices:PiecePickerChoice[]=[{kind:parsePartId('brick-2x4-red')!},{catalog:{num:'3001',name:'Brick',color:'red'}}];
  for(const choice of choices){
   expect(pieceChoiceResolution(choice,'white')).toBeNull();
   expect(pieceChoiceResolution(choice,'')).toBeNull();
   expect(pieceChoiceResolution(recolorPieceChoice(choice,'white'),'white')).not.toBeNull();
  }
  expect(recolorPieceChoice(null,'red')).toBeNull();
 });
});
