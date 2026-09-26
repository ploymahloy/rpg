import * as THREE from 'three'

export type Surface = 'grass' | 'water'

export type GroundSample = {
  y: number
  surface: Surface | null
}

const RAY_HEIGHT = 50
const raycaster = new THREE.Raycaster()
const origin = new THREE.Vector3()
const down = new THREE.Vector3(0, -1, 0)

const surfaceFromHit = (hit: THREE.Intersection): Surface | null => {
  const mesh = hit.object as THREE.Mesh
  const materials = mesh.material
  const material = Array.isArray(materials)
    ? materials[hit.face?.materialIndex ?? 0]
    : materials
  const name = material?.name
  if (name === 'Grass') return 'grass'
  if (name === 'Water') return 'water'
  return null
}

export const sampleGround = (
  terrain: THREE.Object3D | null,
  x: number,
  z: number,
): GroundSample => {
  if (!terrain) return { y: 0, surface: null }

  origin.set(x, RAY_HEIGHT, z)
  raycaster.set(origin, down)
  const hits = raycaster.intersectObject(terrain, true)
  const hit = hits[0]
  if (!hit) return { y: 0, surface: null }

  return {
    y: hit.point.y,
    surface: surfaceFromHit(hit),
  }
}
