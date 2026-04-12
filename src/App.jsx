import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import './App.css'

function disposeMaterial(material) {
  if (!material) return

  for (const key in material) {
    const value = material[key]
    if (value && value.isTexture) {
      value.dispose()
    }
  }

  material.dispose?.()
}

function disposeObject(object) {
  if (!object) return

  object.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose()

      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => disposeMaterial(mat))
        } else {
          disposeMaterial(child.material)
        }
      }
    }
  })
}

function disposeHelper(helper) {
  if (!helper) return

  helper.geometry?.dispose()

  if (helper.material) {
    if (Array.isArray(helper.material)) {
      helper.material.forEach((mat) => mat.dispose?.())
    } else {
      helper.material.dispose?.()
    }
  }
}

function countMeshes(object) {
  let meshCount = 0

  object.traverse((child) => {
    if (child.isMesh) {
      meshCount += 1
    }
  })

  return meshCount
}

function normalizeObjectToScene(object) {
  const box = new THREE.Box3().setFromObject(object)

  if (box.isEmpty()) {
    throw new Error('Model bounding box is empty.')
  }

  const center = box.getCenter(new THREE.Vector3())

  object.position.x -= center.x
  object.position.z -= center.z
  object.position.y -= box.min.y

  object.updateMatrixWorld(true)

  const updatedBox = new THREE.Box3().setFromObject(object)
  const updatedSize = updatedBox.getSize(new THREE.Vector3())
  const updatedCenter = updatedBox.getCenter(new THREE.Vector3())

  return {
    box: updatedBox,
    size: updatedSize,
    center: updatedCenter,
  }
}

function fitCameraToObject(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object)

  if (box.isEmpty()) {
    throw new Error('Model bounding box is empty.')
  }

  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  const maxDim = Math.max(size.x, size.y, size.z)
  const safeMaxDim = Math.max(maxDim, 1)

  const fov = camera.fov * (Math.PI / 180)
  let cameraDistance = safeMaxDim / (2 * Math.tan(fov / 2))
  cameraDistance *= 1.8

  camera.position.set(
    center.x + cameraDistance,
    center.y + cameraDistance * 0.7,
    center.z + cameraDistance
  )

  camera.near = Math.max(safeMaxDim / 1000, 0.1)
  camera.far = Math.max(safeMaxDim * 30, 20000)
  camera.updateProjectionMatrix()

  controls.target.set(center.x, center.y + size.y * 0.2, center.z)
  controls.update()

  return { box, size, center }
}

function getNiceStep(rawStep) {
  if (rawStep <= 0) return 1

  const exponent = Math.floor(Math.log10(rawStep))
  const magnitude = 10 ** exponent
  const fraction = rawStep / magnitude

  let niceFraction = 1
  if (fraction <= 1) niceFraction = 1
  else if (fraction <= 2) niceFraction = 2
  else if (fraction <= 5) niceFraction = 5
  else niceFraction = 10

  return niceFraction * magnitude
}

function updateAdaptiveGrid(scene, gridHelperRef, centerLinesRef, sizeVec) {
  const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 1)

  // 让 grid 比模型大很多，看起来更舒服
  const targetGridSize = maxDim * 3.2

  // 希望大约 28~36 个 cell，视觉上比较均匀
  const rawCellSize = targetGridSize / 32
  const cellSize = getNiceStep(rawCellSize)

  let gridSize = Math.ceil(targetGridSize / cellSize) * cellSize
  gridSize = Math.max(gridSize, cellSize * 10)

  let divisions = Math.round(gridSize / cellSize)
  divisions = Math.max(divisions, 1)

  if (gridHelperRef.current) {
    scene.remove(gridHelperRef.current)
    disposeHelper(gridHelperRef.current)
    gridHelperRef.current = null
  }

  if (centerLinesRef.current) {
    scene.remove(centerLinesRef.current)
    disposeHelper(centerLinesRef.current)
    centerLinesRef.current = null
  }

  const grid = new THREE.GridHelper(
    gridSize,
    divisions,
    0x8a8a8a,
    0xd7d7d7
  )
  grid.position.set(0, 0, 0)
  scene.add(grid)
  gridHelperRef.current = grid

  // 再加一个中心十字线，主轴更明显
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x666666 })

  const half = gridSize / 2
  const points = [
    new THREE.Vector3(-half, 0.001, 0),
    new THREE.Vector3(half, 0.001, 0),
    new THREE.Vector3(0, 0.001, -half),
    new THREE.Vector3(0, 0.001, half),
  ]

  const centerGeometry = new THREE.BufferGeometry().setFromPoints(points)
  const centerLines = new THREE.LineSegments(centerGeometry, lineMaterial)
  scene.add(centerLines)
  centerLinesRef.current = centerLines

  return {
    size: gridSize,
    cellSize,
    divisions,
  }
}

function createTextureMap(files) {
  const textureMap = new Map()

  files.forEach((file) => {
    const lower = file.name.toLowerCase()

    if (
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.png') ||
      lower.endsWith('.bmp') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.webp')
    ) {
      textureMap.set(file.name, file)
      textureMap.set(file.name.toLowerCase(), file)
    }
  })

  return textureMap
}

async function loadObjWithOptionalMtl(files) {
  const objFile = files.find((file) => file.name.toLowerCase().endsWith('.obj'))
  const mtlFile = files.find((file) => file.name.toLowerCase().endsWith('.mtl'))

  if (!objFile) {
    throw new Error('Please select an OBJ file.')
  }

  const objText = await objFile.text()
  const textureMap = createTextureMap(files)

  const loadingManager = new THREE.LoadingManager()
  const createdObjectUrls = []

  loadingManager.setURLModifier((url) => {
    const normalized = url.split('/').pop()

    const textureFile =
      textureMap.get(url) ||
      textureMap.get(url.toLowerCase()) ||
      textureMap.get(normalized) ||
      textureMap.get(normalized?.toLowerCase())

    if (textureFile) {
      const objectUrl = URL.createObjectURL(textureFile)
      createdObjectUrls.push(objectUrl)
      return objectUrl
    }

    return url
  })

  let materials = null
  let hasMtl = false

  if (mtlFile) {
    let mtlText = await mtlFile.text()

    // 修正某些 mtl 导出成完全透明
    mtlText = mtlText.replace(/^Tr\s+1(\.0+)?$/gm, 'Tr 0.000000')

    const mtlLoader = new MTLLoader(loadingManager)
    materials = mtlLoader.parse(mtlText)
    materials.preload()
    hasMtl = true
  }

  const objLoader = new OBJLoader(loadingManager)

  if (materials) {
    objLoader.setMaterials(materials)
  }

  const object = objLoader.parse(objText)

  object.traverse((child) => {
    if (!child.isMesh) return

    child.castShadow = true
    child.receiveShadow = true

    if (!child.material) {
      child.material = new THREE.MeshStandardMaterial({
        color: 0x4f86f7,
      })
    }

    const applyMaterialFix = (mat) => {
      if (!mat) return
      mat.side = THREE.DoubleSide
      mat.transparent = false
      mat.opacity = 1
      mat.needsUpdate = true
    }

    if (Array.isArray(child.material)) {
      child.material.forEach(applyMaterialFix)
    } else {
      applyMaterialFix(child.material)
    }
  })

  return {
    object,
    objFile,
    hasMtl,
    textureCount: textureMap.size / 2,
    cleanupUrls: () => {
      createdObjectUrls.forEach((url) => URL.revokeObjectURL(url))
    },
  }
}

function App() {
  const mountRef = useRef(null)

  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const controlsRef = useRef(null)

  const modelRef = useRef(null)
  const gridHelperRef = useRef(null)
  const centerLinesRef = useRef(null)
  const axesHelperRef = useRef(null)
  const boxHelperRef = useRef(null)
  const animationFrameRef = useRef(null)
  const modelCleanupRef = useRef(null)

  const [statusText, setStatusText] = useState('Ready')
  const [modelInfo, setModelInfo] = useState({
    fileName: '-',
    hasMtl: false,
    textureCount: 0,
    meshCount: 0,
    width: 0,
    height: 0,
    depth: 0,
  })

  const [gridInfo, setGridInfo] = useState({
    size: 20,
    cellSize: 1,
    divisions: 20,
  })

  useEffect(() => {
    const mountEl = mountRef.current
    if (!mountEl) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xe8e8e8)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      60,
      mountEl.clientWidth / mountEl.clientHeight,
      0.1,
      5000
    )
    camera.position.set(8, 6, 8)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mountEl.clientWidth, mountEl.clientHeight)
    renderer.shadowMap.enabled = true
    mountEl.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.DOLLY,
    }
    controls.target.set(0, 1, 0)
    controls.update()
    controlsRef.current = controls

    const initialGrid = new THREE.GridHelper(40, 20, 0x8a8a8a, 0xd7d7d7)
    scene.add(initialGrid)
    gridHelperRef.current = initialGrid

    const initialCenterMaterial = new THREE.LineBasicMaterial({ color: 0x666666 })
    const initialCenterPoints = [
      new THREE.Vector3(-20, 0.001, 0),
      new THREE.Vector3(20, 0.001, 0),
      new THREE.Vector3(0, 0.001, -20),
      new THREE.Vector3(0, 0.001, 20),
    ]
    const initialCenterGeometry = new THREE.BufferGeometry().setFromPoints(initialCenterPoints)
    const initialCenterLines = new THREE.LineSegments(initialCenterGeometry, initialCenterMaterial)
    scene.add(initialCenterLines)
    centerLinesRef.current = initialCenterLines

    const axesHelper = new THREE.AxesHelper(300)
    scene.add(axesHelper)
    axesHelperRef.current = axesHelper

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.25)
    directionalLight.position.set(10, 12, 8)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) return

      const width = mountRef.current.clientWidth
      const height = mountRef.current.clientHeight

      cameraRef.current.aspect = width / height
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(width, height)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      if (modelCleanupRef.current) {
        modelCleanupRef.current()
        modelCleanupRef.current = null
      }

      if (modelRef.current) {
        scene.remove(modelRef.current)
        disposeObject(modelRef.current)
        modelRef.current = null
      }

      if (boxHelperRef.current) {
        scene.remove(boxHelperRef.current)
        disposeHelper(boxHelperRef.current)
        boxHelperRef.current = null
      }

      if (centerLinesRef.current) {
        scene.remove(centerLinesRef.current)
        disposeHelper(centerLinesRef.current)
        centerLinesRef.current = null
      }

      if (axesHelperRef.current) {
        scene.remove(axesHelperRef.current)
        axesHelperRef.current = null
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
    }
  }, [])

  const clearCurrentModel = () => {
    const scene = sceneRef.current
    if (!scene) return

    if (modelCleanupRef.current) {
      modelCleanupRef.current()
      modelCleanupRef.current = null
    }

    if (modelRef.current) {
      scene.remove(modelRef.current)
      disposeObject(modelRef.current)
      modelRef.current = null
    }

    if (boxHelperRef.current) {
      scene.remove(boxHelperRef.current)
      disposeHelper(boxHelperRef.current)
      boxHelperRef.current = null
    }
  }

  const handleFilesChange = async (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return

    const scene = sceneRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current

    if (!scene || !camera || !controls) return

    try {
      setStatusText('Loading files...')
      clearCurrentModel()

      const result = await loadObjWithOptionalMtl(files)
      const loadedObject = result.object
      const meshCount = countMeshes(loadedObject)

      if (meshCount === 0) {
        throw new Error('OBJ loaded, but no mesh was found.')
      }

      scene.add(loadedObject)
      modelRef.current = loadedObject
      modelCleanupRef.current = result.cleanupUrls

      const beforeBox = new THREE.Box3().setFromObject(loadedObject)
      console.log('bounding box before normalize =', beforeBox)

      if (beforeBox.isEmpty()) {
        throw new Error('OBJ loaded, but bounding box is empty.')
      }

      const normalizedResult = normalizeObjectToScene(loadedObject)
      console.log('bounding box after normalize =', normalizedResult.box)

      if (boxHelperRef.current) {
        scene.remove(boxHelperRef.current)
        disposeHelper(boxHelperRef.current)
        boxHelperRef.current = null
      }

      const boxHelper = new THREE.BoxHelper(loadedObject, 0xff6a00)
      scene.add(boxHelper)
      boxHelperRef.current = boxHelper

      const fitResult = fitCameraToObject(camera, controls, loadedObject)
      console.log('fit size =', fitResult.size)

      const nextGridInfo = updateAdaptiveGrid(
        scene,
        gridHelperRef,
        centerLinesRef,
        fitResult.size
      )
      if (nextGridInfo) {
        setGridInfo(nextGridInfo)
      }

      setModelInfo({
        fileName: result.objFile.name,
        hasMtl: result.hasMtl,
        textureCount: result.textureCount,
        meshCount,
        width: fitResult.size.x,
        height: fitResult.size.y,
        depth: fitResult.size.z,
      })

      setStatusText(`Loaded: ${result.objFile.name}`)
    } catch (error) {
      console.error(error)
      setStatusText(error.message || 'Failed to load model.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="titleBlock">
          <h1>OBJ Inspector Demo</h1>
          <p>Upload OBJ + MTL + texture files</p>
        </div>
      </header>

      <div className="mainLayout">
        <aside className="sidePanel">
          <section className="panelCard">
            <h2>Upload</h2>

            <label className="uploadButton">
              Select Model Files
              <input
                type="file"
                multiple
                accept=".obj,.mtl,.png,.jpg,.jpeg,.bmp,.gif,.webp"
                onChange={handleFilesChange}
              />
            </label>

            <p className="hintText">
              Select the OBJ file, and also include the matching MTL and texture
              files if the model uses materials.
            </p>
          </section>

          <section className="panelCard">
            <h2>Status</h2>
            <p>{statusText}</p>
          </section>

          <section className="panelCard">
            <h2>Model Info</h2>

            <div className="infoRow">
              <span>File Name</span>
              <span>{modelInfo.fileName}</span>
            </div>

            <div className="infoRow">
              <span>MTL Found</span>
              <span>{modelInfo.hasMtl ? 'Yes' : 'No'}</span>
            </div>

            <div className="infoRow">
              <span>Texture Count</span>
              <span>{modelInfo.textureCount}</span>
            </div>

            <div className="infoRow">
              <span>Mesh Count</span>
              <span>{modelInfo.meshCount}</span>
            </div>

            <div className="infoRow">
              <span>Width</span>
              <span>{modelInfo.width.toFixed(2)}</span>
            </div>

            <div className="infoRow">
              <span>Height</span>
              <span>{modelInfo.height.toFixed(2)}</span>
            </div>

            <div className="infoRow">
              <span>Depth</span>
              <span>{modelInfo.depth.toFixed(2)}</span>
            </div>
          </section>

          <section className="panelCard">
            <h2>Grid</h2>

            <div className="infoRow">
              <span>Grid Size</span>
              <span>{gridInfo.size}</span>
            </div>

            <div className="infoRow">
              <span>Cell Size</span>
              <span>{gridInfo.cellSize}</span>
            </div>

            <div className="infoRow">
              <span>Divisions</span>
              <span>{gridInfo.divisions}</span>
            </div>
          </section>
        </aside>

        <main className="viewerArea">
          <div ref={mountRef} className="viewerCanvas" />
        </main>
      </div>
    </div>
  )
}

export default App