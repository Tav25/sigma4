import { useState } from 'react';
import { useProject } from '../store/useProject';
import { Viewport } from './Viewport';
import { ErrorBoundary } from './ErrorBoundary';
import { aggregateLumber } from '../quantity/lumber';
import { optimizeLumberCuts } from '../cutting/lumber';
import { netWallArea } from '../geometry/area';
import { validateProject, validateFrame } from '../validation/engine';
import { generatePlanSvg, generateFacadeSvg, downloadText } from '../drawing/svg';
import { generatePlanDxf } from '../drawing/dxf';
import { APP_VERSION, APP_NAME } from '../core/version';
import { checkRafter } from '../engineering/structural';

const GROUP_LABELS: Record<string, string> = {
  'plate-top': 'Верхняя обвязка',
  stud: 'Стеновые стойки',
  header: 'Перемычки проёмов',
  sill: 'Подоконники',
  rafter: 'Стропила',
  ridge: 'Конёк',
  tie: 'Затяжки',
};

const VIEW_MODES = ['iso', 'front', 'side', 'top'] as const;

export function App() {
  const project = useProject((s) => s.project);
  const frame = useProject((s) => s.frame);
  const setLength = useProject((s) => s.setLength);
  const setWidth = useProject((s) => s.setWidth);
  const setWallHeight = useProject((s) => s.setWallHeight);
  const addOpening = useProject((s) => s.addOpening);
  const editOpening = useProject((s) => s.editOpening);
  const removeOpening = useProject((s) => s.removeOpening);
  const save = useProject((s) => s.save);
  const load = useProject((s) => s.load);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  const debug = useProject((s) => s.debug);
  const setDebug = useProject((s) => s.setDebug);

  const [tab, setTab] = useState<'spec' | 'info' | 'calc' | 'cut'>('spec');
  const [doorX, setDoorX] = useState(1000);
  const [winX, setWinX] = useState(2500);

  const lines = aggregateLumber(frame.elements);
  const issues = validateProject(project);
  const frameReport = validateFrame(frame.elements);

  const handleMaterialChange = (patch: Partial<{ width: number; height: number; price: number }>) => {
    const p = project;
    const mats = p.materials.lumber.map((m) => (m.id === p.building.lumberMaterialId ? { ...m, ...patch } : m));
    const np = { ...p, materials: { ...p.materials, lumber: mats } };
    useProject.getState().setProject(np);
  };

  const handleSave = () => {
    const json = save();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => load(String(reader.result));
    reader.readAsText(file);
  };

  const handleExportCsv = () => {
    const rows = ['kind,section,length,count,totalLength,volume'];
    for (const l of lines) {
      rows.push(`${l.kind},${l.section},${l.length},${l.count},${l.totalLength},${l.volume}`);
    }
    downloadText('materials.csv', rows.join('\n'), 'text/csv');
  };

  const handleExportPdf = () => {
    const svg = generatePlanSvg(project);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><body>${svg}<script>window.print();</script></body></html>`);
    w.document.close();
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', fontFamily: 'sans-serif' }}>
      <div style={{
        position: 'absolute', top: 8, right: 12, zIndex: 50,
        padding: '4px 10px', borderRadius: 12, background: '#8B5A2B', color: '#fff',
        fontSize: 12, border: '1px solid rgba(255,255,255,0.5)',
      }}>
        Версия {APP_VERSION} — {APP_NAME}
      </div>
      <aside style={{ width: 300, padding: 12, borderRight: '1px solid #ccc', overflow: 'auto', marginTop: 28 }}>
        <h3>Параметры</h3>
        <label>Длина (мм)</label>
        <input type="number" value={project.building.length} onChange={(e) => setLength(Number(e.target.value))} />
        <br />
        <label>Ширина (мм)</label>
        <input type="number" value={project.building.width} onChange={(e) => setWidth(Number(e.target.value))} />
        <br />
        <label>Высота стен (мм)</label>
        <input type="number" value={project.building.wallHeight} onChange={(e) => setWallHeight(Number(e.target.value))} />
        <br />
        <label>Шаг стоек (мм)</label>
        <input type="number" value={project.building.studSpacing} onChange={(e) => useProject.getState().updateBuilding({ studSpacing: Number(e.target.value) })} />
        <br />
        <label>Тип крыши</label>
        <select value={project.building.roof.type} onChange={(e) => useProject.getState().updateBuilding({ roof: { ...project.building.roof, type: e.target.value as 'shed' | 'gable' } })}>
          <option value="gable">Двускатная</option>
          <option value="shed">Односкатная</option>
        </select>
        <input type="number" value={project.building.roof.pitchDeg} onChange={(e) => useProject.getState().updateBuilding({ roof: { ...project.building.roof, pitchDeg: Number(e.target.value) } })} />
        <h4>Стены (высота)</h4>
        {project.building.walls.map((w, i) => (
          <div key={w.id} style={{ fontSize: 12 }}>
            Стена {i + 1}
            <input type="number" value={w.height} onChange={(e) => useProject.getState().updateBuilding({ walls: project.building.walls.map((ww) => ww.id === w.id ? { ...ww, height: Number(e.target.value) } : ww) })} />
          </div>
        ))}
        <div>
          <label>X двери</label>
          <input type="number" value={doorX} onChange={(e) => setDoorX(Number(e.target.value))} />
          <button onClick={() => addOpening('door', project.building.walls[0].id, doorX, 900, 2100, 0)}>+ Дверь</button>
        </div>
        <div>
          <label>X окна</label>
          <input type="number" value={winX} onChange={(e) => setWinX(Number(e.target.value))} />
          <button onClick={() => addOpening('window', project.building.walls[0].id, winX, 1200, 1200, 900)}>+ Окно</button>
        </div>
        <h4>Свесы крыши</h4>
        <label>Передний</label>
        <input type="number" value={project.building.roof.overhang.front} onChange={(e) => useProject.getState().updateBuilding({ roof: { ...project.building.roof, overhang: { ...project.building.roof.overhang, front: Number(e.target.value) } } })} />
        <label>Задний</label>
        <input type="number" value={project.building.roof.overhang.back} onChange={(e) => useProject.getState().updateBuilding({ roof: { ...project.building.roof, overhang: { ...project.building.roof.overhang, back: Number(e.target.value) } } })} />
        <label>Левый</label>
        <input type="number" value={project.building.roof.overhang.left} onChange={(e) => useProject.getState().updateBuilding({ roof: { ...project.building.roof, overhang: { ...project.building.roof.overhang, left: Number(e.target.value) } } })} />
        <label>Правый</label>
        <input type="number" value={project.building.roof.overhang.right} onChange={(e) => useProject.getState().updateBuilding({ roof: { ...project.building.roof, overhang: { ...project.building.roof.overhang, right: Number(e.target.value) } } })} />
        <h4>Список проёмов</h4>
        {project.building.openings.map((o) => (
          <div key={o.id} style={{ marginBottom: 6, fontSize: 12 }}>
            {o.type}
            <input type="number" value={o.x} onChange={(e) => editOpening(o.id, { x: Number(e.target.value) })} placeholder="x" />
            <input type="number" value={o.width} onChange={(e) => editOpening(o.id, { width: Number(e.target.value) })} placeholder="w" />
            <input type="number" value={o.height} onChange={(e) => editOpening(o.id, { height: Number(e.target.value) })} placeholder="h" />
            <input type="number" value={o.sillHeight} onChange={(e) => editOpening(o.id, { sillHeight: Number(e.target.value) })} placeholder="sill" />
            <button onClick={() => removeOpening(o.id)}>x</button>
          </div>
        ))}
        <h4>Проверки</h4>
        {issues.issues.length === 0 && <div>OK</div>}
        {issues.issues.map((i) => (
          <div key={i.id} style={{ color: i.severity === 'error' ? 'red' : 'orange', fontSize: 12 }}>{i.message}</div>
        ))}
        <h4>Материал каркаса</h4>
        {(() => {
          const m = project.materials.lumber.find((mm) => mm.id === project.building.lumberMaterialId);
          if (!m) return null;
          return (
            <>
              <label>Ширина</label>
              <input type="number" value={m.width} onChange={(e) => handleMaterialChange({ width: Number(e.target.value) })} />
              <label>Высота</label>
              <input type="number" value={m.height} onChange={(e) => handleMaterialChange({ height: Number(e.target.value) })} />
              <label>Цена</label>
              <input type="number" value={m.price ?? 0} onChange={(e) => handleMaterialChange({ price: Number(e.target.value) })} />
            </>
          );
        })()}
        <h4>Диагностика геометрии</h4>
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <div>Элементов: {frame.elements.length}</div>
          <div>Неверная геометрия: {frameReport.bad}</div>
          <div>Ошибок проекта: {issues.issues.length}</div>
        </div>
        <div style={{ fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {['plate-bottom','plate-top','stud','header','sill','rafter','ridge','tie'].map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={debug.visibleGroups.includes(k)} onChange={() => setDebug({ visibleGroups: debug.visibleGroups.includes(k) ? debug.visibleGroups.filter((g) => g !== k) : [...debug.visibleGroups, k] })} />
              {GROUP_LABELS[k] || k}
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, display: 'flex', gap: 4, marginBottom: 8 }}>
          {VIEW_MODES.map((m) => (
            <button key={m} onClick={() => setDebug({ viewMode: m })} style={{ padding: '2px 6px', fontSize: 11, cursor: 'pointer', background: debug.viewMode === m ? '#8B5A2B' : '#fff', color: debug.viewMode === m ? '#fff' : '#000', border: '1px solid #8B5A2B' }}>
              {m === 'iso' ? 'Изометрия' : m === 'front' ? 'Вперед' : m === 'side' ? 'Бок' : 'Сверх'}
            </button>
          ))}
        </div>
        {frameReport.report.slice(0, 10).map((r) => (
          <div key={r} style={{ fontSize: 10, color: '#842029', marginBottom: 2 }}>{r}</div>
        ))}
        <button onClick={undo}>Undo</button>
        <button onClick={redo}>Redo</button>
        <button onClick={handleSave}>Сохранить JSON</button>
        <input type="file" accept="application/json" onChange={handleLoad} />
        <button onClick={() => downloadText('facade.svg', generateFacadeSvg(project, 0), 'image/svg+xml')}>Экспорт фасада</button>
        <button onClick={() => downloadText('plan.dxf', generatePlanDxf(project), 'application/dxf')}>Экспорт DXF</button>
        <button onClick={handleExportCsv}>Экспорт CSV</button>
        <button onClick={handleExportPdf}>Экспорт PDF</button>
        <p>Площадь стен: {netWallArea(project).toFixed(2)} м²</p>
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 'calc(100vh - 220px)', minHeight: 0, background: '#fff' }}>
          <ErrorBoundary>
            <Viewport />
          </ErrorBoundary>
        </div>
        <div style={{ height: 220, borderTop: '1px solid #ccc', overflow: 'auto', padding: 8 }}>
          <div style={{ marginBottom: 8 }}>
            <button onClick={() => setTab('spec')}>Спецификация</button>
            <button onClick={() => setTab('info')}>Инфо</button>
            <button onClick={() => setTab('calc')}>Расчёты</button>
            <button onClick={() => setTab('cut')}>Раскрой</button>
          </div>
          {tab === 'spec' && (
            <table style={{ width: '100%', fontSize: 12 }}>
              <thead><tr><th>Вид</th><th>Сечение</th><th>Длина</th><th>Кол-во</th><th>Объём м³</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.mark}>
                    <td>{l.kind}</td><td>{l.section}</td><td>{l.length}</td><td>{l.count}</td><td>{l.volume.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'calc' && (
            <div>
              {(() => {
                const r = checkRafter({
                  span: project.building.width / 2,
                  loadPerArea: 1500,
                  width: project.building.roof.rafterSpacing,
                  section: project.building.roof.rafterSection,
                  E: 10000,
                  strength: 10,
                });
                return (
                  <div>
                    <div>Статус: {r.status === 'passed' ? 'Проверка пройдена' : r.status === 'failed' ? 'Проверка не пройдена' : 'Недостаточно данных'}</div>
                    <div>Момент: {r.maxMoment.toFixed(0)} Нмм</div>
                    <div>Несущая способность: {r.capacity.toFixed(0)} Нмм</div>
                  </div>
                );
              })()}
            </div>
          )}
          {tab === 'cut' && (
            <div>
              {(() => {
                const pieces: number[] = [];
                for (const e of frame.elements) for (let i = 0; i < e.count; i++) pieces.push(e.length);
                const plan = optimizeLumberCuts(pieces, [3000, 4000, 5000, 6000], 3, 0);
                return (
                  <div>
                    <div>Досок: {plan.boards.length}</div>
                    <div>Отход: {plan.totalWaste} мм ({plan.wastePercent.toFixed(1)}%)</div>
                    <table style={{ width: '100%', fontSize: 12 }}>
                      <thead><tr><th>Заготовка</th><th>Детали</th><th>Отход</th></tr></thead>
                      <tbody>
                        {plan.boards.map((b, i) => (
                          <tr key={i}><td>{b.stockLength}</td><td>{b.pieces.join(', ')}</td><td>{b.waste}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
