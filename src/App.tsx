import { useEffect, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

const PLAYER_Y = 0.5
const SPEED = 8
const CAMERA_YAW_SPEED = 1.8
const CAMERA_PITCH_SPEED = 1.4
const CAMERA_PITCH_MIN = 0.25
const CAMERA_PITCH_MAX = Math.PI / 2 - 0.12

function createInitialOrbit() {
  const offset = new THREE.Vector3(10, 12 - PLAYER_Y, 10)
  const spherical = new THREE.Spherical().setFromVector3(offset)
  spherical.phi = THREE.MathUtils.clamp(
    spherical.phi,
    CAMERA_PITCH_MIN,
    CAMERA_PITCH_MAX,
  )
  return spherical
}

function CameraControls({ playerPos }: { playerPos: RefObject<THREE.Vector3> }) {
  const camera = useThree((state) => state.camera)
  const keys = useRef({ w: false, a: false, s: false, d: false })
  const spherical = useRef(createInitialOrbit())
  const offset = useRef(new THREE.Vector3())

  useEffect(() => {
    const setKey = (code: string, pressed: boolean) => {
      if (code === 'KeyW') keys.current.w = pressed
      if (code === 'KeyA') keys.current.a = pressed
      if (code === 'KeyS') keys.current.s = pressed
      if (code === 'KeyD') keys.current.d = pressed
    }

    const onKeyDown = (event: KeyboardEvent) => setKey(event.code, true)
    const onKeyUp = (event: KeyboardEvent) => setKey(event.code, false)
    const onBlur = () => {
      keys.current.w = false
      keys.current.a = false
      keys.current.s = false
      keys.current.d = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useFrame((_, delta) => {
    const target = playerPos.current
    if (!target) return

    const { w, a, s, d } = keys.current
    const orbit = spherical.current

    if (a) orbit.theta += CAMERA_YAW_SPEED * delta
    if (d) orbit.theta -= CAMERA_YAW_SPEED * delta
    if (w) orbit.phi -= CAMERA_PITCH_SPEED * delta
    if (s) orbit.phi += CAMERA_PITCH_SPEED * delta

    orbit.phi = THREE.MathUtils.clamp(orbit.phi, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX)

    offset.current.setFromSpherical(orbit)
    camera.position.copy(target).add(offset.current)
    camera.lookAt(target)
  })

  return null
}

function Player({
  target,
  playerPos,
}: {
  target: THREE.Vector3
  playerPos: RefObject<THREE.Vector3>
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    const mesh = ref.current
    if (!mesh) return

    const { position } = mesh
    const dx = target.x - position.x
    const dz = target.z - position.z
    const distance = Math.hypot(dx, dz)
    if (distance >= 0.05) {
      const step = Math.min(SPEED * delta, distance)
      position.x += (dx / distance) * step
      position.z += (dz / distance) * step
    }

    playerPos.current.copy(position)
  })

  return (
    <mesh ref={ref} position={[0, PLAYER_Y, 0]}>
      <sphereGeometry args={[PLAYER_Y]} />
      <meshStandardMaterial color="red" />
    </mesh>
  )
}

function Ground({ onMove }: { onMove: (point: THREE.Vector3) => void }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        onMove(event.point)
      }}
    >
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#3a5a40" />
    </mesh>
  )
}

function App() {
  const [target] = useState(() => new THREE.Vector3(0, PLAYER_Y, 0))
  const playerPos = useRef(new THREE.Vector3(0, PLAYER_Y, 0))

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas camera={{ position: [10, 12, 10], fov: 50 }}>
        <color attach="background" args={['#87ceeb']} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[10, 20, 10]} intensity={1} />
        <CameraControls playerPos={playerPos} />
        <Player target={target} playerPos={playerPos} />
        <Ground
          onMove={(point) => {
            target.set(point.x, PLAYER_Y, point.z)
          }}
        />
        <gridHelper args={[100, 100]} position={[0, 0.01, 0]} />
      </Canvas>
    </div>
  )
}

export default App
