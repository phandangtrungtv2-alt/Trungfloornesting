import { RoomGeometry, Ring } from '../types';
import { getRingBoundingBox, getPolygonArea } from '../services/geometryMath';

export const MOCK_ROOM_BOUNDARY: Ring = [
  [0, 0],
  [9500, 0],
  [9500, 4500],
  [5000, 4500],
  [5000, 8000],
  [0, 8000],
];

export const MOCK_COLUMN_HOLE_1: Ring = [
  [1500, 2000],
  [2100, 2000],
  [2100, 2600],
  [1500, 2600],
];

export const MOCK_COLUMN_HOLE_2: Ring = [
  [6500, 1200],
  [7100, 1200],
  [7100, 1800],
  [6500, 1800],
];

export const MOCK_COLUMN_HOLE_3: Ring = [
  [1200, 5000],
  [2000, 5000],
  [2000, 5800],
  [1200, 5800],
];

export const MOCK_ROOM_GEOMETRY: RoomGeometry = {
  id: 'ROOM-1',
  name: 'Phòng 1 - Chữ L (58.9 m²)',
  boundary: MOCK_ROOM_BOUNDARY,
  holes: [MOCK_COLUMN_HOLE_1, MOCK_COLUMN_HOLE_2, MOCK_COLUMN_HOLE_3],
  bbox: getRingBoundingBox(MOCK_ROOM_BOUNDARY),
  areaMm2: getPolygonArea([
    MOCK_ROOM_BOUNDARY,
    MOCK_COLUMN_HOLE_1,
    MOCK_COLUMN_HOLE_2,
    MOCK_COLUMN_HOLE_3,
  ]),
};

export const MOCK_ROOM_2_BOUNDARY: Ring = [
  [11000, 500],
  [16000, 500],
  [16000, 6000],
  [11000, 6000],
];

export const MOCK_ROOM_2_HOLE: Ring = [
  [13000, 2500],
  [13600, 2500],
  [13600, 3100],
  [13000, 3100],
];

export const MOCK_ROOM_2_GEOMETRY: RoomGeometry = {
  id: 'ROOM-2',
  name: 'Phòng 2 - Hình chữ nhật (27.1 m²)',
  boundary: MOCK_ROOM_2_BOUNDARY,
  holes: [MOCK_ROOM_2_HOLE],
  bbox: getRingBoundingBox(MOCK_ROOM_2_BOUNDARY),
  areaMm2: getPolygonArea([MOCK_ROOM_2_BOUNDARY, MOCK_ROOM_2_HOLE]),
};

export const MOCK_ROOMS: RoomGeometry[] = [MOCK_ROOM_GEOMETRY, MOCK_ROOM_2_GEOMETRY];

export const MOCK_DXF_CONTENT = `  0
SECTION
  2
HEADER
  9
$INSUNITS
 70
     4
  0
ENDSEC
  0
SECTION
  2
TABLES
  0
TABLE
  2
LAYER
 70
     2
  0
LAYER
  2
ROOM_BOUNDARY
 70
     0
 62
     7
  0
LAYER
  2
OBSTACLES
 70
     0
 62
     1
  0
ENDTAB
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LWPOLYLINE
  8
ROOM_BOUNDARY
 90
     6
 70
     1
 10
0.0
 20
0.0
 10
9500.0
 20
0.0
 10
9500.0
 20
4500.0
 10
5000.0
 20
4500.0
 10
5000.0
 20
8000.0
 10
0.0
 20
8000.0
  0
LWPOLYLINE
  8
ROOM_BOUNDARY
 90
     4
 70
     1
 10
11000.0
 20
500.0
 10
16000.0
 20
500.0
 10
16000.0
 20
6000.0
 10
11000.0
 20
6000.0
  0
LWPOLYLINE
  8
OBSTACLES
 90
     4
 70
     1
 10
1500.0
 20
2000.0
 10
2100.0
 20
2000.0
 10
2100.0
 20
2600.0
 10
1500.0
 20
2600.0
  0
LWPOLYLINE
  8
OBSTACLES
 90
     4
 70
     1
 10
6500.0
 20
1200.0
 10
7100.0
 20
1200.0
 10
7100.0
 20
1800.0
 10
6500.0
 20
1800.0
  0
LWPOLYLINE
  8
OBSTACLES
 90
     4
 70
     1
 10
1200.0
 20
5000.0
 10
2000.0
 20
5000.0
 10
2000.0
 20
5800.0
 10
1200.0
 20
5800.0
  0
LWPOLYLINE
  8
OBSTACLES
 90
     4
 70
     1
 10
13000.0
 20
2500.0
 10
13600.0
 20
2500.0
 10
13600.0
 20
3100.0
 10
13000.0
 20
3100.0
  0
ENDSEC
  0
EOF
`;
