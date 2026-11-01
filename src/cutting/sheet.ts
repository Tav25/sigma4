export interface SheetPart { id: string; w: number; h: number; }
export interface SheetStock { w: number; h: number; }
export interface SheetPlacement { sheetIndex: number; x: number; y: number; w: number; h: number; partId: string; }
export interface SheetPlan { placements: SheetPlacement[]; sheetsUsed: number; wastePercent: number; }

export function optimizeSheetCutting(parts: SheetPart[], stock: SheetStock, kerf = 3): SheetPlan {
  // simple shelf algorithm
  const sorted = [...parts].sort((a, b) => b.h - a.h);
  const placements: SheetPlacement[] = [];
  let sheets = 0;
  // current sheet shelves
  let curX = 0;
  let curY = 0;
  let shelfHeight = 0;
  let sheetArea = stock.w * stock.h;
  let usedArea = 0;

  const newSheet = () => {
    sheets += 1;
    curX = 0;
    curY = 0;
    shelfHeight = 0;
  };

  newSheet();
  for (const p of sorted) {
    if (curX + p.w + kerf > stock.w) {
      // new shelf
      curX = 0;
      curY += shelfHeight + kerf;
      shelfHeight = 0;
    }
    if (curY + p.h > stock.h) {
      // new sheet
      newSheet();
    }
    placements.push({ sheetIndex: sheets - 1, x: curX, y: curY, w: p.w, h: p.h, partId: p.id });
    usedArea += p.w * p.h;
    curX += p.w + kerf;
    shelfHeight = Math.max(shelfHeight, p.h);
  }

  const totalArea = sheets * sheetArea;
  const wastePercent = totalArea > 0 ? ((totalArea - usedArea) / totalArea) * 100 : 0;
  return { placements, sheetsUsed: sheets, wastePercent };
}
