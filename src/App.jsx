import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

function App() {
  const mountRef = useRef(null)

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
    const gridHelper = new THREE.GridHelper(20, 20)
    scene.add(gridHelper)

    const axesHelper = new THREE.AxesHelper(5)
    scene.add(axesHelper)

    // 5. lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(10, 10, 10)
    scene.add(directionalLight)

    // 6. test mesh
    const geometry = new THREE.BoxGeometry(2, 2, 2)
    const material = new THREE.MeshStandardMaterial({ color: 0x4f86f7 })
    const cube = new THREE.Mesh(geometry, material)
    cube.position.y = 1
    scene.add(cube)

    const wireframe = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x111111 })
    )
    wireframe.position.copy(cube.position)
    scene.add(wireframe)

    // 7. animate
      const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      requestAnimationFrame(animate)
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
      controls.dispose()
      geometry.dispose()
      material.dispose()
      wireframe.geometry.dispose()
      wireframe.material.dispose()
      renderer.dispose()

      if (renderer.domElement && mountEl.contains(renderer.domElement)) {
        mountEl.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div className="app">
      <div className="topBar">Three.js OBJ Inspector Demo</div>
      <div className="viewerWrapper">
        <div ref={mountRef} className="viewer" />
      </div>
    </div>
  )
}

export default App