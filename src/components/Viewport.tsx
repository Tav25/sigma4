import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useProject } from '../store/useProject';
import * as THREE from 'three';

const MM = 1000;

function ElementMesh({ el }: { el: any }) {
  const start = el.startMm ?? el.position;
  const end = el.endMm ?? { x: start.x + (el.section?.w || 0), y: start.y + el.length, z: start.z };
  const dirX = (end.x - start.x) / MM;
  const dirY = (end.y - start.y) / MM;
  const dirZ = (end.z - start.z) / MM;
  const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
  const nx = dirX / len, ny = dirY / len, nz = dirZ / len;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, ny, nz));
  const e = new THREE.Euler().setFromQuaternion(q);
  const cx = ((start.x + end.x) / 2) / MM;
  const cy = ((start.y + end.y) / 2) / MM;
  const cz = ((start.z + end.z) / 2) / MM;
  const w = (el.section?.w || 0) / MM;
  const h = (el.section?.h || 0) / MM;
  const color = kindColor(el.kind);
  const count = el.count || 1;
  const meshes: JSX.Element[] = [];
  for (let i = 0; i < count; i++) {
    meshes.push(
      <mesh key={`${el.id}-${i}`} position={new THREE.Vector3(cx, cy, cz)} rotation={[e.x, e.y, e.z] as [number, number, number]}>
        <boxGeometry args={[w, len, h]} />
        <meshStandardMaterial color={color} />
      </mesh>
    );
  }
  return <>{meshes}</>;
}

function kindColor(kind: string): string {
  switch (kind) {
    case 'plate-bottom': return '#8B5A2B';
    case 'plate-top': return '#A0522D';
    case 'stud': return '#CD853F';
    case 'header': return '#D2691E';
    case 'sill': return '#DEB887';
    case 'rafter': return '#B8860B';
    case 'ridge': return '#8B4513';
    case 'tie': return '#2E8B57';
    default: return '#999';
  }
}

export function Viewport() {
  const project = useProject((s) => s.project);
  const frame = useProject((s) => s.frame);
  const debug = useProject((s) => s.debug);

  const cx = project.building.length / 2 / MM;
  const cy = project.building.wallHeight / 2 / MM;
  const cz = project.building.width / 2 / MM;

  const visible = new Set(debug.visibleGroups);
  const elements = frame.elements.filter((el) => visible.has(el.kind));

  if (frame.elements.length === 0) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#842029', background: '#f8d7da' }}>
        Генератор вернул ноль элементов каркаса.
      </div>
    );
  }
  if (elements.length === 0) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#842029', background: '#f8d7da' }}>
        Все элементы отфильтрованы переключателями видимости.
      </div>
    );
  }

  const camPos = (() => {
    switch (debug.viewMode) {
      case 'front': return [cx, cy, cz + 12] as [number, number, number];
      case 'side': return [cx + 12, cy, cz] as [number, number, number];
      case 'top': return [cx, cy + 20, cz] as [number, number, number];
      default: return [cx + 10, cy + 7, cz + 10] as [number, number, number];
    }
  })();

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas style={{ height: '100%', width: '100%' }} camera={{ position: camPos, fov: 45, near: 0.1, far: 100000 }}>
        <color attach="background" args={['#87CEEB']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[cx + 10, cy + 20, cz + 10] as [number, number, number]} intensity={1} />
        <Grid args={[40, 40]} />
        <axesHelper args={[5]} />
        <group>
          {elements.map((el) => (
            <ElementMesh key={el.id} el={el} />
          ))}
        </group>
        <OrbitControls target={[cx, cy, cz] as [number, number, number]} />
      </Canvas>
    </div>
  );
}
