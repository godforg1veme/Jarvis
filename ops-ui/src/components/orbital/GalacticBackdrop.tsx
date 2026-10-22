import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export default function GalacticBackdrop({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const time = useRef(0);
  const { geometry, material } = useMemo(() => {
    const count = 1200;
    const positions = new Float32Array(count * 3), sizes = new Float32Array(count), strengths = new Float32Array(count), phases = new Float32Array(count);
    let seed = 8742107;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (random() - .5) * 27;
      positions[i * 3 + 1] = (random() - .5) * 18;
      positions[i * 3 + 2] = -6 - random() * 2.8;
      strengths[i] = .13 + random() * .36;
      sizes[i] = random() > .985 ? 2.8 : 1 + random() * 1.1;
      phases[i] = random() * Math.PI * 2;
    }
    const cloud = new THREE.BufferGeometry();
    cloud.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    cloud.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    cloud.setAttribute('aStrength', new THREE.BufferAttribute(strengths, 1));
    cloud.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    const shader = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uGain: { value: .65 } },
      vertexShader: 'attribute float aSize; attribute float aStrength; attribute float aPhase; uniform float uTime; uniform float uGain; varying float vAlpha; void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*p; gl_PointSize=aSize; vAlpha=aStrength*uGain*(0.8+0.2*sin(uTime*0.5+aPhase)); }',
      fragmentShader: 'varying float vAlpha; void main(){ float mask=1.0-smoothstep(0.1,0.5,length(gl_PointCoord-0.5)); gl_FragColor=vec4(vec3(0.75,0.82,0.87),vAlpha*mask); }',
    });
    return { geometry: cloud, material: shader };
  }, []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame((_, delta) => {
    if (!animate) return;
    time.current += Math.min(delta, .05);
    material.uniforms.uTime.value = time.current;
    if (group.current) {
      group.current.rotation.z = Math.sin(time.current * .013) * .007;
      group.current.position.x = Math.sin(time.current * .01) * .08;
    }
  });
  return <group ref={group}>
    <points geometry={geometry} material={material} frustumCulled={false} />
  </group>;
}
