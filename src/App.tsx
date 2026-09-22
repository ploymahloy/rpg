import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import {
  createTerrainGeometry,
  getHeight,
  loadHeightmap,
  type HeightGrid,
} from './terrain'

const PLAYER_RADIUS = 0.5
const SPEED = 8
const TURN_SPEED = 10
const ARRIVAL_DISTANCE = 0.05
const CAMERA_LOOK_Y = 1.2
const CAMERA_YAW_SPEED = 1.8
const CAMERA_PITCH_SPEED = 1.4
const CAMERA_PITCH_MIN = 0.25
const CAMERA_PITCH_MAX = Math.PI / 2 - 0.12
const CAMERA_PITCH_DEFAULT = Math.PI / 2 - 0.35
const CAMERA_YAW_DEFAULT = Math.PI / 4
const CAMERA_ZOOM_MIN = 5
const CAMERA_ZOOM_MAX = 20
const CAMERA_ZOOM_SPEED = 0.0012
const CAMERA_DISTANCE_DEFAULT = 14

const CHARACTER_URL = '/models/character.glb'
const CHARACTER_SCALE = 1
const CHARACTER_YAW_OFFSET = 0
const IDLE_CLIP = 'HumanArmature|Man_Idle'
const RUN_CLIP = 'HumanArmature|Man_Run'

const createInitialOrbit = () =>
  new THREE.Spherical(
    THREE.MathUtils.clamp(CAMERA_DISTANCE_DEFAULT, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX),
    THREE.MathUtils.clamp(CAMERA_PITCH_DEFAULT, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX),
    CAMERA_YAW_DEFAULT,
  )

const INITIAL_CAMERA_POSITION = (() => {
  const offset = new THREE.Vector3().setFromSpherical(createInitialOrbit())
  return [offset.x, offset.y + CAMERA_LOOK_Y, offset.z] as const
})()

const ignoreRaycast = () => { }

const shortestAngleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from))

const stepYawToward = (
  object: THREE.Object3D,
  desiredYaw: number,
  delta: number,
) => {
  const yawDelta = shortestAngleDelta(object.rotation.y, desiredYaw)
  const maxTurn = TURN_SPEED * delta
  if (Math.abs(yawDelta) <= maxTurn) {
    object.rotation.y = desiredYaw
    return
  }
  object.rotation.y += Math.sign(yawDelta) * maxTurn
}

const stepPlayer = (
  object: THREE.Object3D,
  target: THREE.Vector3,
  delta: number,
  heights: HeightGrid | null,
  yawOffset = 0,
) => {
  const { position } = object
  const dx = target.x - position.x
  const dz = target.z - position.z
  const distance = Math.hypot(dx, dz)
  const isMoving = distance >= ARRIVAL_DISTANCE
  if (isMoving) {
    const step = Math.min(SPEED * delta, distance)
    position.x += (dx / distance) * step
    position.z += (dz / distance) * step
    stepYawToward(object, Math.atan2(dx, dz) + yawOffset, delta)
  }

  if (heights) {
    position.y = getHeight(heights, position.x, position.z)
  }

  return isMoving
}

const syncLocomotion = (
  isMoving: boolean,
  wasMoving: RefObject<boolean>,
  idle: THREE.AnimationAction | null | undefined,
  run: THREE.AnimationAction | null | undefined,
) => {
  if (!idle || !run) return
  if (isMoving === wasMoving.current) return
  wasMoving.current = isMoving

  const next = isMoving ? run : idle
  const prev = isMoving ? idle : run
  prev.fadeOut(0.2)
  next.reset().fadeIn(0.2).play()
}

const CameraControls = ({ playerPos }: { playerPos: RefObject<THREE.Vector3> }) => {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
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
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const orbit = spherical.current
      orbit.radius = THREE.MathUtils.clamp(
        orbit.radius * (1 + event.deltaY * CAMERA_ZOOM_SPEED),
        CAMERA_ZOOM_MIN,
        CAMERA_ZOOM_MAX,
      )
    }

    const canvas = gl.domElement
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  useFrame((_, delta) => {
    const target = playerPos.current
    if (!target) return

    const { w, a, s, d } = keys.current
    const orbit = spherical.current

    if (d) orbit.theta += CAMERA_YAW_SPEED * delta
    if (a) orbit.theta -= CAMERA_YAW_SPEED * delta
    if (w) orbit.phi -= CAMERA_PITCH_SPEED * delta
    if (s) orbit.phi += CAMERA_PITCH_SPEED * delta

    orbit.phi = THREE.MathUtils.clamp(orbit.phi, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX)
    orbit.radius = THREE.MathUtils.clamp(orbit.radius, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX)

    offset.current.setFromSpherical(orbit)
    camera.position.copy(target).add(offset.current)
    camera.lookAt(target)
  })

  return null
}

const CharacterPlayer = ({
  target,
  playerPos,
  heightsRef,
}: {
  target: THREE.Vector3
  playerPos: RefObject<THREE.Vector3>
  heightsRef: RefObject<HeightGrid | null>
}) => {
  const group = useRef<THREE.Group>(null)
  const { scene, animations } = useGLTF(CHARACTER_URL)
  const { actions } = useAnimations(animations, scene)
  const wasMoving = useRef(false)
  const startedIdle = useRef(false)

  useEffect(() => {
    scene.traverse((obj) => {
      obj.raycast = ignoreRaycast
    })
  }, [scene])

  useFrame((_, delta) => {
    const mesh = group.current
    if (!mesh) return

    const idle = actions[IDLE_CLIP]
    const run = actions[RUN_CLIP]
    const isMoving = stepPlayer(
      mesh,
      target,
      delta,
      heightsRef.current,
      CHARACTER_YAW_OFFSET,
    )

    if (idle && !startedIdle.current) {
      idle.reset().play()
      startedIdle.current = true
    }
    syncLocomotion(isMoving, wasMoving, idle, run)

    playerPos.current.set(
      mesh.position.x,
      mesh.position.y + CAMERA_LOOK_Y,
      mesh.position.z,
    )
  })

  return (
    <group ref={group} position={[0, 0, 0]}>
      <primitive object={scene} scale={CHARACTER_SCALE} />
    </group>
  )
}

const DestinationMarker = ({
  target,
  playerPos,
  heightsRef,
}: {
  target: THREE.Vector3
  playerPos: RefObject<THREE.Vector3>
  heightsRef: RefObject<HeightGrid | null>
}) => {
  const group = useRef<THREE.Group>(null)

  useFrame((state) => {
    const marker = group.current
    if (!marker) return

    const pos = playerPos.current
    const distance = Math.hypot(target.x - pos.x, target.z - pos.z)
    const visible = distance > PLAYER_RADIUS

    marker.visible = visible
    if (!visible) return

    const heights = heightsRef.current
    const y = heights ? getHeight(heights, target.x, target.z) + 0.04 : 0.04
    marker.position.set(target.x, y, target.z)
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 7) * 0.1
    marker.scale.setScalar(pulse)
  })

  return (
    <group ref={group} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh raycast={ignoreRaycast}>
        <ringGeometry args={[0.55, 0.85, 48]} />
        <meshBasicMaterial color="#ffe566" transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <mesh raycast={ignoreRaycast}>
        <circleGeometry args={[0.28, 32]} />
        <meshBasicMaterial color="#fff6b0" transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  )
}

const Terrain = ({
  onMove,
  heightsRef,
}: {
  onMove: (point: THREE.Vector3) => void
  heightsRef: RefObject<HeightGrid | null>
}) => {
  const meshRef = useRef<THREE.Mesh>(null)
  const geometryRef = useRef<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    let cancelled = false

    loadHeightmap().then((heights) => {
      if (cancelled) return

      const geometry = createTerrainGeometry(heights)
      geometryRef.current = geometry
      heightsRef.current = heights

      const mesh = meshRef.current
      if (mesh) {
        const previous = mesh.geometry
        mesh.geometry = geometry
        previous.dispose()
      }
    })

    return () => {
      cancelled = true
      geometryRef.current?.dispose()
      geometryRef.current = null
    }
  }, [heightsRef])

  return (
    <mesh
      ref={meshRef}
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

const App = () => {
  const [target] = useState(() => new THREE.Vector3())
  const playerPos = useRef(new THREE.Vector3(0, CAMERA_LOOK_Y, 0))
  const heightsRef = useRef<HeightGrid | null>(null)

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas camera={{ position: [...INITIAL_CAMERA_POSITION], fov: 50 }}>
        <color attach="background" args={['#87ceeb']} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[10, 20, 10]} intensity={1} />
        <CameraControls playerPos={playerPos} />
        <CharacterPlayer target={target} playerPos={playerPos} heightsRef={heightsRef} />
        <DestinationMarker target={target} playerPos={playerPos} heightsRef={heightsRef} />
        <Terrain
          heightsRef={heightsRef}
          onMove={(point) => target.set(point.x, point.y, point.z)}
        />
      </Canvas>
    </div>
  )
}

useGLTF.preload(CHARACTER_URL)

export default App
