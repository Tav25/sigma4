export interface StructuralInput {
  span: number; // mm
  loadPerArea: number; // N/m2? simplified
  width: number; // mm (tributary width)
  section: { w: number; h: number }; // mm
  E: number; // MPa
  strength: number; // MPa bending
}

export interface StructuralResult {
  status: 'passed' | 'failed' | 'insufficient';
  message: string;
  maxMoment: number; // Nmm
  capacity: number; // Nmm
}

export function checkRafter(input: StructuralInput): StructuralResult {
  if (!input.span || !input.loadPerArea) {
    return { status: 'insufficient', message: 'Недостаточно данных', maxMoment: 0, capacity: 0 };
  }
  const q = (input.loadPerArea * input.width) / 1000; // N/mm? approx
  const M = (q * input.span * input.span) / 8; // Nmm
  const W = (input.section.w * input.section.h * input.section.h) / 6; // mm3
  const capacity = input.strength * W; // Nmm
  const status = capacity >= M ? 'passed' : 'failed';
  return { status, message: status === 'passed' ? 'Проверка пройдена' : 'Проверка не пройдена', maxMoment: M, capacity };
}
