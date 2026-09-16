import { useLayoutEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

const PLAYER_Y = 0.5
const SPEED = 8

function AimCamera() {
  const camera = useThree((state) => state.camera)

  useLayoutEffect(() => {
    camera.lookAt(0, 0, 0)
  }, [camera])

  return null
}

function Player({ target }: { target: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    const mesh = ref.current
    if (!mesh) return

    const { position } = mesh
    const dx = target.x - position.x
    const dz = target.z - position.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.05) return

    const step = Math.min(SPEED * delta, distance)
    position.x += (dx / distance) * step
    position.z += (dz / distance) * step
  })

  return (
    <mesh ref={ref} position={[0, PLAYER_Y, 0]}>
      <sphereGeometry args={[PLAYER_Y]} />
      <meshStandardMaterial color="red" />
    </mesh>
  )
}

function Ground({ onMove }: { onMove: (point: THREE.Vector3) => void }) {
  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    onMove(event.point)
  }

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerDown={handlePointerDown}>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#3a5a40" />
    </mesh>
  )
}

function App() {
  const [target] = useState(() => new THREE.Vector3(0, PLAYER_Y, 0))

  return (
    <Canvas camera={{ position: [10, 12, 10], fov: 50 }}>
      <AimCamera />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <Player target={target} />
      <Ground
        onMove={(point) => {
          target.set(point.x, PLAYER_Y, point.z)
        }}
      />
      <gridHelper args={[100, 100]} position={[0, 0.01, 0]} raycast={() => {}} />
    </Canvas>
  )
}

export default App
