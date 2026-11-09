function applyDistanceTransform(foregroundPixels: CostMatrix, oob = 255): CostMatrix {
  const dist = foregroundPixels;

  // Variables to represent the 3x3 neighborhood of a pixel.
  let UL, U, UR: number;
  let L, mid, R: number;
  let BL, B, BR: number;

  let x, y, value: number;

  for (y = 0; y < 50; ++y) {
    for (x = 0; x < 50; ++x) {
      if (foregroundPixels.get(x, y) !== 0) {
        UL = dist.get(x - 1, y - 1);
        U = dist.get(x, y - 1);
        UR = dist.get(x + 1, y - 1);
        L = dist.get(x - 1, y);
        if (y == 0) {
          UL = oob;
          U = oob;
          UR = oob;
        }
        if (x == 0) {
          UL = oob;
          L = oob;
        }
        if (x == 49) {
          UR = oob;
        }
        dist.set(x, y, Math.min(UL, U, UR, L, 254) + 1);
      }
    }
  }
  for (y = 49; y >= 0; --y) {
    for (x = 49; x >= 0; --x) {
      mid = dist.get(x, y);
      R = dist.get(x + 1, y);
      BL = dist.get(x - 1, y + 1);
      B = dist.get(x, y + 1);
      BR = dist.get(x + 1, y + 1);
      if (y == 49) {
        BL = oob;
        B = oob;
        BR = oob;
      }
      if (x == 49) {
        R = oob;
        BR = oob;
      }
      if (x == 0) {
        BL = oob;
      }
      value = Math.min(mid, R + 1, BL + 1, B + 1, BR + 1);
      dist.set(x, y, value);
    }
  }
  return dist;
}

// Compute a cost matrix for walkable pixels in a room
function walkablePixelsForRoom(roomName: string): CostMatrix {
  const costMatrix = new PathFinder.CostMatrix();
  const terrain = Game.map.getRoomTerrain(roomName);
  for (let y = 0; y < 50; ++y) {
    for (let x = 0; x < 50; ++x) {
      if (terrain.get(x, y) != TERRAIN_MASK_WALL) {
        costMatrix.set(x, y, 1);
      }
    }
  }
  return costMatrix;
}

export function distanceTransform(roomName: string): CostMatrix {
  return applyDistanceTransform(walkablePixelsForRoom(roomName));
}
