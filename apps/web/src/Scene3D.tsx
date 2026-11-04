import { useEffect, useRef } from 'react';
import { BoxGeometry, Mesh, MeshNormalMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export function Scene3D() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const scene = new Scene();
    const camera = new PerspectiveCamera(50, 4 / 3, 0.1, 100);
    camera.position.z = 3;
    scene.add(new Mesh(new BoxGeometry(), new MeshNormalMaterial()));
    const renderer = new WebGLRenderer();
    renderer.setSize(400, 300);
    host.appendChild(renderer.domElement);
    renderer.render(scene, camera);
    return () => {
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return <div ref={ref} />;
}
