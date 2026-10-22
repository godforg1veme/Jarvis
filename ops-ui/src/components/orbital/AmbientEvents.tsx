import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ambientEventAt } from './orbitalEventTiming';

export default function AmbientEvents({ animate }: { animate: boolean }) {
  const activeTime = useRef(0);
  const meteor = useRef<THREE.Group>(null);
  const meteorMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const glint = useRef<THREE.Mesh>(null);
  const glintMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const discharge = useRef<THREE.Group>(null);
  const dischargeMaterial = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, delta) => {
    if (!animate) {
      if (meteor.current) meteor.current.visible = false;
      if (glint.current) glint.current.visible = false;
      if (discharge.current) discharge.current.visible = false;
      return;
    }
    activeTime.current += Math.min(delta, .05);
    const event = ambientEventAt(activeTime.current);
    if (meteor.current) meteor.current.visible = event?.kind === 'meteor';
    if (glint.current) glint.current.visible = event?.kind === 'glint';
    if (discharge.current) discharge.current.visible = event?.kind === 'discharge';
    if (!event) return;
    const pulse = Math.sin(Math.PI * event.progress);
    if (event.kind === 'meteor' && meteor.current && meteorMaterial.current) {
      meteor.current.position.set(-4.6 + event.progress * 2.4, 2.9 - event.progress * .42, -3.7);
      meteorMaterial.current.opacity = pulse * .48;
    }
    if (event.kind === 'glint' && glint.current && glintMaterial.current) {
      glint.current.scale.setScalar(.45 + pulse * 1.5);
      glintMaterial.current.opacity = pulse * .4;
    }
    if (event.kind === 'discharge' && discharge.current && dischargeMaterial.current) {
      discharge.current.rotation.z = event.progress * .12;
      dischargeMaterial.current.opacity = pulse * .32;
    }
  });
  return <>
    <group ref={meteor} visible={false} rotation={[0, 0, -.18]}>
      <mesh><planeGeometry args={[.74, .009]} /><meshBasicMaterial ref={meteorMaterial} color="#dce9ee" transparent opacity={0} depthWrite={false} /></mesh>
    </group>
    <mesh ref={glint} visible={false} position={[4.6, 2.7, -3.8]}>
      <sphereGeometry args={[.035, 8, 6]} /><meshBasicMaterial ref={glintMaterial} color="#dce9ee" transparent opacity={0} depthWrite={false} />
    </mesh>
    <group ref={discharge} visible={false} position={[-4.3, -2.7, -3.8]}>
      <mesh rotation={[0, 0, .38]}><planeGeometry args={[.44, .006]} /><meshBasicMaterial ref={dischargeMaterial} color="#dce9ee" transparent opacity={0} depthWrite={false} /></mesh>
    </group>
  </>;
}
