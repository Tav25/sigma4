import { describe, it, expect } from 'vitest';
import { defaultProject } from '../model/project';
import { generateFrame } from '../frame/generator';
import { validateFrame } from '../validation/engine';

describe('frame regression', () => {
  it('generates elements with valid geometry', () => {
    const p = defaultProject();
    const f = generateFrame(p);
    const { bad, report } = validateFrame(f.elements);
    report.slice(0, 20).forEach((r) => console.log('BAD', r));
    expect(f.elements.length).toBeGreaterThan(0);
    expect(bad).toBe(0);
  });

  it('stud length is 2565 for default wall', () => {
    const p = defaultProject();
    const f = generateFrame(p);
    const studs = f.elements.filter((e) => e.kind === 'stud' && e.role === 'regular-stud');
    expect(studs.length).toBeGreaterThan(0);
    studs.forEach((s) => expect(s.lengthMm).toBe(2565));
  });

  it('plates on expected levels', () => {
    const p = defaultProject();
    const f = generateFrame(p);
    const bottom = f.elements.filter((e) => e.kind === 'plate-bottom');
    const top = f.elements.filter((e) => e.kind === 'plate-top');
    expect(bottom.length).toBeGreaterThan(0);
    expect(top.length).toBeGreaterThan(0);
    bottom.forEach((b) => expect(b.position.y).toBeCloseTo(22.5, 0));
    top.forEach((t) => expect([2610 + 22.5, 2655 + 22.5]).toContain(t.position.y));
  });
});
