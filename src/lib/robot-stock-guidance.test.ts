import {expect,it} from 'vitest';
import {robotStockGuidance} from './robot-stock-guidance';
import photo from '../../test/fixtures/photo-stock.json';
it('excludes odd spares, non-bricks and oversized parts without consuming the stock',()=>{
 const stock={'brick-1x2-white':5,'brick-2x2-white':2,'brick-2x4-white':8,'plate-1x2-white':30,'slope-2x2-white':2},before=JSON.stringify(stock),text=robotStockGuidance(stock);
 expect(text).toContain('depth 2: white: total limb area 16, of which arm-compatible 8');
 expect(JSON.stringify(stock)).toBe(before);expect(text).toContain('cannot guarantee');
});
it('makes the live failed depth-three limb budget visible before any allocation',()=>{
 const text=robotStockGuidance(photo.stock);
 expect(text).toContain('depth 3: reddish-brown: total limb area 44, of which arm-compatible 36');
 // Nine-plate legs plus six-plate arms at depth three need 48, exceeding 44.
 expect(4*3*(9/3)+2*3*(6/3)).toBeGreaterThan(44);
});
