export interface CutPiece { id: string; length: number; }
export interface StockBoard { length: number; }
export interface CutPlanBoard { stockLength: number; pieces: number[]; waste: number; }
export interface CutPlan { boards: CutPlanBoard[]; totalWaste: number; wastePercent: number; }

export function optimizeLumberCuts(
  pieces: number[],
  stockLengths: number[],
  kerf = 3,
  endTrim = 0,
): CutPlan {
  // sort pieces desc
  const sorted = [...pieces].sort((a, b) => b - a);
  const boards: CutPlanBoard[] = [];
  const availableStocks = [...stockLengths].sort((a, b) => a - b);

  const findStock = (minLen: number): number => {
    for (const s of availableStocks) if (s >= minLen) return s;
    return availableStocks[availableStocks.length - 1];
  };

  for (const piece of sorted) {
    // find best-fit board with enough remaining
    let bestIdx = -1;
    let bestRemain = Infinity;
    for (let i = 0; i < boards.length; i++) {
      const b = boards[i];
      const used = b.pieces.reduce((s, p) => s + p, 0) + (b.pieces.length > 0 ? kerf * (b.pieces.length) : 0) + endTrim * 2;
      const remain = b.stockLength - used;
      const need = piece + (b.pieces.length > 0 ? kerf : 0);
      if (remain >= need && remain - need < bestRemain) {
        bestRemain = remain - need;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      boards[bestIdx].pieces.push(piece);
    } else {
      // new board
      const stock = findStock(piece + endTrim * 2 + kerf);
      boards.push({ stockLength: stock, pieces: [piece], waste: 0 });
    }
  }

  // compute waste
  let totalStock = 0;
  let totalPieces = 0;
  for (const b of boards) {
    const used = b.pieces.reduce((s, p) => s + p, 0) + kerf * Math.max(0, b.pieces.length - 1) + endTrim * 2;
    b.waste = b.stockLength - used;
    totalStock += b.stockLength;
    totalPieces += b.pieces.reduce((s, p) => s + p, 0);
  }
  const totalWaste = totalStock - totalPieces - boards.length * (endTrim * 2) - kerf * boards.reduce((s, b) => s + Math.max(0, b.pieces.length - 1), 0);
  const wastePercent = totalStock > 0 ? (totalWaste / totalStock) * 100 : 0;
  return { boards, totalWaste, wastePercent };
}
