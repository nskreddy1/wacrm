'use client';

/**
 * The Three.js scene behind the welcome greeting: a slowly-breathing
 * distorted sphere in the brand color, orbiting wire ring, drifting
 * star field and sparkles. Loaded lazily (next/dynamic, ssr: false)
 * by welcome-screen.tsx so three.js never enters the main bundle.
 */

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshDistortMaterial, Sparkles, Stars } from '@react-three/drei';
import type { Group, Mesh } from 'three';

// Brand primary (oklch(0.526 0.247 293)) approximated in sRGB for
// three.js materials, plus a soft white for secondary elements.
const BRAND = '#7c5cf4';
const BRAND_DIM = '#4c3a99';

function Orb() {
  const mesh = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const t = clock.getElapsedTime();
    // Gentle breathing + slow tumble.
    const scale = 1 + Math.sin(t * 0.8) * 0.04;
    mesh.current.scale.setScalar(scale);
    mesh.current.rotation.y = t * 0.15;
    mesh.current.rotation.x = Math.sin(t * 0.2) * 0.2;
  });
  return (
    <mesh ref={mesh} position={[0, 0, -2]}>
      <icosahedronGeometry args={[1.6, 48]} />
      <MeshDistortMaterial
        color={BRAND}
        emissive={BRAND_DIM}
        emissiveIntensity={0.35}
        roughness={0.25}
        metalness={0.55}
        distort={0.35}
        speed={1.6}
      />
    </mesh>
  );
}

function Ring() {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.rotation.z = t * 0.1;
    group.current.rotation.x = 1.1 + Math.sin(t * 0.25) * 0.15;
  });
  return (
    <group ref={group} position={[0, 0, -2]}>
      <mesh>
        <torusGeometry args={[2.7, 0.015, 16, 128]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={0.4}
          transparent
          opacity={0.35}
        />
      </mesh>
      <mesh rotation={[0.4, 0, 0]}>
        <torusGeometry args={[3.2, 0.008, 16, 128]} />
        <meshStandardMaterial
          color={BRAND}
          emissive={BRAND}
          emissiveIntensity={0.6}
          transparent
          opacity={0.5}
        />
      </mesh>
    </group>
  );
}

function CameraDrift() {
  useFrame(({ camera, clock, pointer }) => {
    const t = clock.getElapsedTime();
    // Slow idle drift plus a subtle parallax toward the pointer.
    camera.position.x = Math.sin(t * 0.1) * 0.4 + pointer.x * 0.3;
    camera.position.y = Math.cos(t * 0.12) * 0.3 + pointer.y * 0.2;
    camera.lookAt(0, 0, -2);
  });
  return null;
}

export function WelcomeCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 50 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={['#0a0a14']} />
      <ambientLight intensity={0.4} />
      <pointLight position={[6, 6, 6]} intensity={40} color="#ffffff" />
      <pointLight position={[-6, -4, 2]} intensity={30} color={BRAND} />
      <Stars radius={60} depth={40} count={2500} factor={3} fade speed={0.6} />
      <Sparkles
        count={80}
        scale={[10, 6, 6]}
        size={2.5}
        speed={0.35}
        color={BRAND}
      />
      <Float speed={1.2} rotationIntensity={0.3} floatIntensity={0.6}>
        <Orb />
      </Float>
      <Ring />
      <CameraDrift />
    </Canvas>
  );
}
