// The box and its chapters, in reading order.
import volume from './volume.js';
import triangulate from './triangulate.js';
import solve from './solve.js';
import face from './face.js';
import methods from './methods.js';
import onset from './onset.js';

export const BOX = { slug: 'mocapclear', title: 'MocapClear' };
export const CHAPTERS = [volume, triangulate, solve, face, methods, onset];
