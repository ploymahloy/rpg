import * as THREE from 'three'

export const HEIGHTMAP_URL = '/map/heightmap.webp'
export const WORLD_SIZE = 100
export const SEGMENTS = 256
export const MAX_HEIGHT = 12

const GRID = SEGMENTS + 1
const HALF = WORLD_SIZE / 2

export type HeightGrid = Float32Array

let loadPromise: Promise<HeightGrid> | null = null

const sampleSourceLuma = (
  data: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  u: number,
  v: number,
) => {
  const x = u * (srcW - 1)
  const y = v * (srcH - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, srcW - 1)
  const y1 = Math.min(y0 + 1, srcH - 1)
  const fx = x - x0
  const fy = y - y0

  const lumaAt = (px: number, py: number) => {
    const i = (py * srcW + px) * 4
    return (data[i] + data[i + 1] + data[i + 2]) / (3 * 255)
  }

  const a = lumaAt(x0, y0)
  const b = lumaAt(x1, y0)
  const c = lumaAt(x0, y1)
  const d = lumaAt(x1, y1)
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}

const decodeImageToHeights = (image: HTMLImageElement | ImageBitmap): HeightGrid => {
  const srcW = image.width
  const srcH = image.height
  const canvas = document.createElement('canvas')
  canvas.width = srcW
  canvas.height = srcH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Failed to get 2d context for heightmap')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, srcW, srcH)

  const heights = new Float32Array(GRID * GRID)
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const u = ix / SEGMENTS
      const v = iz / SEGMENTS
      heights[iz * GRID + ix] = sampleSourceLuma(data, srcW, srcH, u, v) * MAX_HEIGHT
    }
  }
  return heights
}

export const loadHeightmap = (): Promise<HeightGrid> => {
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      try {
        resolve(decodeImageToHeights(image))
      } catch (err) {
        loadPromise = null
        reject(err)
      }
    }
    image.onerror = () => {
      loadPromise = null
      reject(new Error(`Failed to load heightmap: ${HEIGHTMAP_URL}`))
    }
    image.src = HEIGHTMAP_URL
  })

  return loadPromise
}

export const createTerrainGeometry = (heights: HeightGrid): THREE.PlaneGeometry => {
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS)
  geometry.rotateX(-Math.PI / 2)

  const positions = geometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const z = positions.getZ(i)
    positions.setY(i, sampleHeightGrid(heights, x, z))
  }

  positions.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

const sampleHeightGrid = (heights: HeightGrid, x: number, z: number): number => {
  const u = (x + HALF) / WORLD_SIZE
  const v = (z + HALF) / WORLD_SIZE
  const clampedU = THREE.MathUtils.clamp(u, 0, 1)
  const clampedV = THREE.MathUtils.clamp(v, 0, 1)

  const gx = clampedU * SEGMENTS
  const gz = clampedV * SEGMENTS
  const x0 = Math.floor(gx)
  const z0 = Math.floor(gz)
  const x1 = Math.min(x0 + 1, SEGMENTS)
  const z1 = Math.min(z0 + 1, SEGMENTS)
  const fx = gx - x0
  const fz = gz - z0

  const h00 = heights[z0 * GRID + x0]
  const h10 = heights[z0 * GRID + x1]
  const h01 = heights[z1 * GRID + x0]
  const h11 = heights[z1 * GRID + x1]

  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz
}

export const getHeight = (heights: HeightGrid, x: number, z: number): number =>
  sampleHeightGrid(heights, x, z)
