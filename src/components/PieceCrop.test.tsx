import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {PieceThumbnail} from './PieceCrop';
import {ConfidenceReview} from './ConfidenceReview';
import {addPart,emptyInventory,type Box} from '../lib/inventory';
import {parsePartId} from '../lib/bricks';
import {pieceReviewRows} from '../lib/piece-review';

vi.mock('../lib/render',()=>({partIcon:()=>'/catalog-illustration.png'}));
const photo={id:5,url:'data:image/png;base64,iVBORw0KGgo='},box:Box=[100,200,300,400],kind=parsePartId('brick-1x2-red')!;
const thumbnail=(props:Parameters<typeof PieceThumbnail>[0])=>renderToStaticMarkup(createElement(PieceThumbnail,props));

it('uses the actual observation crop even when a native catalog drawing exists',()=>{
 const html=thumbnail({partId:kind.partId,photo,box});
 expect(html).toContain('piece-photo-thumb');expect(html).toContain('Your photo');expect(html).toContain('<canvas');
 expect(html).not.toContain('/catalog-illustration.png');
});
it.each([.2,.7,.95])('keeps source evidence visible at confidence %s, with a separate proposed catalog match',confidence=>{
 const inv={...addPart(emptyInventory(),kind,1,{photo:photo.id,box},confidence),photos:[photo]};
 const html=renderToStaticMarkup(createElement(ConfidenceReview,{rows:pieceReviewRows(inv),photos:inv.photos,onReview:()=>{},onReviewAll:()=>{}}));
 expect(html).toContain('Your photo');expect(html).toContain('<canvas');expect(html).toContain('Proposed match');expect(html).toContain('Catalog image');
 expect(html).toContain('Review or correct');
});
it('shows source evidence for unknown and exact special-part identities',()=>{
 for(const number of [undefined,'4070']){
  const html=thumbnail({number,photo,box});expect(html).toContain('Your photo');expect(html).toContain('<canvas');expect(html).not.toContain('No photo');
 }
});
it('labels a catalog illustration honestly when there is no linked source photo or outline',()=>{
 for(const props of [{partId:kind.partId},{partId:kind.partId,photo},{partId:kind.partId,box}]){
  const html=thumbnail(props);expect(html).toContain('Catalog image');expect(html).not.toContain('<canvas');expect(html).not.toContain('Your photo');
 }
 expect(thumbnail({number:'4070'})).toContain('No photo');
});
it('does not borrow another photos image for a dangling observation reference',()=>{
 const inv=addPart(emptyInventory(),kind,1,{photo:photo.id,box},.2);
 const html=renderToStaticMarkup(createElement(ConfidenceReview,{rows:pieceReviewRows(inv),photos:[{...photo,id:6}],onReview:()=>{},onReviewAll:()=>{}}));
 expect(html).not.toContain('<canvas');expect(html).toContain('Original photo unavailable');
});
it('keeps count-only groups explicit instead of inventing individual photo crops',()=>{
 const inv=addPart(emptyInventory(),kind,3,undefined,.2,undefined,false);
 const html=renderToStaticMarkup(createElement(ConfidenceReview,{rows:pieceReviewRows(inv),photos:[photo],onReview:()=>{},onReviewAll:()=>{}}));
 expect(html).not.toContain('<canvas');expect(html).toContain('Catalog image');expect(html).toContain('Shared reading for this group');
});
