import {
  useEffect,
  useMemo,
  useRef,
  type RefObject,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { sampleGround, type Surface } from './terrain'

const SPEED = 5
const FACE_TURN_SPEED = 10
const CAMERA_LOOK_Y = 1.2
const CAMERA_YAW_SPEED = 1.8
const CAMERA_PITCH_SPEED = 1.4
const CAMERA_PITCH_MIN = 0.25
const CAMERA_PITCH_MAX = Math.PI / 2 - 0.12
const CAMERA_PITCH_DEFAULT = Math.PI / 2 - 0.35
const CAMERA_YAW_DEFAULT = Math.PI / 4
const CAMERA_ZOOM_MIN = 3
const CAMERA_ZOOM_MAX = 9
const CAMERA_ZOOM_SPEED = 0.0012
const CAMERA_DISTANCE_DEFAULT = 4

const CHARACTER_URL = '/models/caveman.glb'
const TERRAIN_URL = '/map/red_rock_terrain.glb'
const CHARACTER_SCALE = 1
const CHARACTER_YAW_OFFSET = 0
const IDLE_CLIP = 'mixamo.com.007'
const RUN_CLIP = 'mixamo.com.002'
const FOOTSTEP_PHASES = [0.2, 0.65] as const

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

type MoveKeys = {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

type CameraKeys = {
  w: boolean
  a: boolean
  s: boolean
  d: boolean
}

const clearedMoveKeys = (): MoveKeys => ({
  up: false,
  down: false,
  left: false,
  right: false,
})

const clearedCameraKeys = (): CameraKeys => ({
  w: false,
  a: false,
  s: false,
  d: false,
})

const cameraForward = new THREE.Vector3()
const cameraRight = new THREE.Vector3()
const worldUp = new THREE.Vector3(0, 1, 0)

const cameraPlanarBasis = (camera: THREE.Camera) => {
  camera.getWorldDirection(cameraForward)
  cameraForward.y = 0
  if (cameraForward.lengthSq() < 1e-8) {
    cameraForward.set(0, 0, -1)
  } else {
    cameraForward.normalize()
  }
  cameraRight.crossVectors(cameraForward, worldUp)
  if (cameraRight.lengthSq() < 1e-8) {
    cameraRight.set(1, 0, 0)
  } else {
    cameraRight.normalize()
  }
}

const shortestAngleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from))

const stepYawToward = (
  object: THREE.Object3D,
  desiredYaw: number,
  delta: number,
) => {
  const yawDelta = shortestAngleDelta(object.rotation.y, desiredYaw)
  const maxTurn = FACE_TURN_SPEED * delta
  if (Math.abs(yawDelta) <= maxTurn) {
    object.rotation.y = desiredYaw
    return
  }
  object.rotation.y += Math.sign(yawDelta) * maxTurn
}

const stepPlayer = (
  object: THREE.Object3D,
  moveX: number,
  moveZ: number,
  delta: number,
  terrain: THREE.Object3D | null,
  yawOffset = 0,
): { isMoving: boolean; surface: Surface | null } => {
  const { position } = object
  const distance = Math.hypot(moveX, moveZ)
  const isMoving = distance > 0
  if (isMoving) {
    const step = SPEED * delta
    position.x += (moveX / distance) * step
    position.z += (moveZ / distance) * step
    stepYawToward(object, Math.atan2(moveX, moveZ) + yawOffset, delta)
  }

  const ground = sampleGround(terrain, position.x, position.z)
  position.y = ground.y
  return { isMoving, surface: ground.surface }
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


const phaseIndexAt = (phase: number) => {
  let index = -1
  for (let i = 0; i < FOOTSTEP_PHASES.length; i++) {
    if (phase >= FOOTSTEP_PHASES[i]) index = i
  }
  return index
}

const playFootstepsForPhase = (
  run: THREE.AnimationAction,
  lastPhaseIndex: RefObject<number>,
  surface: Surface | null,
) => {
  if (!surface) return

  const duration = run.getClip().duration
  if (duration <= 0) return

  const phase = (run.time % duration) / duration
  const nextIndex = phaseIndexAt(phase)
  const prevIndex = lastPhaseIndex.current

  if (nextIndex === prevIndex) return
  lastPhaseIndex.current = nextIndex
  // Phase dropped below both thresholds (clip wrapped) — wait for the next plant.
  if (nextIndex < 0) return
}

const CameraControls = ({
  playerPos,
  keys,
  onWheel,
}: {
  playerPos: RefObject<THREE.Vector3>
  keys: RefObject<CameraKeys>
  onWheel: RefObject<(deltaY: number) => void>
}) => {
  const camera = useThree((state) => state.camera)
  const spherical = useRef(createInitialOrbit())
  const offset = useRef(new THREE.Vector3())

  useEffect(() => {
    onWheel.current = (deltaY) => {
      const orbit = spherical.current
      orbit.radius = THREE.MathUtils.clamp(
        orbit.radius * (1 + deltaY * CAMERA_ZOOM_SPEED),
        CAMERA_ZOOM_MIN,
        CAMERA_ZOOM_MAX,
      )
    }
    return () => {
      onWheel.current = () => { }
    }
  }, [onWheel])

  useFrame((_, delta) => {
    const target = playerPos.current
    if (!target) return

    const { w, a, s, d } = keys.current
    const orbit = spherical.current

    if (d) orbit.theta -= CAMERA_YAW_SPEED * delta
    if (a) orbit.theta += CAMERA_YAW_SPEED * delta
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
  playerPos,
  terrainRef,
  keys,
}: {
  playerPos: RefObject<THREE.Vector3>
  terrainRef: RefObject<THREE.Object3D | null>
  keys: RefObject<MoveKeys>
}) => {
  const camera = useThree((state) => state.camera)
  const group = useRef<THREE.Group>(null)
  const { scene, animations } = useGLTF(CHARACTER_URL)
  const { actions } = useAnimations(animations, scene)
  const wasMoving = useRef(false)
  const startedIdle = useRef(false)
  const lastFootstepPhase = useRef(-1)

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
    cameraPlanarBasis(camera)
    const { up, down, left, right } = keys.current
    const throttle = (up ? 1 : 0) - (down ? 1 : 0)
    const strafe = (right ? 1 : 0) - (left ? 1 : 0)
    const { isMoving, surface } = stepPlayer(
      mesh,
      cameraForward.x * throttle + cameraRight.x * strafe,
      cameraForward.z * throttle + cameraRight.z * strafe,
      delta,
      terrainRef.current,
      CHARACTER_YAW_OFFSET,
    )

    if (idle && !startedIdle.current) {
      idle.reset().play()
      startedIdle.current = true
    }
    syncLocomotion(isMoving, wasMoving, idle, run)

    if (isMoving && run) {
      playFootstepsForPhase(run, lastFootstepPhase, surface)
    } else {
      lastFootstepPhase.current = -1
    }

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

const Terrain = ({
  terrainRef,
}: {
  terrainRef: RefObject<THREE.Object3D | null>
}) => {
  const { scene } = useGLTF(TERRAIN_URL)
  const root = useMemo(() => scene.clone(true), [scene])

  useEffect(() => {
    terrainRef.current = root
    return () => {
      if (terrainRef.current === root) terrainRef.current = null
    }
  }, [root, terrainRef])

  return <primitive object={root} />
}

const App = () => {
  const playerPos = useRef(new THREE.Vector3(0, CAMERA_LOOK_Y, 0))
  const terrainRef = useRef<THREE.Object3D | null>(null)
  const moveKeys = useRef<MoveKeys>(clearedMoveKeys())
  const cameraKeys = useRef<CameraKeys>(clearedCameraKeys())
  const onWheel = useRef<(deltaY: number) => void>(() => { })

  const setKey = (code: string, pressed: boolean) => {
    const move = moveKeys.current
    const camera = cameraKeys.current
    if (code === 'ArrowUp') move.up = pressed
    if (code === 'ArrowDown') move.down = pressed
    if (code === 'ArrowLeft') move.left = pressed
    if (code === 'ArrowRight') move.right = pressed
    if (code === 'KeyA') camera.a = pressed
    if (code === 'KeyD') camera.d = pressed
    if (code === 'KeyW') camera.w = pressed
    if (code === 'KeyS') camera.s = pressed
  }

  return (
    <div
      autoFocus
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.code.startsWith('Arrow')) event.preventDefault()
        setKey(event.code, true)
      }}
      onKeyUp={(event) => setKey(event.code, false)}
      onBlur={() => {
        moveKeys.current = clearedMoveKeys()
        cameraKeys.current = clearedCameraKeys()
      }}
      onPointerDown={(event) => event.currentTarget.focus()}
      onWheel={(event) => onWheel.current(event.deltaY)}
      style={{ position: 'fixed', inset: 0, outline: 'none' }}
    >
      <Canvas camera={{ position: [...INITIAL_CAMERA_POSITION], fov: 50 }}>
        <color attach="background" args={['#87ceeb']} />
        <ambientLight intensity={1.8} />
        <directionalLight position={[10, 20, 10]} intensity={10} />
        <CameraControls playerPos={playerPos} keys={cameraKeys} onWheel={onWheel} />
        <CharacterPlayer playerPos={playerPos} terrainRef={terrainRef} keys={moveKeys} />
        <Terrain terrainRef={terrainRef} />
      </Canvas>
    </div>
  )
}

useGLTF.preload(CHARACTER_URL)
useGLTF.preload(TERRAIN_URL)

export default App
