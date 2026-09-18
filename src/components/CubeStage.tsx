import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AXIS_INDEX, applyMove, createSolvedCube } from '../cube/model';
import { chooseDragAxis } from '../cube/drag';
import type { Axis, Cubie, Face, Layer, Move } from '../cube/model';

export interface CubeStageHandle {
  playMove: (move: Move, duration?: number) => Promise<void>;
  resetCube: () => void;
  resetView: () => void;
  getCube: () => readonly Cubie[];
}

export interface CubePerformance {
  fps: number;
  renderMode: 'GPU' | 'software' | 'unknown';
}

export interface CubeStageProps {
  onMove: (move: Move, source: 'user' | 'program') => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  interactionMode?: 'turn' | 'orbit';
  duration?: number;
  showFps?: boolean;
  onPerformance?: (stats: CubePerformance) => void;
}

const COLORS: Record<Face, string> = {
  U: '#f4f6f8', D: '#ffe21a', F: '#43b28b', B: '#437ddd', R: '#ed604c', L: '#ff720d',
};
const VECTORS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const STEP = 1.025;
const HOME = new THREE.Vector3(6.4, 5.1, 7.5);

type SliceGesture = {
  kind: 'slice'; pointerId: number; start: THREE.Vector2; point: THREE.Vector3;
  normal: THREE.Vector3; position: Cubie['position']; axis?: Axis;
  direction?: THREE.Vector2; angle: number;
};
type Gesture = SliceGesture | { kind: 'orbit'; pointerId: number; last: THREE.Vector2 };
type Animation = {
  move: Move; from: number; to: number; started: number; duration: number;
  commit: boolean; source: 'user' | 'program'; resolve: () => void;
};

function stickerGeometry() {
  const shape = new THREE.Shape();
  const half = 0.419;
  const radius = 0.065;
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.quadraticCurveTo(half, -half, half, -half + radius);
  shape.lineTo(half, half - radius);
  shape.quadraticCurveTo(half, half, half - radius, half);
  shape.lineTo(-half + radius, half);
  shape.quadraticCurveTo(-half, half, -half, half - radius);
  shape.lineTo(-half, -half + radius);
  shape.quadraticCurveTo(-half, -half, -half + radius, -half);
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.008, bevelEnabled: true, bevelSegments: 2,
    steps: 1, bevelSize: 0.011, bevelThickness: 0.008, curveSegments: 6,
  });
}

class CubeEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  readonly cubeRoot = new THREE.Group();
  readonly pivot = new THREE.Group();
  readonly raycaster = new THREE.Raycaster();
  readonly bodyGeometry = new RoundedBoxGeometry(0.985, 0.985, 0.985, 3, 0.064);
  readonly hitGeometry = new THREE.BoxGeometry(STEP, STEP, STEP);
  readonly hitMaterial = new THREE.MeshBasicMaterial();
  readonly stickerGeometry = stickerGeometry();
  readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: '#252929', roughness: 0.31, metalness: 0.08 });
  readonly stickerMaterials = Object.fromEntries(Object.entries(COLORS).map(([face, color]) => [face,
    new THREE.MeshStandardMaterial({ color, roughness: 0.29, metalness: 0.015 }),
  ])) as Record<Face, THREE.MeshStandardMaterial>;
  readonly pointers = new Map<number, THREE.Vector2>();
  readonly observer: ResizeObserver;
  cube = createSolvedCube();
  hitBoxes: THREE.Mesh[] = [];
  cubieGroups: THREE.Group[] = [];
  gesture: Gesture | null = null;
  animation: Animation | null = null;
  multi: { center: THREE.Vector2; distance: number } | null = null;
  frame = 0;
  dirty = true;
  disposed = false;
  contextLost = false;
  renderMode: CubePerformance['renderMode'] = 'unknown';
  fpsVisible = false;
  renderedFrames = 0;
  lastFpsAt = 0;
  width = 1;
  height = 1;
  props: () => CubeStageProps;

  constructor(readonly host: HTMLDivElement, props: () => CubeStageProps) {
    this.props = props;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    const context = this.renderer.getContext();
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const rendererName = String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
      if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererName)) this.renderMode = 'software';
      else if (/nvidia|amd|radeon|geforce|intel|apple|adreno|mali|powervr/i.test(rendererName)) this.renderMode = 'GPU';
    }
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none;';
    canvas.setAttribute('aria-label', '3Dルービックキューブ。左ドラッグで列を回転、右ドラッグで視点を変更。キーボード操作は隣の面ボタンからも利用できます。');
    canvas.setAttribute('role', 'img');
    canvas.dataset.testid = 'cube-canvas';
    host.appendChild(canvas);
    this.camera.position.copy(HOME);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.cubeRoot, this.pivot);
    this.scene.add(new THREE.HemisphereLight('#fff9ee', '#bec8d6', 2.55));
    const key = new THREE.DirectionalLight('#fff8ed', 3.5);
    key.position.set(-3.5, 7, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.normalBias = 0.035;
    key.shadow.bias = -0.0001;
    key.shadow.radius = 4;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#e3edff', 1.2);
    fill.position.set(5, 2, -4);
    this.scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.09 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.15;
    floor.receiveShadow = true;
    floor.userData.disposeGeometry = true;
    floor.userData.disposeMaterial = true;
    this.scene.add(floor);
    this.rebuild();
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerCancel);
    canvas.addEventListener('lostpointercapture', this.pointerCancel);
    canvas.addEventListener('contextmenu', this.contextMenu);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    window.addEventListener('blur', this.cancelGesture);
    document.addEventListener('visibilitychange', this.visibilityChange);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    this.frame = requestAnimationFrame(this.tick);
  }

  rebuild() {
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.clear();
    this.cubeRoot.clear();
    this.hitBoxes = [];
    this.cubieGroups = this.cube.map(cubie => {
      const group = new THREE.Group();
      group.position.fromArray(cubie.position).multiplyScalar(STEP);
      group.userData.position = cubie.position;
      const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      for (const sticker of cubie.stickers) {
        const mesh = new THREE.Mesh(this.stickerGeometry, this.stickerMaterials[sticker.color]);
        const normal = new THREE.Vector3(...sticker.normal);
        mesh.position.copy(normal).multiplyScalar(0.495);
        mesh.quaternion.setFromUnitVectors(VECTORS.z, normal);
        group.add(mesh);
      }
      // 小片の境目も選べるよう、見た目とは別に隙間のない当たり判定を持つ。
      const hitBox = new THREE.Mesh(this.hitGeometry, this.hitMaterial);
      hitBox.visible = false;
      hitBox.userData.position = cubie.position;
      group.add(hitBox);
      this.hitBoxes.push(hitBox);
      this.cubeRoot.add(group);
      return group;
    });
    this.scene.updateMatrixWorld(true);
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  resize = () => {
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = this.width / this.height;
    // 縦長画面でもキューブ全体が収まるよう、画角を補正する。
    this.camera.fov = this.width < this.height ? 34 * this.height / this.width : 34;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.dirty = true;
  };

  pick(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.hitBoxes, false)[0];
    if (!hit?.face) return null;
    const normal = hit.face.normal.clone();
    return { point: hit.point, normal, position: hit.object.userData.position as Cubie['position'] };
  }

  beginPivot(axis: Axis, layer: Layer) {
    this.pivot.rotation.set(0, 0, 0);
    for (const group of this.cubieGroups) {
      if (group.userData.position[AXIS_INDEX[axis]] === layer) this.pivot.add(group);
    }
    this.dirty = true;
  }

  orbit(dx: number, dy: number) {
    const spherical = new THREE.Spherical().setFromVector3(this.camera.position);
    spherical.theta -= dx * 0.006;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.006, 0.08, Math.PI - 0.08);
    this.camera.position.setFromSpherical(spherical);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.dirty = true;
  }

  zoom(factor: number) {
    this.camera.position.setLength(THREE.MathUtils.clamp(this.camera.position.length() * factor, 7.4, 17));
    this.camera.updateMatrixWorld();
    this.dirty = true;
  }

  pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    if (this.animation || this.props().disabled || this.contextLost) return;
    event.preventDefault();
    this.renderer.domElement.setPointerCapture(event.pointerId);
    const point = new THREE.Vector2(event.clientX, event.clientY);
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size > 1) {
      // 二本目の指が触れたら、途中の面操作を取り消して視点操作へ移る。
      this.gesture = null;
      this.rebuild();
      this.multi = this.multiState();
      return;
    }
    if (event.button === 2 || this.props().interactionMode === 'orbit') {
      this.gesture = { kind: 'orbit', pointerId: event.pointerId, last: point };
      this.renderer.domElement.style.cursor = 'grabbing';
      return;
    }
    const hit = this.pick(event);
    if (!hit) {
      // 余白からは視点を動かせる。小さな画面でも持ち替えやすくする。
      this.gesture = { kind: 'orbit', pointerId: event.pointerId, last: point };
    } else {
      this.gesture = { kind: 'slice', pointerId: event.pointerId, start: point,
        point: hit.point, normal: hit.normal,
        position: hit.position, angle: 0 };
    }
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  multiState() {
    const [first, second] = [...this.pointers.values()];
    return { center: first.clone().add(second).multiplyScalar(0.5), distance: Math.max(1, first.distanceTo(second)) };
  }

  pointerMove = (event: PointerEvent) => {
    const point = new THREE.Vector2(event.clientX, event.clientY);
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, point);
    if (this.pointers.size >= 2 && this.multi) {
      const next = this.multiState();
      const delta = next.center.clone().sub(this.multi.center);
      this.orbit(delta.x, delta.y);
      this.zoom(this.multi.distance / next.distance);
      this.multi = next;
      return;
    }
    if (this.animation || this.props().disabled) return;
    const gesture = this.gesture;
    if (!gesture) {
      if (event.pointerType !== 'touch') this.renderer.domElement.style.cursor = this.pick(event) ? 'grab' : 'default';
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    if (gesture.kind === 'orbit') {
      const delta = point.clone().sub(gesture.last);
      this.orbit(delta.x, delta.y);
      gesture.last = point;
      return;
    }
    const delta = point.clone().sub(gesture.start);
    if (!gesture.axis) {
      if (delta.length() < 9) return;
      const selected = chooseDragAxis(gesture.point, gesture.normal, delta, this.camera, this.width, this.height);
      if (!selected) return;
      gesture.axis = selected.axis;
      gesture.direction = selected.direction;
      this.beginPivot(gesture.axis, gesture.position[AXIS_INDEX[gesture.axis]] as Layer);
    }
    const pixelsPerTurn = Math.min(this.width, this.height) * 0.29;
    gesture.angle = THREE.MathUtils.clamp(delta.dot(gesture.direction!) / pixelsPerTurn * Math.PI / 2, -Math.PI / 2, Math.PI / 2);
    this.pivot.rotation[gesture.axis] = gesture.angle;
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  };

  pointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    if (this.multi) {
      this.multi = null;
      this.gesture = null;
      this.pointers.clear();
      this.renderer.domElement.style.cursor = 'grab';
      return;
    }
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.gesture = null;
    this.renderer.domElement.style.cursor = 'grab';
    if (gesture.kind === 'slice' && gesture.axis) {
      const commit = Math.abs(gesture.angle) >= 0.24;
      const move: Move = { axis: gesture.axis, layer: gesture.position[AXIS_INDEX[gesture.axis]] as Layer,
        turns: gesture.angle < 0 ? -1 : 1 };
      void this.animate(move, gesture.angle, commit, 'user', this.props().duration ?? 220);
    }
  };

  pointerCancel = (event: PointerEvent) => {
    if (this.pointers.has(event.pointerId)) this.cancelGesture();
  };

  cancelGesture = () => {
    this.pointers.clear();
    this.multi = null;
    if (this.gesture) {
      this.gesture = null;
      this.rebuild();
    }
    this.renderer.domElement.style.cursor = 'grab';
  };

  contextMenu = (event: Event) => event.preventDefault();
  wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (this.gesture || this.animation) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
    this.zoom(Math.exp(THREE.MathUtils.clamp(delta, -500, 500) * 0.001));
  };

  onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.cancelGesture();
    this.props().onError?.('3D表示が一時停止しました。ページを再読み込みしてください。');
  };
  onContextRestored = () => { this.contextLost = false; this.renderer.shadowMap.needsUpdate = true; this.dirty = true; };

  visibilityChange = () => {
    this.lastFpsAt = performance.now();
    this.renderedFrames = 0;
    this.dirty = true;
  };

  animate(move: Move, from: number, commit: boolean, source: 'user' | 'program', duration: number) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise<void>(resolve => {
      this.animation = { move, from, to: commit ? move.turns * Math.PI / 2 : 0,
        started: performance.now(), duration: reduce ? 1 : duration, commit, source, resolve };
      this.dirty = true;
    });
  }

  playMove = async (move: Move, duration = 220) => {
    if (this.disposed || this.contextLost) throw new Error('3D表示を利用できません。');
    if (this.animation) throw new Error('回転が終わるまでお待ちください。');
    this.cancelGesture();
    this.beginPivot(move.axis, move.layer);
    await this.animate(move, 0, true, 'program', duration);
  };

  resetCube = () => {
    const previous = this.animation;
    this.animation = null;
    previous?.resolve();
    this.cancelGesture();
    this.cube = createSolvedCube();
    this.rebuild();
  };

  resetView = () => {
    this.cancelGesture();
    this.camera.position.copy(HOME);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.dirty = true;
  };

  tick = (now: number) => {
    if (this.disposed) return;
    const showFps = Boolean(this.props().showFps);
    if (showFps !== this.fpsVisible) {
      this.fpsVisible = showFps;
      this.renderedFrames = 0;
      this.lastFpsAt = now;
    }
    const animation = this.animation;
    if (animation) {
      const progress = Math.min(1, (now - animation.started) / animation.duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.pivot.rotation[animation.move.axis] = animation.from + (animation.to - animation.from) * eased;
      this.renderer.shadowMap.needsUpdate = true;
      this.dirty = true;
      if (progress >= 1) {
        this.animation = null;
        if (animation.commit) this.cube = applyMove(this.cube, animation.move);
        this.rebuild();
        if (animation.commit) this.props().onMove(animation.move, animation.source);
        animation.resolve();
      }
    }
    // FPS表示中だけ連続描画し、通常は画面が変わったときだけGPUへ送る。
    if ((this.dirty || showFps) && !this.contextLost && !document.hidden) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
      if (showFps) this.renderedFrames += 1;
    }
    if (showFps && !document.hidden && now - this.lastFpsAt >= 500) {
      this.props().onPerformance?.({ fps: Math.round(this.renderedFrames * 1000 / (now - this.lastFpsAt)), renderMode: this.renderMode });
      this.renderedFrames = 0;
      this.lastFpsAt = now;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    window.removeEventListener('blur', this.cancelGesture);
    document.removeEventListener('visibilitychange', this.visibilityChange);
    this.animation?.resolve();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.pointerDown);
    canvas.removeEventListener('pointermove', this.pointerMove);
    canvas.removeEventListener('pointerup', this.pointerUp);
    canvas.removeEventListener('pointercancel', this.pointerCancel);
    canvas.removeEventListener('lostpointercapture', this.pointerCancel);
    canvas.removeEventListener('contextmenu', this.contextMenu);
    canvas.removeEventListener('wheel', this.wheel);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.bodyGeometry.dispose();
    this.hitGeometry.dispose();
    this.hitMaterial.dispose();
    this.stickerGeometry.dispose();
    this.bodyMaterial.dispose();
    Object.values(this.stickerMaterials).forEach(material => material.dispose());
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        if (object.userData.disposeGeometry) object.geometry.dispose();
        if (object.userData.disposeMaterial) object.material.dispose();
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    this.renderer.dispose();
    canvas.remove();
  }
}

export const CubeStage = forwardRef<CubeStageHandle, CubeStageProps>(function CubeStage(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<CubeEngine | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    playMove: (move, duration) => engine.current?.playMove(move, duration) ?? Promise.reject(new Error('3D表示の準備中です。')),
    resetCube: () => engine.current?.resetCube(),
    resetView: () => engine.current?.resetView(),
    getCube: () => engine.current?.cube ?? createSolvedCube(),
  }), []);

  useEffect(() => {
    try {
      engine.current = new CubeEngine(host.current!, () => latest.current);
      latest.current.onReady?.();
    } catch {
      latest.current.onError?.('3D表示を開始できませんでした。ブラウザのハードウェアアクセラレーションを有効にして、ページを再読み込みしてください。');
    }
    return () => { engine.current?.dispose(); engine.current = null; };
  }, []);

  return <div ref={host} className="cube-canvas" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />;
});
