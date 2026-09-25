/** An orthogonal four-arm corridor like the approved layout sketch. */
const outline = [[0,0], [32000,0], [32000,30000], [30000,30000],
  [30000,14000], [20000,14000], [20000,2000], [0,2000]];
const courtyard = [[22000,2000], [30000,2000], [30000,12000], [22000,12000]];
const polyline = (layer: string, points: number[][]) =>
  `0\nLWPOLYLINE\n8\n${layer}\n90\n${points.length}\n70\n1\n` +
  points.map(([x,y]) => `10\n${x}\n20\n${y}\n`).join('');
export const CORRIDOR_DXF_CONTENT = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n` +
  `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n2\n` +
  `0\nLAYER\n2\nCORRIDOR\n70\n0\n62\n7\n` +
  `0\nLAYER\n2\nCOURTYARD\n70\n0\n62\n1\n0\nENDTAB\n0\nENDSEC\n` +
  `0\nSECTION\n2\nENTITIES\n${polyline('CORRIDOR',outline)}${polyline('COURTYARD',courtyard)}` +
  `0\nENDSEC\n0\nEOF\n`;
