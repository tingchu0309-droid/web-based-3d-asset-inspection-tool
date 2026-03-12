import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import './App.css'

function disposeObject(rootObject) {
  rootObject.traverse((child) => {
    if (!child.isMesh) return

    child.geometry?.dispose()

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.())
      return
    }

    child.material?.dispose?.()
  })
}

function disposeHelper(helperObject) {
  if (!helperObject) return

  helperObject.geometry?.dispose?.()

  if (Array.isArray(helperObject.material)) {
    helperObject.material.forEach((material) => material.dispose?.())
    return
  }

  helperObject.material?.dispose?.()
}

function getNiceGridSize(value) {
  const safeValue = Math.max(1, value)
  const magnitude = 10 ** Math.floor(Math.log10(safeValue))
  const normalized = safeValue / magnitude

  if (normalized <= 1) return 1 * magnitude
  if (normalized <= 2) return 2 * magnitude
  if (normalized <= 5) return 5 * magnitude
  return 10 * magnitude
}

function fitModelToGroundAndCamera(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z)

  object.position.x -= center.x
  object.position.z -= center.z
  object.position.y -= box.min.y

  const alignedBox = new THREE.Box3().setFromObject(object)
  const alignedSize = alignedBox.getSize(new THREE.Vector3())
  const alignedCenter = alignedBox.getCenter(new THREE.Vector3())

  const fov = THREE.MathUtils.degToRad(camera.fov)
  const distance = Math.max(2, (maxDimension / (2 * Math.tan(fov / 2))) * 1.5)

  camera.near = Math.max(0.01, distance / 100)
  camera.far = Math.max(1000, distance * 100)
  camera.position.set(distance, Math.max(distance * 0.8, alignedSize.y * 1.2), distance)
  camera.updateProjectionMatrix()

  controls.target.set(0, alignedCenter.y, 0)
  controls.update()

  return {
    size: alignedSize,
    center: alignedCenter,
  }
}

function updateAdaptiveGrid(scene, gridHelperRef, modelSize) {
  const footprint = Math.max(modelSize.x, modelSize.z)
  const desiredGridSize = Math.max(20, footprint * 1.6)
  const gridSize = getNiceGridSize(desiredGridSize)
  const divisions = 20

  if (gridHelperRef.current) {
    scene.remove(gridHelperRef.current)
    disposeHelper(gridHelperRef.current)
  }

  const nextGridHelper = new THREE.GridHelper(gridSize, divisions, 0x666666, 0x999999)
  scene.add(nextGridHelper)
  gridHelperRef.current = nextGridHelper

  return {
    size: gridSize,
    divisions,
    cellSize: gridSize / divisions,
  }
}

function App() {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const controlsRef = useRef(null)
  const currentModelRef = useRef(null)
  const gridHelperRef = useRef(null)
  const loadTokenRef = useRef(0)

  const [modelFile, setModelFile] = useState(null)
  const [statusText, setStatusText] = useState('未加载模型，请上传 OBJ / GLTF / GLB / STL 文件')
  const [gridInfo, setGridInfo] = useState({ size: 20, divisions: 20, cellSize: 1 })

  useEffect(() => {
    return () => {
      if (modelFile?.url?.startsWith('blob:')) {
        URL.revokeObjectURL(modelFile.url)
      }
    }
  }, [modelFile])

  function handleFileChange(event) {
    const nextFile = event.target.files?.[0]
    if (!nextFile) return

    const extension = nextFile.name.split('.').pop()?.toLowerCase()
    const isSupported = extension === 'obj' || extension === 'gltf' || extension === 'glb' || extension === 'stl'

    if (!isSupported) {
      setStatusText('仅支持 OBJ / GLTF / GLB / STL 文件')
      event.target.value = ''
      return
    }

    setModelFile((previousFile) => {
      if (previousFile?.url?.startsWith('blob:')) {
        URL.revokeObjectURL(previousFile.url)
      }

      return {
        name: nextFile.name,
        url: URL.createObjectURL(nextFile),
      }
    })

    event.target.value = ''
  }

  useEffect(() => {
    const mountEl = mountRef.current
    if (!mountEl) return

    // 1. scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf5f5f5)

    // 2. camera
    const camera = new THREE.PerspectiveCamera(
      60,
      mountEl.clientWidth / mountEl.clientHeight,
      0.1,
      1000
    )
    camera.position.set(8, 6, 8)
    camera.lookAt(0, 0, 0)

    // 3. renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mountEl.clientWidth, mountEl.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mountEl.appendChild(renderer.domElement)
        
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: null,
    }
    controls.target.set(0, 1, 0)
    controls.update()

    // 4. helpers
    const initialGridHelper = new THREE.GridHelper(20, 20, 0x666666, 0x999999)
    scene.add(initialGridHelper)
    gridHelperRef.current = initialGridHelper

    const axesHelper = new THREE.AxesHelper(5)
    scene.add(axesHelper)

    // 5. lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(10, 10, 10)
    scene.add(directionalLight)

    sceneRef.current = scene
    cameraRef.current = camera
    controlsRef.current = controls

    // 7. animate
    let animationId
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      animationId = requestAnimationFrame(animate)
    }
    animate()

    // 8. resize
    const handleResize = () => {
      if (!mountRef.current) return

      const width = mountRef.current.clientWidth
      const height = mountRef.current.clientHeight

      camera.aspect = width / height
      camera.updateProjectionMatrix()

      renderer.setSize(width, height)
    }

    window.addEventListener('resize', handleResize)

    // 9. cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationId)

      if (currentModelRef.current) {
        scene.remove(currentModelRef.current)
        disposeObject(currentModelRef.current)
        currentModelRef.current = null
      }

      if (gridHelperRef.current) {
        scene.remove(gridHelperRef.current)
        disposeHelper(gridHelperRef.current)
        gridHelperRef.current = null
      }

      controls.dispose()
      renderer.dispose()

      if (renderer.domElement && mountEl.contains(renderer.domElement)) {
        mountEl.removeChild(renderer.domElement)
      }

      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
    }
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current

    if (!scene || !camera || !controls) return

    loadTokenRef.current += 1
    const loadToken = loadTokenRef.current

    if (currentModelRef.current) {
      scene.remove(currentModelRef.current)
      disposeObject(currentModelRef.current)
      currentModelRef.current = null
    }

    if (!modelFile?.url) {
      setStatusText('未加载模型，请上传 OBJ / GLTF / GLB / STL 文件')
      setGridInfo({ size: 20, divisions: 20, cellSize: 1 })
      return
    }

    const extension = modelFile.name.split('.').pop()?.toLowerCase()
    setStatusText(`正在加载: ${modelFile.name}`)

    const onLoadComplete = (loadedObject) => {
      if (loadToken !== loadTokenRef.current) {
        disposeObject(loadedObject)
        return
      }

      scene.add(loadedObject)
      currentModelRef.current = loadedObject
      const fitResult = fitModelToGroundAndCamera(camera, controls, loadedObject)
      const nextGridInfo = updateAdaptiveGrid(scene, gridHelperRef, fitResult.size)
      setGridInfo(nextGridInfo)
      setStatusText(`加载成功: ${modelFile.name}`)
    }

    const onError = () => {
      if (loadToken !== loadTokenRef.current) return
      setStatusText(`加载失败: ${modelFile.name}`)
    }

    if (extension === 'obj') {
      const objLoader = new OBJLoader()
      objLoader.load(
        modelFile.url,
        (obj) => {
          obj.traverse((child) => {
            if (!child.isMesh || child.material) return
            child.material = new THREE.MeshStandardMaterial({ color: 0xb0b7c3 })
          })
          onLoadComplete(obj)
        },
        undefined,
        onError,
      )

      return
    }

    if (extension === 'gltf' || extension === 'glb') {
      const gltfLoader = new GLTFLoader()
      gltfLoader.load(
        modelFile.url,
        (gltf) => {
          onLoadComplete(gltf.scene)
        },
        undefined,
        onError,
      )

      return
    }

    if (extension === 'stl') {
      const stlLoader = new STLLoader()
      stlLoader.load(
        modelFile.url,
        (geometry) => {
          geometry.computeVertexNormals()
          const material = new THREE.MeshStandardMaterial({ color: 0xb0b7c3 })
          const mesh = new THREE.Mesh(geometry, material)
          onLoadComplete(mesh)
        },
        undefined,
        onError,
      )

      return
    }

    setStatusText(`不支持的文件格式: ${modelFile.name}`)
  }, [modelFile])

  return (
    <div className="app">
      <div className="topBar">Three.js OBJ Inspector Demo</div>

      <div className="mainContent">
        <div className="viewerWrapper">
          <div ref={mountRef} className="viewer" />
          <div className="gridBadge">
            Grid: {gridInfo.size} × {gridInfo.size} | Cell: {gridInfo.cellSize}
          </div>
        </div>

        <div className="sidePanel">
          <h2>Model Info</h2>
          <label className="uploadLabel" htmlFor="model-upload">
            Upload Model
          </label>
          <input
            id="model-upload"
            className="uploadInput"
            type="file"
            accept=".obj,.gltf,.glb,.stl"
            onChange={handleFileChange}
          />
          <p>Status: {statusText}</p>
          <p>Current File: {modelFile?.name || 'None'}</p>
          <p>Grid Size: {gridInfo.size} × {gridInfo.size}</p>
          <p>Cell Size: {gridInfo.cellSize}</p>
        </div>
      </div>
    </div>
  )
}

export default App