import { Vector2, Vector3 } from 'three'
import type { Camera } from 'three'
import type { Axis } from './model'

const AXES: readonly Axis[] = ['x', 'y', 'z']
const VECTORS = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
}

function projectToScreen(point: Vector3, camera: Camera, width: number, height: number) {
  const projected = point.clone().project(camera)
  return new Vector2(projected.x * width / 2, -projected.y * height / 2)
}

export function chooseDragAxis(
  point: Vector3,
  normal: Vector3,
  delta: Vector2,
  camera: Camera,
  width: number,
  height: number,
): { axis: Axis; direction: Vector2 } | null {
  if (delta.lengthSq() === 0) return null

  const dragDirection = delta.clone().normalize()
  const start = projectToScreen(point, camera, width, height)
  let bestScore = -1
  let result: { axis: Axis; direction: Vector2 } | null = null

  // 法線の接線ではなく触れた点の実際の移動を投影し、斜めの視点でも向きを保つ。
  for (const axis of AXES) {
    if (Math.abs(normal.dot(VECTORS[axis])) > 0.5) continue

    const rotated = point.clone().applyAxisAngle(VECTORS[axis], 0.035)
    const direction = projectToScreen(rotated, camera, width, height).sub(start)
    if (direction.length() < 0.5) continue

    direction.normalize()
    const score = Math.abs(dragDirection.dot(direction))
    if (score > bestScore) {
      bestScore = score
      result = { axis, direction }
    }
  }

  return result
}
