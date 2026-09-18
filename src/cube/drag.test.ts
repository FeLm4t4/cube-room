import { PerspectiveCamera, Vector2, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { chooseDragAxis } from './drag'
import type { Axis } from './model'

const WIDTH = 800
const HEIGHT = 600
const VECTORS = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
}

function cameraAt(position: Vector3, up = new Vector3(0, 1, 0)) {
  const camera = new PerspectiveCamera(34, WIDTH / HEIGHT, 0.1, 80)
  camera.position.copy(position)
  camera.up.copy(up)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return camera
}

function screen(point: Vector3, camera: PerspectiveCamera) {
  const projected = point.clone().project(camera)
  return new Vector2(projected.x * WIDTH / 2, -projected.y * HEIGHT / 2)
}

describe('画面上のドラッグと回転軸', () => {
  it('前面の左右ドラッグは y 軸を選び、正転の方向を右向きとする', () => {
    const camera = cameraAt(new Vector3(0, 0, 10))

    for (const x of [-100, 100]) {
      const result = chooseDragAxis(
        new Vector3(0, 0, 1.52), VECTORS.z, new Vector2(x, 0), camera, WIDTH, HEIGHT,
      )
      expect(result?.axis).toBe('y')
      expect(result!.direction.x).toBeGreaterThan(0.99)
    }
  })

  it('前面の上下ドラッグは x 軸を選び、正転の方向を下向きとする', () => {
    const camera = cameraAt(new Vector3(0, 0, 10))

    for (const y of [-100, 100]) {
      const result = chooseDragAxis(
        new Vector3(0, 0, 1.52), VECTORS.z, new Vector2(0, y), camera, WIDTH, HEIGHT,
      )
      expect(result?.axis).toBe('x')
      expect(result!.direction.y).toBeGreaterThan(0.99)
    }
  })

  it('見下ろす視点の前面下段でも、ドラッグと実際の回転が逆転しない', () => {
    const camera = cameraAt(new Vector3(0, 9.904918125879448, 4.784620875223532))
    const point = new Vector3(0, -1.025, 1.52)
    const delta = new Vector2(0, -100)
    const result = chooseDragAxis(point, VECTORS.z, delta, camera, WIDTH, HEIGHT)

    expect(result?.axis).toBe('x')
    expect(result!.direction.y).toBeLessThan(-0.99)

    // この位置では面の法線から求めた方向だけが下向きになり、旧方式は逆転していた。
    const faceTangent = new Vector3().crossVectors(VECTORS.x, VECTORS.z)
    const oldDirection = screen(point.clone().add(faceTangent), camera).sub(screen(point, camera))
    expect(oldDirection.y).toBeGreaterThan(0)

    const sign = Math.sign(delta.dot(result!.direction))
    const moved = point.clone().applyAxisAngle(VECTORS.x, sign * 0.001)
    const actualDirection = screen(moved, camera).sub(screen(point, camera)).normalize()
    expect(actualDirection.dot(delta.clone().normalize())).toBeGreaterThan(0.99)
  })

  it.each([
    { face: '右面', normal: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) },
    { face: '左面', normal: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0) },
    { face: '上面', normal: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1) },
    { face: '下面', normal: new Vector3(0, -1, 0), up: new Vector3(0, 0, 1) },
    { face: '前面', normal: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) },
    { face: '背面', normal: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0) },
  ])('$face の二方向でドラッグと回転方向が一致する', ({ normal, up }) => {
    const camera = cameraAt(normal.clone().multiplyScalar(10), up)
    const point = normal.clone().multiplyScalar(1.52)

    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      if (Math.abs(normal.dot(VECTORS[axis])) > 0.5) continue

      // 独立した接線速度からドラッグを作り、有限角の投影による判定を検証する。
      const velocity = new Vector3().crossVectors(VECTORS[axis], point)
      const delta = screen(point.clone().addScaledVector(velocity, 0.001), camera)
        .sub(screen(point, camera)).normalize().multiplyScalar(100)
      const result = chooseDragAxis(point, normal, delta, camera, WIDTH, HEIGHT)

      expect(result?.axis).toBe(axis)
      expect(result!.direction.dot(delta.clone().normalize())).toBeGreaterThan(0.99)
    }
  })

  it('移動していないポインターから回転を開始しない', () => {
    const camera = cameraAt(new Vector3(0, 0, 10))
    expect(chooseDragAxis(
      new Vector3(0, 0, 1.52), VECTORS.z, new Vector2(), camera, WIDTH, HEIGHT,
    )).toBeNull()
  })

  it('投影された動きが小さすぎる場合は軸を選ばない', () => {
    const camera = cameraAt(new Vector3(0, 0, 10))
    expect(chooseDragAxis(
      new Vector3(0, 0, 1.52), VECTORS.z, new Vector2(100, 0), camera, 1, 1,
    )).toBeNull()
  })
})
