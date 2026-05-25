import { useEffect, useRef } from "react";
import * as THREE from "three";

export function AmbientParticles({ isPlaying }: { isPlaying: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.z = 7;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(renderer.domElement);

    const particleCount = 900;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const colorA = new THREE.Color("#f4c77b");
    const colorB = new THREE.Color("#6de0d2");

    for (let index = 0; index < particleCount; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 12;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 7;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 5;
      const mixed = colorA.clone().lerp(colorB, Math.random());
      colors[index * 3] = mixed.r;
      colors[index * 3 + 1] = mixed.g;
      colors[index * 3 + 2] = mixed.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.025,
      transparent: true,
      opacity: 0.58,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    let frame = 0;
    let raf = 0;
    const animate = () => {
      frame += 0.006;
      particles.rotation.y += isPlaying ? 0.0014 : 0.00045;
      particles.rotation.x = Math.sin(frame) * 0.08;
      material.opacity = isPlaying ? 0.62 + Math.sin(frame * 2) * 0.05 : 0.38;
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [isPlaying]);

  return <div className="ambient-particles" ref={mountRef} aria-hidden="true" />;
}
