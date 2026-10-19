import type {PopularMold} from './popular-mold-types';
import {BULK_FLAT_MOLDS} from './bulk-flat-molds';
import {BULK_PROFILE_MOLDS} from './bulk-profile-molds';
import {BULK_STRUCTURAL_MOLDS} from './bulk-structural-molds';

/** Two hundred distinct exact molds, in addition to the earlier qualified
 * catalog. Colors and decorated versions never create additional identities. */
export const BULK_MOLDS:readonly PopularMold[]=Object.freeze([
 ...BULK_FLAT_MOLDS,...BULK_PROFILE_MOLDS,...BULK_STRUCTURAL_MOLDS,
]);
