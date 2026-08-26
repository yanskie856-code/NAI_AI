// --- THREE.JS SCENE STATE ---
  let scene, camera, renderer, mascotGroup, headGroup, bodyGroup, dynamicHairStrands = [];
  let armLeftGroup, armRightGroup, legLeftGroup, legRightGroup, ribbonLeft, ribbonRight, drawstringL, drawstringR;
  let eyeLeft, eyeRight, irisL, irisR, highlightL1, highlightR1, highlightL2, highlightR2;
  let eyebrowL, eyebrowR, lashLGroup, lashRGroup, mouthMesh, tongueMesh, emblemMat, platformMat;
  let targetHeadX = 0, targetHeadY = 0;
  let isChatOpen = false;

  // Track cursor position relative to NAI's actual canvas center
  let normCursorX = 0, normCursorY = 0;

  // --- SECONDARY PHYSICS INERTIA VARS ---
  const hairPhysicsState = [];
  let drawstringRotL = -0.1, drawstringRotR = 0.1;
  let ribbonRotL = 0, ribbonRotR = 0;

  // --- SMOOTH EXPRESSION STATE ENGINE ---
  let currentExpression = 'neutral';
  let expressionTimer = 0;

  const faceTargets = {
    eyeScaleY: 1.3,
    eyeScaleX: 0.9,
    eyebrowY: 0.0,
    eyebrowRotZ: 0.0,
    mouthScaleX: 1.0,
    mouthScaleY: 1.0,
    mouthScaleZ: 1.0,
    tongueY: -0.02
  };

  const faceCurrent = { ...faceTargets };

  const raycaster = new THREE.Raycaster();
  const mouseVec = new THREE.Vector2();

  let actionAngleX = 0, actionAngleZ = 0, actionArmWave = 0, actionHop = 0;

  // Frame-rate independent exponential smooth damping
  function damp(current, target, lambda, delta) {
    return THREE.MathUtils.damp(current, target, lambda, delta);
  }

  // PROCEDURAL REALISTIC HAIR STRAND GENERATOR
  function createRealisticHairStrand(hairMaterial, points, radiusStart = 0.045, radiusEnd = 0.005) {
    const curve = new THREE.CatmullRomCurve3(points);
    const segments = points.length * 8;
    const geometry = new THREE.BufferGeometry();
    const positions = [], uvs = [], normals = [];
    const frames = curve.computeFrenetFrames(segments, false);

    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const point = curve.getPointAt(u);
      const radius = radiusStart * (1 - u) + radiusEnd * u;
      const normal = frames.normals[i];
      const binormal = frames.binormals[i];

      for (let j = 0; j <= 8; j++) {
        const theta = (j / 8) * Math.PI * 2;
        const rx = Math.cos(theta) * radius * 1.8;
        const ry = Math.sin(theta) * radius * 0.7;

        const x = point.x + (normal.x * rx + binormal.x * ry);
        const y = point.y + (normal.y * rx + binormal.y * ry);
        const z = point.z + (normal.z * rx + binormal.z * ry);

        positions.push(x, y, z);
        uvs.push(j / 8, u);
        
        const nx = normal.x * Math.cos(theta) + binormal.x * Math.sin(theta);
        const ny = normal.y * Math.cos(theta) + binormal.y * Math.sin(theta);
        const nz = normal.z * Math.cos(theta) + binormal.z * Math.sin(theta);
        normals.push(nx, ny, nz);
      }
    }

    const indices = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < 8; j++) {
        const a = i * 9 + j, b = (i + 1) * 9 + j, c = (i + 1) * 9 + (j + 1), d = i * 9 + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }

    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

    return new THREE.Mesh(geometry, hairMaterial);
  }

  function createHairTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#807299';
    ctx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512, y = Math.random() * 512;
      const len = 30 + Math.random() * 120, alpha = 0.05 + Math.random() * 0.12;
      ctx.strokeStyle = Math.random() > 0.4 ? `rgba(235, 220, 255, ${alpha})` : `rgba(45, 30, 65, ${alpha})`;
      ctx.lineWidth = 0.8 + Math.random() * 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 2, y + len); ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 2);
    return texture;
  }

  function createClothTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#4c1d95'; ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 256; i += 4) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(i, 0, 2, 256);
      ctx.fillRect(0, i, 256, 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  function initMascotDetailed() {
    const container = document.getElementById('hd-mascot-canvas');
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 1000);
    camera.position.set(0, 0.05, 4.2);

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    container.appendChild(renderer.domElement);

    const hairTex = createHairTexture();
    const clothTex = createClothTexture();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xf3e8ff, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff1f2, 2.4);
    keyLight.position.set(3, 4, 4);
    scene.add(keyLight);

    const hairRimLight = new THREE.DirectionalLight(0xe9d5ff, 4.5);
    hairRimLight.position.set(0, 4, -3);
    scene.add(hairRimLight);

    const rimLightCyan = new THREE.DirectionalLight(0x38bdf8, 2.5);
    rimLightCyan.position.set(3.5, -2, -2);
    scene.add(rimLightCyan);

    mascotGroup = new THREE.Group();

    // Materials
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe4e1, roughness: 0.38 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x9383a8, map: hairTex, roughness: 0.25, metalness: 0.12, bumpMap: hairTex, bumpScale: 0.008 });
    const facialFeatureMat = new THREE.MeshBasicMaterial({ color: 0x2e1065 });
    const eyebrowMat = new THREE.MeshBasicMaterial({ color: 0x6b5b85 });
    const tongueMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    const hoodieMat = new THREE.MeshStandardMaterial({ color: 0x5b21b6, map: clothTex, roughness: 0.7, bumpMap: clothTex, bumpScale: 0.01 });
    const hoodieTrimMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.5 });
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x2e1065, roughness: 0.6 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.3, metalness: 0.2 });
    const soleMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.2 });
    const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.3 });
    const stringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xf3e8ff, metalness: 0.8, roughness: 0.2 });

    const eyeBaseMat = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.1, metalness: 0.5 });
    const irisGradientMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });
    const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const blushMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.55 });
    const mouthBgMat = new THREE.MeshBasicMaterial({ color: 0x881337 });

    emblemMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xdb2777, emissiveIntensity: 1.5, roughness: 0.1 });
    platformMat = new THREE.MeshPhysicalMaterial({ color: 0xf472b6, transmission: 0.92, opacity: 1, transparent: true, roughness: 0.05, ior: 1.45 });

    // Platform
    const platGeo = new THREE.CylinderGeometry(0.85, 0.7, 0.12, 64);
    const platMesh = new THREE.Mesh(platGeo, platformMat);
    platMesh.position.set(0, -1.05, 0);
    mascotGroup.add(platMesh);

    // Body
    bodyGroup = new THREE.Group();
    const torsoGeo = new THREE.CylinderGeometry(0.28, 0.36, 0.46, 32);
    const torsoMesh = new THREE.Mesh(torsoGeo, hoodieMat);
    torsoMesh.position.set(0, -0.42, 0);
    bodyGroup.add(torsoMesh);

    const ribbingGeo = new THREE.TorusGeometry(0.36, 0.035, 16, 32);
    const ribbingMesh = new THREE.Mesh(ribbingGeo, hoodieTrimMat);
    ribbingMesh.rotation.x = Math.PI / 2;
    ribbingMesh.position.set(0, -0.63, 0);
    bodyGroup.add(ribbingMesh);

    const hoodBackGeo = new THREE.SphereGeometry(0.42, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const hoodBackMesh = new THREE.Mesh(hoodBackGeo, hoodieMat);
    hoodBackMesh.position.set(0, -0.15, -0.15);
    hoodBackMesh.rotation.x = -0.4;
    bodyGroup.add(hoodBackMesh);

    const collarRimGeo = new THREE.TorusGeometry(0.32, 0.045, 16, 32);
    const collarRimMesh = new THREE.Mesh(collarRimGeo, hoodieTrimMat);
    collarRimMesh.rotation.x = Math.PI / 2.3;
    collarRimMesh.position.set(0, -0.22, 0.05);
    bodyGroup.add(collarRimMesh);

    const pocketGeo = new THREE.CylinderGeometry(0.32, 0.35, 0.18, 16, 1, false, -Math.PI * 0.35, Math.PI * 0.7);
    const pocketMesh = new THREE.Mesh(pocketGeo, hoodieTrimMat);
    pocketMesh.position.set(0, -0.5, 0.03);
    bodyGroup.add(pocketMesh);

    const drawstringGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 12);
    const agletGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.04, 12);

    drawstringL = new THREE.Group();
    const stringL = new THREE.Mesh(drawstringGeo, stringMat);
    const agletL = new THREE.Mesh(agletGeo, metalMat);
    agletL.position.y = -0.14;
    drawstringL.add(stringL, agletL);
    drawstringL.position.set(-0.1, -0.32, 0.3);
    drawstringL.rotation.z = -0.1;

    drawstringR = new THREE.Group();
    const stringR = new THREE.Mesh(drawstringGeo, stringMat);
    const agletR = new THREE.Mesh(agletGeo, metalMat);
    agletR.position.y = -0.14;
    drawstringR.add(stringR, agletR);
    drawstringR.position.set(0.1, -0.32, 0.3);
    drawstringR.rotation.z = 0.1;

    bodyGroup.add(drawstringL, drawstringR);

    const emblemGeo = new THREE.OctahedronGeometry(0.08, 2);
    const emblemMesh = new THREE.Mesh(emblemGeo, emblemMat);
    emblemMesh.scale.set(1.1, 1.1, 0.4);
    emblemMesh.position.set(0, -0.34, 0.31);
    bodyGroup.add(emblemMesh);

    const skirtGroup = new THREE.Group();
    const pleatCount = 12;
    for (let i = 0; i < pleatCount; i++) {
      const angle = (i / pleatCount) * Math.PI * 2;
      const pleatGeo = new THREE.ConeGeometry(0.08, 0.2, 4);
      const pleat = new THREE.Mesh(pleatGeo, skirtMat);
      pleat.position.set(Math.cos(angle) * 0.34, -0.71, Math.sin(angle) * 0.34);
      pleat.rotation.y = -angle;
      pleat.rotation.z = 0.25;
      skirtGroup.add(pleat);
    }
    bodyGroup.add(skirtGroup);

    const bowCenterGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const bowCenter = new THREE.Mesh(bowCenterGeo, ribbonMat);
    bowCenter.position.set(0, -0.62, -0.36);
    
    const bowWingGeo = new THREE.ConeGeometry(0.12, 0.22, 16);
    const bowWingL = new THREE.Mesh(bowWingGeo, ribbonMat);
    bowWingL.rotation.z = Math.PI / 2.5;
    bowWingL.position.set(-0.14, -0.62, -0.36);
    const bowWingR = bowWingL.clone();
    bowWingR.rotation.z = -Math.PI / 2.5;
    bowWingR.position.x = 0.14;

    bodyGroup.add(bowCenter, bowWingL, bowWingR);

    const ribbonCurveL = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.05, -0.62, -0.36),
      new THREE.Vector3(-0.18, -0.82, -0.38),
      new THREE.Vector3(-0.25, -1.02, -0.32)
    ]);
    ribbonLeft = new THREE.Mesh(new THREE.TubeGeometry(ribbonCurveL, 16, 0.025, 8, false), ribbonMat);

    const ribbonCurveR = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.05, -0.62, -0.36),
      new THREE.Vector3(0.18, -0.82, -0.38),
      new THREE.Vector3(0.25, -1.02, -0.32)
    ]);
    ribbonRight = new THREE.Mesh(new THREE.TubeGeometry(ribbonCurveR, 16, 0.025, 8, false), ribbonMat);

    bodyGroup.add(ribbonLeft, ribbonRight);

    function createArm(isLeft) {
      const armGroup = new THREE.Group();
      const sideMult = isLeft ? -1 : 1;

      const sleeveGeo = new THREE.SphereGeometry(0.13, 20, 20);
      sleeveGeo.scale(1.0, 1.4, 1.0);
      const sleeve = new THREE.Mesh(sleeveGeo, hoodieMat);
      sleeve.position.set(0, -0.12, 0);
      armGroup.add(sleeve);

      const cuffGeo = new THREE.TorusGeometry(0.09, 0.02, 12, 24);
      const cuff = new THREE.Mesh(cuffGeo, hoodieTrimMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, -0.26, 0);
      armGroup.add(cuff);

      const handGeo = new THREE.SphereGeometry(0.08, 16, 16);
      const hand = new THREE.Mesh(handGeo, skinMat);
      hand.position.set(0, -0.33, 0.02);
      armGroup.add(hand);

      armGroup.position.set(sideMult * 0.36, -0.32, 0);
      armGroup.rotation.z = sideMult * -0.2;
      return armGroup;
    }

    armLeftGroup = createArm(true);
    armRightGroup = createArm(false);
    bodyGroup.add(armLeftGroup, armRightGroup);

    function createLeg(isLeft) {
      const legGroup = new THREE.Group();
      const sideMult = isLeft ? -1 : 1;

      const thighGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.16, 16);
      const thigh = new THREE.Mesh(thighGeo, skinMat);
      thigh.position.y = -0.08;
      legGroup.add(thigh);

      const stockingGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.22, 16);
      const stocking = new THREE.Mesh(stockingGeo, skirtMat);
      stocking.position.y = -0.24;
      legGroup.add(stocking);

      const footGroup = new THREE.Group();
      const shoeBaseGeo = new THREE.BoxGeometry(0.12, 0.08, 0.18);
      const shoeBase = new THREE.Mesh(shoeBaseGeo, shoeMat);
      shoeBase.position.set(0, 0, 0.03);

      const toeGeo = new THREE.SphereGeometry(0.065, 16, 16);
      toeGeo.scale(1.0, 0.65, 1.0);
      const toe = new THREE.Mesh(toeGeo, shoeMat);
      toe.position.set(0, -0.01, 0.11);

      const soleGeo = new THREE.BoxGeometry(0.13, 0.02, 0.21);
      const sole = new THREE.Mesh(soleGeo, soleMat);
      sole.position.set(0, -0.045, 0.04);

      const shoeCuffGeo = new THREE.TorusGeometry(0.055, 0.012, 12, 24);
      const shoeCuff = new THREE.Mesh(shoeCuffGeo, ribbonMat);
      shoeCuff.rotation.x = Math.PI / 2;
      shoeCuff.position.set(0, 0.04, 0);

      footGroup.add(shoeBase, toe, sole, shoeCuff);
      footGroup.position.set(0, -0.37, 0.01);
      footGroup.rotation.y = sideMult * 0.15;
      legGroup.add(footGroup);

      legGroup.position.set(sideMult * 0.16, -0.68, 0);
      return legGroup;
    }

    legLeftGroup = createLeg(true);
    legRightGroup = createLeg(false);
    bodyGroup.add(legLeftGroup, legRightGroup);

    mascotGroup.add(bodyGroup);

    // Head and Face
    headGroup = new THREE.Group();
    const headGeo = new THREE.SphereGeometry(0.62, 32, 32);
    headGeo.scale(1.08, 0.92, 0.95);
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headGroup.add(headMesh);

    // Ears
    const earGeo = new THREE.SphereGeometry(0.13, 16, 16);
    earGeo.scale(0.4, 0.9, 0.7);
    const earLeft = new THREE.Mesh(earGeo, skinMat);
    earLeft.position.set(-0.62, -0.02, 0);
    earLeft.rotation.z = 0.2;
    const earRight = earLeft.clone();
    earRight.position.x = 0.62;
    earRight.rotation.z = -0.2;
    headGroup.add(earLeft, earRight);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.16, 24, 24);
    eyeLeft = new THREE.Mesh(eyeGeo, eyeBaseMat);
    eyeLeft.scale.set(0.9, 1.3, 0.25);
    eyeLeft.position.set(-0.24, 0.02, 0.52);
    eyeRight = eyeLeft.clone();
    eyeRight.position.x = 0.24;
    headGroup.add(eyeLeft, eyeRight);

    const irisGeo = new THREE.SphereGeometry(0.12, 20, 20);
    irisL = new THREE.Mesh(irisGeo, irisGradientMat);
    irisL.scale.set(0.8, 1.0, 0.1);
    irisL.position.set(-0.24, -0.02, 0.55);
    irisR = irisL.clone();
    irisR.position.x = 0.24;
    headGroup.add(irisL, irisR);

    const catchlightGeo1 = new THREE.SphereGeometry(0.048, 16, 16);
    highlightL1 = new THREE.Mesh(catchlightGeo1, eyeWhiteMat);
    highlightL1.position.set(-0.21, 0.08, 0.58);
    highlightR1 = highlightL1.clone();
    highlightR1.position.x = 0.27;
    headGroup.add(highlightL1, highlightR1);

    const catchlightGeo2 = new THREE.SphereGeometry(0.022, 12, 12);
    highlightL2 = new THREE.Mesh(catchlightGeo2, eyeWhiteMat);
    highlightL2.position.set(-0.27, -0.04, 0.58);
    highlightR2 = highlightL2.clone();
    highlightR2.position.x = 0.21;
    headGroup.add(highlightL2, highlightR2);

    // Eyelashes
    function createEyelash(isLeft) {
      const lashGroup = new THREE.Group();
      const sideMult = isLeft ? -1 : 1;

      const archCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sideMult * 0.11, 0.14, 0.53),
        new THREE.Vector3(sideMult * 0.24, 0.19, 0.55),
        new THREE.Vector3(sideMult * 0.37, 0.13, 0.52)
      ]);
      const archGeo = new THREE.TubeGeometry(archCurve, 16, 0.015, 8, false);
      const archMesh = new THREE.Mesh(archGeo, facialFeatureMat);
      lashGroup.add(archMesh);

      const wingGeo = new THREE.ConeGeometry(0.02, 0.08, 8);
      const wing = new THREE.Mesh(wingGeo, facialFeatureMat);
      wing.position.set(sideMult * 0.36, 0.16, 0.52);
      wing.rotation.z = sideMult * -0.8;
      wing.rotation.x = -0.2;
      lashGroup.add(wing);

      return lashGroup;
    }

    lashLGroup = createEyelash(true);
    lashRGroup = createEyelash(false);
    headGroup.add(lashLGroup, lashRGroup);

    // Eyebrows
    const eyebrowCurveL = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.13, 0.26, 0.54),
      new THREE.Vector3(-0.24, 0.30, 0.55),
      new THREE.Vector3(-0.35, 0.25, 0.51)
    ]);
    eyebrowL = new THREE.Mesh(new THREE.TubeGeometry(eyebrowCurveL, 12, 0.012, 8, false), eyebrowMat);

    const eyebrowCurveR = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.13, 0.26, 0.54),
      new THREE.Vector3(0.24, 0.30, 0.55),
      new THREE.Vector3(0.35, 0.25, 0.51)
    ]);
    eyebrowR = new THREE.Mesh(new THREE.TubeGeometry(eyebrowCurveR, 12, 0.012, 8, false), eyebrowMat);
    headGroup.add(eyebrowL, eyebrowR);

    // Blush
    const blushGeo = new THREE.CircleGeometry(0.1, 16);
    const blushL = new THREE.Mesh(blushGeo, blushMat);
    blushL.position.set(-0.33, -0.1, 0.55);
    const blushR = blushL.clone();
    blushR.position.x = 0.33;
    headGroup.add(blushL, blushR);

    // Mouth
    mouthMesh = new THREE.Group();
    const mouthBackGeo = new THREE.CylinderGeometry(0.07, 0.01, 0.08, 16);
    mouthBackGeo.rotateX(Math.PI / 2);
    const mouthBack = new THREE.Mesh(mouthBackGeo, mouthBgMat);
    mouthBack.scale.set(1.1, 0.7, 0.8);
    mouthMesh.add(mouthBack);

    const tongueGeo = new THREE.SphereGeometry(0.045, 12, 12);
    tongueMesh = new THREE.Mesh(tongueGeo, tongueMat);
    tongueMesh.position.set(0, -0.02, 0.02);
    tongueMesh.scale.set(1.0, 0.6, 0.8);
    mouthMesh.add(tongueMesh);

    const lipCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.07, 0.025, 0.03),
      new THREE.Vector3(0.0, 0.035, 0.04),
      new THREE.Vector3(0.07, 0.025, 0.03)
    ]);
    const lipMesh = new THREE.Mesh(new THREE.TubeGeometry(lipCurve, 12, 0.007, 8, false), facialFeatureMat);
    mouthMesh.add(lipMesh);

    mouthMesh.position.set(0, -0.16, 0.56);
    headGroup.add(mouthMesh);

    // Hair
    const hairGroup = new THREE.Group();
    const scalpGeo = new THREE.SphereGeometry(0.635, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.58);
    const scalpMesh = new THREE.Mesh(scalpGeo, hairMat);
    scalpMesh.position.set(0, 0.02, -0.01);
    hairGroup.add(scalpMesh);

    const strandConfigs = [
      [ [0.0, 0.58, 0.38], [0.02, 0.44, 0.56], [0.04, 0.32, 0.59] ],
      [ [-0.08, 0.58, 0.36], [-0.12, 0.43, 0.55], [-0.16, 0.31, 0.57] ],
      [ [0.08, 0.58, 0.36], [0.12, 0.43, 0.55], [0.16, 0.31, 0.57] ],
      [ [-0.18, 0.56, 0.34], [-0.25, 0.41, 0.52], [-0.3, 0.28, 0.53] ],
      [ [0.18, 0.56, 0.34], [0.25, 0.41, 0.52], [0.3, 0.28, 0.53] ],
      [ [-0.32, 0.52, 0.32], [-0.48, 0.3, 0.48], [-0.55, 0.02, 0.45], [-0.52, -0.28, 0.32] ],
      [ [-0.26, 0.54, 0.33], [-0.42, 0.32, 0.5], [-0.48, 0.05, 0.47], [-0.44, -0.25, 0.35] ],
      [ [0.32, 0.52, 0.32], [0.48, 0.3, 0.48], [0.55, 0.02, 0.45], [0.52, -0.28, 0.32] ],
      [ [0.26, 0.54, 0.33], [0.42, 0.32, 0.5], [0.48, 0.05, 0.47], [0.44, -0.25, 0.35] ],
      [ [0.0, 0.62, 0.1], [0.0, 0.5, -0.45], [0.0, 0.0, -0.65], [0.0, -0.55, -0.52] ],
      [ [-0.25, 0.6, 0.05], [-0.38, 0.4, -0.48], [-0.45, -0.05, -0.62], [-0.4, -0.52, -0.48] ],
      [ [0.25, 0.6, 0.05], [0.38, 0.4, -0.48], [0.45, -0.05, -0.62], [0.4, -0.52, -0.48] ]
    ];

    strandConfigs.forEach((pts, i) => {
      const vecPoints = pts.map(p => new THREE.Vector3(...p));
      const strand = createRealisticHairStrand(hairMat, vecPoints, 0.05, 0.008);
      hairGroup.add(strand);
      dynamicHairStrands.push({ mesh: strand });
      hairPhysicsState.push({ rotZ: 0, velZ: 0, rotX: 0, velX: 0 });
    });

    headGroup.add(hairGroup);
    headGroup.position.set(0, 0.28, 0);
    mascotGroup.add(headGroup);

    mascotGroup.position.set(0, 0.05, 0);
    scene.add(mascotGroup);

    container.addEventListener('pointerdown', onMascotClick);

    animate();
  }

  function setExpression(expr, duration = 1.8) {
    currentExpression = expr;
    expressionTimer = duration;

    switch (expr) {
      case 'happy':
        faceTargets.eyeScaleY = 0.25;
        faceTargets.eyeScaleX = 1.1;
        faceTargets.eyebrowY = 0.03;
        faceTargets.eyebrowRotZ = -0.12;
        faceTargets.mouthScaleX = 1.6;
        faceTargets.mouthScaleY = 1.5;
        faceTargets.mouthScaleZ = 1.2;
        faceTargets.tongueY = 0.01;
        break;

      case 'surprised':
        faceTargets.eyeScaleY = 1.6;
        faceTargets.eyeScaleX = 1.0;
        faceTargets.eyebrowY = 0.06;
        faceTargets.eyebrowRotZ = 0.05;
        faceTargets.mouthScaleX = 0.8;
        faceTargets.mouthScaleY = 1.8;
        faceTargets.mouthScaleZ = 1.0;
        faceTargets.tongueY = -0.03;
        break;

      case 'talking':
        faceTargets.eyeScaleY = 1.3;
        faceTargets.eyeScaleX = 0.9;
        faceTargets.eyebrowY = 0.02;
        faceTargets.eyebrowRotZ = 0.0;
        faceTargets.mouthScaleX = 1.3;
        faceTargets.mouthScaleY = 1.4;
        faceTargets.mouthScaleZ = 1.1;
        faceTargets.tongueY = 0.0;
        break;

      case 'neutral':
      default:
        faceTargets.eyeScaleY = 1.3;
        faceTargets.eyeScaleX = 0.9;
        faceTargets.eyebrowY = 0.0;
        faceTargets.eyebrowRotZ = 0.0;
        faceTargets.mouthScaleX = 1.0;
        faceTargets.mouthScaleY = 1.0;
        faceTargets.mouthScaleZ = 1.0;
        faceTargets.tongueY = -0.02;
        break;
    }
  }

  function onMascotClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouseVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouseVec, camera);
    const intersects = raycaster.intersectObjects(mascotGroup.children, true);

    if (intersects.length > 0) {
      setExpression('happy', 2.0);
      actionHop = 0.22;
      actionArmWave = 1.5;
      actionAngleZ = (Math.random() - 0.5) * 0.4;
    }
  }

  // --- POSITION-AWARE CURSOR TRACKING ---
  document.addEventListener('mousemove', (e) => {
    if (!isChatOpen) {
      const container = document.getElementById('hd-mascot-canvas');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      
      const mascotCenterX = rect.left + rect.width / 2;
      const mascotCenterY = rect.top + rect.height / 2;

      // Cubic Ease-Out Cursor Sensitivity Mapping
      const rawX = (e.clientX - mascotCenterX) / (window.innerWidth * 0.5);
      const rawY = (e.clientY - mascotCenterY) / (window.innerHeight * 0.5);

      const signX = Math.sign(rawX);
      const signY = Math.sign(rawY);

      normCursorX = signX * Math.pow(Math.min(1.0, Math.abs(rawX)), 0.85);
      normCursorY = signY * Math.pow(Math.min(1.0, Math.abs(rawY)), 0.85);
    }
  });

  function updateExpressionTimer(delta) {
    if (expressionTimer > 0) {
      expressionTimer -= delta;
      if (expressionTimer <= 0 && currentExpression !== 'neutral') {
        setExpression('neutral');
      }
    }
  }

  let clock = new THREE.Clock();
  let prevHeadY = 0, prevHeadX = 0;

  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1); // Cap delta to prevent huge physics spikes
    const time = clock.getElapsedTime();

    updateExpressionTimer(delta);

    // --- FRAME-RATE INDEPENDENT EXPONENTIAL FACIAL LERP ---
    const faceSpeed = 14;
    faceCurrent.eyeScaleY = damp(faceCurrent.eyeScaleY, faceTargets.eyeScaleY, faceSpeed, delta);
    faceCurrent.eyeScaleX = damp(faceCurrent.eyeScaleX, faceTargets.eyeScaleX, faceSpeed, delta);
    faceCurrent.eyebrowY = damp(faceCurrent.eyebrowY, faceTargets.eyebrowY, faceSpeed, delta);
    faceCurrent.eyebrowRotZ = damp(faceCurrent.eyebrowRotZ, faceTargets.eyebrowRotZ, faceSpeed, delta);
    faceCurrent.mouthScaleX = damp(faceCurrent.mouthScaleX, faceTargets.mouthScaleX, faceSpeed, delta);
    faceCurrent.mouthScaleY = damp(faceCurrent.mouthScaleY, faceTargets.mouthScaleY, faceSpeed, delta);
    faceCurrent.mouthScaleZ = damp(faceCurrent.mouthScaleZ, faceTargets.mouthScaleZ, faceSpeed, delta);
    faceCurrent.tongueY = damp(faceCurrent.tongueY, faceTargets.tongueY, faceSpeed, delta);

    if (currentExpression === 'talking') {
      const talkFlutter = Math.sin(time * 18) * 0.25;
      mouthMesh.scale.set(
        faceCurrent.mouthScaleX + talkFlutter * 0.2,
        faceCurrent.mouthScaleY + talkFlutter,
        faceCurrent.mouthScaleZ
      );
    } else {
      mouthMesh.scale.set(faceCurrent.mouthScaleX, faceCurrent.mouthScaleY, faceCurrent.mouthScaleZ);
    }

    eyeLeft.scale.set(faceCurrent.eyeScaleX, faceCurrent.eyeScaleY, 0.25);
    eyeRight.scale.set(faceCurrent.eyeScaleX, faceCurrent.eyeScaleY, 0.25);

    eyebrowL.position.y = faceCurrent.eyebrowY + Math.sin(time * 2.0) * 0.008;
    eyebrowR.position.y = faceCurrent.eyebrowY + Math.sin(time * 2.0) * 0.008;
    eyebrowL.rotation.z = faceCurrent.eyebrowRotZ;
    eyebrowR.rotation.z = -faceCurrent.eyebrowRotZ;

    tongueMesh.position.y = faceCurrent.tongueY;

    // Decay action impulses smoothly
    actionAngleZ = damp(actionAngleZ, 0, 6, delta);
    actionAngleX = damp(actionAngleX, 0, 6, delta);
    actionArmWave = damp(actionArmWave, 0, 7, delta);
    actionHop = damp(actionHop, 0, 8, delta);

    // Layered idle breathing wave
    const breathingOffset = Math.sin(time * 2.2) * 0.03 + Math.cos(time * 1.1) * 0.015;
    mascotGroup.position.y = 0.05 + breathingOffset + actionHop;
    emblemMat.emissiveIntensity = 1.2 + Math.sin(time * 4.0) * 0.5;

    armLeftGroup.rotation.z = -0.2 + Math.sin(time * 2.5) * 0.08 - actionArmWave;
    armRightGroup.rotation.z = 0.2 - Math.sin(time * 2.5) * 0.08;
    armLeftGroup.rotation.x = Math.cos(time * 2.0) * 0.05 + actionArmWave * 0.5;
    armRightGroup.rotation.x = -Math.cos(time * 2.0) * 0.05;

    legLeftGroup.rotation.x = Math.sin(time * 2.5) * 0.04 - actionHop * 0.8;
    legRightGroup.rotation.x = -Math.sin(time * 2.5) * 0.04 - actionHop * 0.8;

    if (isChatOpen) {
      targetHeadX = -0.35;
      targetHeadY = 0.08;
    } else {
      targetHeadX = normCursorX * 0.42 + actionAngleX;
      targetHeadY = normCursorY * 0.22;
    }

    // --- SMOOTH ROTATION DAMPING ---
    headGroup.rotation.y = damp(headGroup.rotation.y, targetHeadX, 7, delta);
    headGroup.rotation.x = damp(headGroup.rotation.x, targetHeadY, 7, delta);
    headGroup.rotation.z = Math.sin(time * 2.0) * 0.02 - headGroup.rotation.y * 0.08 + actionAngleZ;

    bodyGroup.rotation.y = damp(bodyGroup.rotation.y, headGroup.rotation.y * 0.25, 6, delta);

    // --- SECONDARY SPRING PHYSICS FOR DRAWSTRINGS & RIBBONS ---
    const headVelY = (headGroup.rotation.y - prevHeadY) / Math.max(delta, 0.001);
    const headVelX = (headGroup.rotation.x - prevHeadX) / Math.max(delta, 0.001);
    prevHeadY = headGroup.rotation.y;
    prevHeadX = headGroup.rotation.x;

    // Drawstrings Inertia
    const targetDrawRotL = -0.1 + Math.sin(time * 3.5) * 0.04 - headVelY * 0.08;
    const targetDrawRotR = 0.1 - Math.sin(time * 3.5 + 0.5) * 0.04 - headVelY * 0.08;

    drawstringRotL = damp(drawstringRotL, targetDrawRotL, 8, delta);
    drawstringRotR = damp(drawstringRotR, targetDrawRotR, 8, delta);

    drawstringL.rotation.z = drawstringRotL;
    drawstringR.rotation.z = drawstringRotR;

    // Ribbons Inertia
    const targetRibbonL = Math.sin(time * 2.8) * 0.08 - headVelY * 0.12;
    const targetRibbonR = -Math.sin(time * 2.8 + 0.4) * 0.08 - headVelY * 0.12;

    ribbonRotL = damp(ribbonRotL, targetRibbonL, 6, delta);
    ribbonRotR = damp(ribbonRotR, targetRibbonR, 6, delta);

    ribbonLeft.rotation.z = ribbonRotL;
    ribbonRight.rotation.z = ribbonRotR;

    // Hair Inertia Damping Simulation
    dynamicHairStrands.forEach((item, index) => {
      const phys = hairPhysicsState[index];
      const targetStrandZ = Math.sin(time * 3.0 + index) * 0.018 + actionAngleZ * 0.3 - headVelY * 0.02;
      const targetStrandX = Math.cos(time * 2.2 + index) * 0.012 - headVelX * 0.02;

      phys.rotZ = damp(phys.rotZ, targetStrandZ, 9, delta);
      phys.rotX = damp(phys.rotX, targetStrandX, 9, delta);

      item.mesh.rotation.z = phys.rotZ;
      item.mesh.rotation.x = phys.rotX;
    });

    // Pupil and Iris Relative Smooth Eye Tracking
    const targetIrisX = headGroup.rotation.y * 0.08;
    const targetIrisY = headGroup.rotation.x * 0.08;

    const smoothIrisX = damp(irisL.position.x + 0.24, targetIrisX, 12, delta);
    const smoothIrisY = damp(-0.02 - irisL.position.y, targetIrisY, 12, delta);

    irisL.position.x = -0.24 + smoothIrisX;
    irisR.position.x = 0.24 + smoothIrisX;
    irisL.position.y = -0.02 - smoothIrisY;
    irisR.position.y = -0.02 - smoothIrisY;

    highlightL1.position.x = -0.21 + smoothIrisX;
    highlightR1.position.x = 0.27 + smoothIrisX;
    highlightL2.position.x = -0.27 + smoothIrisX;
    highlightR2.position.x = 0.21 + smoothIrisX;

    // Organic Blinking
    if (Math.sin(time * 2.6) > 0.96 && currentExpression !== 'happy') {
      eyeLeft.scale.y = damp(eyeLeft.scale.y, 0.05, 30, delta);
      eyeRight.scale.y = damp(eyeRight.scale.y, 0.05, 30, delta);
      lashLGroup.scale.y = damp(lashLGroup.scale.y, 0.1, 30, delta);
      lashRGroup.scale.y = damp(lashRGroup.scale.y, 0.1, 30, delta);
      irisL.visible = irisR.visible = highlightL1.visible = highlightR1.visible = highlightL2.visible = highlightR2.visible = false;
    } else {
      lashLGroup.scale.y = damp(lashLGroup.scale.y, 1.0, 20, delta);
      lashRGroup.scale.y = damp(lashRGroup.scale.y, 1.0, 20, delta);
      irisL.visible = irisR.visible = highlightL1.visible = highlightR1.visible = highlightL2.visible = highlightR2.visible = true;
    }

    renderer.render(scene, camera);
  }

  // --- NAI KNOWLEDGE SYSTEM ---
  const defaultKnowledge = [
    { keywords: ['hello', 'hi', 'hey', 'start', 'nai'], response: "Yay! Hi friend! I am NAI, your sweet helper assistant! How can I make your day easier?" },
    { keywords: ['fine', 'good', 'great', 'okay', 'well', 'awesome'], response: "That’s wonderful to hear! I’m glad your day is going well. How can I help you today?" },
    { keywords: ['who are you', 'what are you', 'identity'], response: "I'm NAI! Your cute AI companion designed to keep you company and guide you through the system! ✨" },
    { keywords: ['settings', 'config', 'profile'], response: "Looking for settings? You can tap your profile icon right up at the top right corner! ⚙️" },
    { keywords: ['help', 'guide', 'support'], response: "I'm right here for you! You can ask me about updates, system shortcuts, or troubleshooting! 💕" },
    { keywords: ['error', 'bug', 'broken', 'issue'], response: "Oh no! A glitch? Let's check your internet connection or try refreshing to fix it right up!" }
  ];
  const sharedBehaviorKey = 'nai-shared-behavior';
  let sharedBehavior = localStorage.getItem(sharedBehaviorKey) || '';

  function getSharedGreeting() {
    const lines = sharedBehavior.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const exampleIndex = lines.findIndex(line => /^example\s*:/i.test(line));
    if (exampleIndex === -1) return '';
    const response = lines.slice(exampleIndex + 1).find(line => !/^[A-Z][A-Za-z ]+\s*:/i.test(line));
    return response || '';
  }

  function getSharedKnowledge() {
    const greeting = getSharedGreeting();
    return greeting
      ? [{ keywords: ['hello', 'hi', 'hey', 'greeting', 'morning', 'afternoon', 'evening'], response: greeting }]
      : [];
  }

  const attachedSystem = {
    name: 'NAI Assistant',
    knowledge: [...getSharedKnowledge(), ...defaultKnowledge],
    documents: [],
    getContext: null,
    respond: null
  };
  const mainSystem = {
    name: 'NAI Assistant',
    knowledge: [...getSharedKnowledge(), ...defaultKnowledge],
    documents: []
  };
  const embedToken = new URLSearchParams(window.location.hash.slice(1)).get('nai-token');
  const isClientEmbed = Boolean(embedToken);

  function createDocumentKnowledge(fileName, text) {
    const paragraphs = text.split(/\n+/).map(part => part.trim()).filter(Boolean);
    return paragraphs.slice(0, 100).map(paragraph => ({
      keywords: paragraph.toLowerCase().split(/\W+/).filter(word => word.length > 3).slice(0, 12),
      response: `${fileName}: ${paragraph}`
    }));
  }

  function attachDocument(fileName, text) {
    const document = { fileName, text };
    attachedSystem.documents.push(document);
    addKnowledge(createDocumentKnowledge(fileName, text));
    return document;
  }

  function resetAttachedSystem() {
    attachedSystem.documents = [];
    attachedSystem.knowledge = [...getSharedKnowledge(), ...defaultKnowledge];
  }

  function attachMainDocument(fileName, text) {
    const document = { fileName, text };
    mainSystem.documents.push(document);
    mainSystem.knowledge.push(...createDocumentKnowledge(fileName, text));
    localStorage.setItem('nai-main-knowledge', JSON.stringify(mainSystem.documents));
    rebuildMainKnowledge();
    return document;
  }

  function rebuildMainKnowledge() {
    mainSystem.knowledge = [...getSharedKnowledge(), ...defaultKnowledge];
    mainSystem.documents.forEach(document => {
      mainSystem.knowledge.push(...createDocumentKnowledge(document.fileName, document.text));
    });
    localStorage.setItem('nai-main-knowledge', JSON.stringify(mainSystem.documents));
  }

  function renderMainKnowledgeList() {
    if (!mainKnowledgeList) return;
    mainKnowledgeList.innerHTML = mainSystem.documents.length
      ? mainSystem.documents.map((document, index) => `<article class="main-knowledge-item"><div class="flex items-center justify-between gap-3"><strong>${escapeHtml(document.fileName)}</strong><button type="button" class="admin-copy" data-main-remove="${index}">Remove</button></div><textarea class="admin-input admin-code mt-2" data-main-content="${index}">${escapeHtml(document.text)}</textarea><button type="button" class="admin-copy mt-2" data-main-save="${index}">Save changes</button></article>`).join('')
      : '<p class="text-xs text-purple-100/50">No main knowledge files attached.</p>';
  }

  function addKnowledge(entries) {
    if (!Array.isArray(entries)) return;

    attachedSystem.knowledge.push(...entries.filter(entry =>
      Array.isArray(entry.keywords) && typeof entry.response === 'string'
    ));
  }

  if (!isClientEmbed) {
    try {
      const savedMainKnowledge = JSON.parse(localStorage.getItem('nai-main-knowledge') || '[]');
      if (Array.isArray(savedMainKnowledge)) {
        savedMainKnowledge.forEach(document => {
          if (document?.fileName && typeof document.text === 'string') {
            mainSystem.documents.push(document);
            mainSystem.knowledge.push(...createDocumentKnowledge(document.fileName, document.text));
          }
        });
      }
    } catch (error) {
      console.warn('Main NAI knowledge could not be restored.');
    }
  }

  function findGuideSection(documents, message) {
    const queryWords = message.toLowerCase().split(/\W+/).filter(word => word.length > 3);
    let bestSection = null;
    let bestScore = 0;

    for (const document of documents) {
      const sections = [];
      let currentSection = null;
      for (const line of document.text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
        if (/^[A-Z][A-Z0-9 &'/-]{2,}$/.test(line)) {
          currentSection = { title: line, lines: [] };
          sections.push(currentSection);
        } else if (currentSection) {
          currentSection.lines.push(line);
        }
      }

      for (const section of sections) {
        const sectionText = `${section.title} ${section.lines.join(' ')}`.toLowerCase();
        const matchingWords = queryWords.filter(word => sectionText.includes(word));
        const headingMatches = queryWords.filter(word => section.title.toLowerCase().includes(word));
        const score = matchingWords.length * 2 + headingMatches.length * 6;
        if (score > bestScore) {
          bestScore = score;
          bestSection = { fileName: document.fileName, ...section };
        }
      }
    }

    return bestSection;
  }

  function formatGuideResponse(section) {
    const title = section.title.toLowerCase().replace(/\b\w/g, character => character.toUpperCase());
    return `Here’s the relevant guidance for ${title}.\n\n${section.lines.map(line => `- ${line}`).join('\n')}`;
  }

  function configureNAI(options = {}) {
    if (typeof options.name === 'string' && options.name.trim()) {
      attachedSystem.name = options.name.trim();
    }

    if (Array.isArray(options.knowledge)) {
      addKnowledge(options.knowledge);
    }

    if (typeof options.getContext === 'function') {
      attachedSystem.getContext = options.getContext;
    }

    if (typeof options.respond === 'function') {
      attachedSystem.respond = options.respond;
    }

    return window.NAI;
  }

  window.NAI = {
    attach: configureNAI,
    configure: configureNAI,
    addKnowledge,
    attachDocument,
    getSystem: () => ({
      name: attachedSystem.name,
      knowledge: [...attachedSystem.knowledge],
      documents: attachedSystem.documents.map(document => document.fileName)
    })
  };

  async function getNAIResponse(userText) {
    const lower = userText.toLowerCase();
    if (embedToken && supabaseConfig.backendUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(`${supabaseConfig.backendUrl}/api/assistant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-nai-token': embedToken },
          body: JSON.stringify({ message: userText }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        const data = await response.json();
        if (response.ok && data.reply) return data.reply;
      } catch (error) {
        console.warn('NAI backend unavailable; using local knowledge.');
      }
    }

    const context = attachedSystem.getContext
      ? await attachedSystem.getContext()
      : null;

    if (attachedSystem.respond) {
      try {
        const response = await attachedSystem.respond({
          message: userText,
          system: attachedSystem.name,
          context
        });

        if (typeof response === 'string' && response.trim()) {
          return response;
        }
      } catch (error) {
        console.warn('NAI custom response handler failed; using local knowledge.');
      }
    }

    const guideSection = findGuideSection(isClientEmbed ? attachedSystem.documents : mainSystem.documents, userText);
    if (guideSection) {
      return formatGuideResponse(guideSection);
    }

    for (const item of (isClientEmbed ? attachedSystem.knowledge : mainSystem.knowledge)) {
      if (item.keywords.some(kw => lower.includes(kw))) {
        return item.response;
      }
    }

    return `I am here to help with your question about "${userText}". I could not find a matching detail in the attached guide.`;
  }

  // --- CHAT INTERFACE CONTROLS ---
  const chatCard = document.getElementById('chat-card');
  const mascotTrigger = document.getElementById('mascot-trigger');
  const closeChat = document.getElementById('close-chat');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatStream = document.getElementById('chat-stream');
  const typingIndicator = document.getElementById('typing-indicator');
  const adminPortal = document.getElementById('admin-portal');
  const knowledgeFile = document.getElementById('knowledge-file');
  const knowledgeStatus = document.getElementById('knowledge-status');
  const mainKnowledgeFile = document.getElementById('main-knowledge-file');
  const mainKnowledgeStatus = document.getElementById('main-knowledge-status');
  const mainKnowledgeDropzone = document.getElementById('main-knowledge-dropzone');
  const mainKnowledgeList = document.getElementById('main-knowledge-list');
  const replaceMainKnowledge = document.getElementById('replace-main-knowledge');
  const sharedBehaviorInput = document.getElementById('nai-shared-behavior');
  const sharedBehaviorSave = document.getElementById('save-nai-shared-behavior');
  const sharedBehaviorStatus = document.getElementById('nai-shared-behavior-status');
  const systemName = document.getElementById('system-name');
  const embedLink = document.getElementById('embed-link');
  const embedCode = document.getElementById('embed-code');
  const requesterEmail = document.getElementById('requester-email');
  const knowledgeDropzone = document.getElementById('knowledge-dropzone');
  const embedMode = document.getElementById('embed-mode');
  const userDashboard = document.getElementById('user-dashboard');
  const authStatus = document.getElementById('auth-status');
  const requestForm = document.getElementById('system-request-form');
  const requestStatus = document.getElementById('request-status');
  const requestList = document.getElementById('request-list');
  const rejectedRequestList = document.getElementById('rejected-request-list');
  const adminRequestList = document.getElementById('admin-request-list');
  const supabaseConfig = window.NAI_SUPABASE_CONFIG || {};
  const supabaseClient = supabaseConfig.url && supabaseConfig.anonKey && window.supabase
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
    : null;
  const authScreen = document.getElementById('auth-screen');
  const authMessage = document.getElementById('auth-message');
  const registerMessage = document.getElementById('register-message');
  const adminLoginCard = document.getElementById('admin-login-card');
  const adminAuthMessage = document.getElementById('admin-auth-message');
  const passwordSetupCard = document.getElementById('password-setup-card');
  const passwordSetupMessage = document.getElementById('password-setup-message');
  const emailVerificationCard = document.getElementById('email-verification-card');
  const verificationMessage = document.getElementById('verification-message');
  const authAlert = document.getElementById('auth-alert');
  const authAlertTitle = document.getElementById('auth-alert-title');
  const authAlertMessage = document.getElementById('auth-alert-message');
  const signOutButton = document.getElementById('sign-out');
  const mobileSignOutButton = document.getElementById('sign-out-mobile');
  const naiPreloader = document.getElementById('nai-preloader');
  const preloaderStatus = naiPreloader?.querySelector('.preloader-status');
  let pendingAdminLogin = false;
  let pendingVerification = JSON.parse(sessionStorage.getItem('nai-pending-verification') || 'null');
  let pendingSignup = false;
  let logoutTransitionActive = false;
  let authStateHandling = false;
  let activeAdminRequestId = null;

  function setPendingVerification(email, password = null, nextView = 'login') {
    pendingVerification = { email, nextView, ...(password ? { password } : {}) };
    sessionStorage.setItem('nai-pending-verification', JSON.stringify({ email, nextView }));
  }

  function clearPendingVerification() {
    pendingVerification = null;
    sessionStorage.removeItem('nai-pending-verification');
  }

  function showAuthAlert(title, message) {
    authAlertTitle.textContent = title;
    authAlertMessage.textContent = message;
    authAlert.classList.remove('hidden');
  }

  function hideAuthAlert() {
    authAlert.classList.add('hidden');
  }

  async function requestCustomVerification(email) {
    const response = await fetch('/api/auth/request-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not send the verification email.');
  }

  async function isCustomEmailVerified(email) {
    const response = await fetch(`/api/auth/status?email=${encodeURIComponent(email)}`);
    const result = await response.json().catch(() => ({}));
    return response.ok && result.verified === true;
  }

  function getDemoUser() {
    const savedUser = localStorage.getItem('nai-demo-user');
    return savedUser ? JSON.parse(savedUser) : null;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  async function getCurrentUser() {
    if (supabaseClient) {
      const { data } = await supabaseClient.auth.getUser();
      return data.user;
    }
    return getDemoUser();
  }

  async function renderRequests() {
    const content = document.querySelector('.dashboard-content');
    content?.classList.add('is-refreshing');
    if (supabaseClient) {
      const user = await getCurrentUser();
      if (!user) {
        content?.classList.remove('is-refreshing');
        return;
      }
      const { data, error } = await supabaseClient
        .from('system_requests')
        .select('id, system_name, message, status, embed_token_id, embed_link, knowledge_file_name')
        .eq('requester_id', user.id)
        .order('created_at', { ascending: false });
      if (!error) {
        document.getElementById('overview-request-count').textContent = data.length;
        requestList.innerHTML = renderRequestGroups(data.filter(request => request.status !== 'rejected'), 'system_name', 'embed_link');
        rejectedRequestList.innerHTML = renderRequestGroups(data.filter(request => request.status === 'rejected'), 'system_name', 'embed_link');
        content?.classList.remove('is-refreshing');
        return;
      }
    }
    const requests = JSON.parse(localStorage.getItem('nai-demo-requests') || '[]');
    document.getElementById('overview-request-count').textContent = requests.length;
    requestList.innerHTML = renderRequestGroups(requests.filter(request => request.status !== 'rejected'), 'system', 'embedLink');
    rejectedRequestList.innerHTML = renderRequestGroups(requests.filter(request => request.status === 'rejected'), 'system', 'embedLink');
    content?.classList.remove('is-refreshing');
  }

  function renderRequestGroups(requests, nameKey, linkKey) {
    if (!requests.length) return '<p class="text-xs text-cyan-100/50">No requests yet.</p>';
    const groups = [
      ['pending', 'Pending review', 'We are waiting for the admin to review this request.'],
      ['approved', 'Approved', 'Your private NAI companion is ready to test.'],
      ['rejected', 'Needs changes', 'This request was not approved.']
    ];
    const sections = groups.map(([status, title, description]) => {
      const items = requests.filter(request => request.status === status);
      if (!items.length) return '';
      return `<section class="request-group"><div class="request-group-heading"><div><h4>${title}</h4><p>${description}</p></div><span>${items.length}</span></div><div class="request-group-list">${items.map(request => renderRequestCard(request, nameKey, linkKey)).join('')}</div></section>`;
    }).join('');
    return `<div class="request-groups-grid">${sections}</div>`;
  }

  function renderRequestCard(request, nameKey, linkKey) {
    const link = request[linkKey];
    const previewLink = link ? getEmbedPreviewLink(link) : '';
    return `<article class="request-item"><div class="flex items-center justify-between gap-3"><strong class="text-sm text-cyan-50">${escapeHtml(request[nameKey])}</strong><span class="request-status">${escapeHtml(request.status)}</span></div><p class="mt-2 text-xs text-cyan-100/60">${escapeHtml(request.message)}</p>${request.knowledge_file_name ? `<p class="mt-1 text-xs text-cyan-100/45">Guide: ${escapeHtml(request.knowledge_file_name)}</p>` : ''}${link ? `<a class="mt-2 block text-xs text-cyan-200 underline" href="${escapeHtml(previewLink)}" target="_blank" rel="noopener">Test your NAI companion in a new tab</a><div class="mt-3"><p class="text-xs font-semibold text-cyan-100/70">Implementation code</p><pre class="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-cyan-300/15 bg-cyan-950/20 p-2 text-[10px] leading-relaxed text-cyan-100/70">${escapeHtml(createEmbedCode(previewLink, request[nameKey]))}</pre></div>` : ''}</article>`;
  }

  async function renderAdminRequests() {
    if (!supabaseClient || !adminRequestList) return;
    const content = document.querySelector('.admin-content');
    content?.classList.add('is-refreshing');
    const { data, error } = await supabaseClient
      .from('system_requests')
      .select('id, email, system_name, message, knowledge_content, knowledge_file_name, status, embed_token_id, created_at')
      .order('created_at', { ascending: false });
    if (error) {
      adminRequestList.innerHTML = `<p class="text-xs text-rose-200">${escapeHtml(error.message)}</p>`;
      content?.classList.remove('is-refreshing');
      return;
    }
    adminRequestList.innerHTML = data.length
      ? data.map(request => `<article class="admin-request-item"><div class="flex items-center justify-between gap-3"><strong class="text-sm text-white">${escapeHtml(request.system_name)}</strong><span class="request-status">${escapeHtml(request.status)}</span></div><p class="mt-1 text-xs text-purple-200/55">For ${escapeHtml(request.email)}</p><p class="mt-2 text-xs text-purple-100/70">${escapeHtml(request.message)}</p>${request.knowledge_content ? `<pre class="mt-2">${escapeHtml(request.knowledge_content)}</pre>` : ''}${request.knowledge_file_name ? `<p class="mt-2 text-xs text-purple-200/50">Attached: ${escapeHtml(request.knowledge_file_name)}</p>` : ''}${request.status === 'pending' ? `<div class="admin-request-actions"><button type="button" class="admin-copy" data-review-request="${request.id}">Review in knowledge</button><button type="button" class="admin-copy admin-approve" data-approve-request="${request.id}">Approve & send link</button><button type="button" class="admin-copy admin-reject" data-reject-request="${request.id}">Reject</button></div>` : request.embed_token_id ? '<p class="mt-2 text-xs text-emerald-200">Secure link created for requester.</p>' : ''}</article>`).join('')
      : '<p class="text-xs text-purple-100/50">No requests yet.</p>';
    content?.classList.remove('is-refreshing');
  }

  async function updateAuthStatus() {
    const user = await getCurrentUser();
    authStatus.textContent = user ? `Signed in as ${user.email || user.user_metadata?.full_name || 'connected user'}.` : 'Sign in to request access to a connected system.';
    document.getElementById('sign-out').classList.toggle('hidden', !user);
    mobileSignOutButton?.classList.toggle('hidden', !user);
  }

  function showDashboard() {
    authScreen.classList.add('hidden');
    userDashboard.classList.remove('hidden');
    renderRequests();
    updateAuthStatus();
  }

  function showLogoutLoader(message) {
    if (!naiPreloader) return;
    if (preloaderStatus) preloaderStatus.lastChild.textContent = message;
    naiPreloader.classList.remove('preloader-complete');
    naiPreloader.classList.add('preloader-logging-out');
  }

  function hideLogoutLoader() {
    naiPreloader?.classList.remove('preloader-logging-out');
    naiPreloader?.classList.add('preloader-complete');
  }

  async function completeLogout(targetView, message) {
    if (logoutTransitionActive) return;
    logoutTransitionActive = true;
    showLogoutLoader(message);
    if (supabaseClient) await supabaseClient.auth.signOut();
    document.querySelectorAll('#login-form, #register-form, #admin-login-form, #email-verification-form, #password-setup-form').forEach(form => form.reset());
    document.getElementById('verification-email').textContent = '';
    authMessage.textContent = '';
    registerMessage.textContent = '';
    adminAuthMessage.textContent = '';
    verificationMessage.textContent = '';
    passwordSetupMessage.textContent = '';
    clearPendingVerification();
    Object.keys(sessionStorage).filter(key => key.startsWith('nai-google-verification-requested:')).forEach(key => sessionStorage.removeItem(key));
    Object.keys(sessionStorage).filter(key => key.startsWith('nai-custom-verified:')).forEach(key => sessionStorage.removeItem(key));
    localStorage.removeItem('nai-demo-user');
    localStorage.removeItem('nai-demo-admin');
    await new Promise(resolve => setTimeout(resolve, 520));
    adminPortal.classList.add('hidden');
    userDashboard.classList.add('hidden');
    authScreen.classList.remove('hidden');
    showAuthView(targetView);
    hideLogoutLoader();
    logoutTransitionActive = false;
  }

  function showAuthScreen() {
    userDashboard.classList.add('hidden');
    authScreen.classList.remove('hidden');
    authMessage.textContent = 'You have been signed out. Log in to continue.';
    showAuthView('login');
  }

  function showAuthView(view) {
    authScreen.classList.add('auth-ready');
    document.getElementById('auth-welcome').classList.toggle('hidden', view !== 'welcome');
    document.getElementById('login-card').classList.toggle('hidden', view !== 'login');
    document.getElementById('register-card').classList.toggle('hidden', view !== 'register');
    adminLoginCard.classList.toggle('hidden', view !== 'admin');
    passwordSetupCard.classList.toggle('hidden', view !== 'password');
    emailVerificationCard.classList.toggle('hidden', view !== 'verification');
  }

  function showDashboardView(viewId) {
    const content = document.querySelector('.dashboard-content');
    content?.classList.add('is-refreshing');
    document.querySelectorAll('.dashboard-view').forEach(view => view.classList.toggle('hidden', view.id !== viewId));
    document.querySelectorAll('.dashboard-nav').forEach(button => button.classList.toggle('dashboard-nav-active', button.dataset.dashboardView === viewId));
    if (viewId === 'dashboard-access-view') renderRequests();
    setTimeout(() => content?.classList.remove('is-refreshing'), 220);
  }

  document.getElementById('welcome-login').addEventListener('click', () => showAuthView('login'));
  document.getElementById('welcome-register').addEventListener('click', () => showAuthView('register'));
  document.getElementById('card-to-register').addEventListener('click', () => showAuthView('register'));
  document.getElementById('card-to-login').addEventListener('click', () => showAuthView('login'));
  async function submitAuth(mode) {
    const register = mode === 'register';
    const email = document.getElementById(register ? 'register-email' : 'login-email').value.trim();
    const password = document.getElementById(register ? 'register-password' : 'login-password').value;
    const name = document.getElementById('register-name').value.trim();
    const registerButton = document.getElementById('register-submit');
    const registerLabel = registerButton?.querySelector('span');
    if (register) pendingSignup = true;
    if (register && registerButton) {
      registerButton.disabled = true;
      if (registerLabel) registerLabel.textContent = 'Creating account...';
    }
    if (supabaseClient) {
      const result = register
        ? await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: supabaseConfig.appUrl || `${window.location.origin}${window.location.pathname}`
          }
        })
        : await supabaseClient.auth.signInWithPassword({ email, password });
      if (result.error) {
        pendingSignup = false;
        const errorMessage = result.error.message.toLowerCase();
        if (!register && (errorMessage.includes('email not confirmed') || errorMessage.includes('email not verified'))) {
          setPendingVerification(email, password);
          document.getElementById('verification-email').textContent = email;
          verificationMessage.textContent = 'Verify your email before logging in. A new code can be sent below.';
          showAuthView('verification');
          if (registerButton) {
            registerButton.disabled = false;
            if (registerLabel) registerLabel.textContent = 'Create account';
          }
          return;
        }
        const message = errorMessage.includes('confirmation email')
          ? 'Disable Supabase email confirmations. NAI now sends verification emails through Resend.'
          : result.error.message;
        if (register && (errorMessage.includes('already registered') || errorMessage.includes('already exists') || errorMessage.includes('user already'))) {
          showAuthAlert('Account already exists', 'This email is already registered. Log in with the existing account or use password recovery.');
        }
        (register ? registerMessage : authMessage).textContent = message;
        if (register && registerButton) {
          registerButton.disabled = false;
          if (registerLabel) registerLabel.textContent = 'Create account';
        }
        return;
      }
      if (register && result.data.user && Array.isArray(result.data.user.identities) && result.data.user.identities.length === 0) {
        pendingSignup = false;
        showAuthAlert('Account already exists', 'This email is already registered. Log in with the existing account or use password recovery.');
        if (registerButton) {
          registerButton.disabled = false;
          if (registerLabel) registerLabel.textContent = 'Create account';
        }
        return;
      }
      if (register) {
        try {
          await requestCustomVerification(email);
          setPendingVerification(email, password, 'login');
          document.getElementById('verification-email').textContent = email;
          verificationMessage.textContent = 'A verification email was sent. Enter its code or click its confirmation link.';
          if (result.data.session) await supabaseClient.auth.signOut();
          pendingSignup = false;
          showAuthView('verification');
        } catch (error) {
          pendingSignup = false;
          registerMessage.textContent = error.message;
          if (registerButton) {
            registerButton.disabled = false;
            if (registerLabel) registerLabel.textContent = 'Create account';
          }
        }
        return;
      }
      if (register && (!result.data.session || !result.data.user?.email_confirmed_at)) {
        setPendingVerification(email, password, 'login');
        document.getElementById('verification-email').textContent = email;
        verificationMessage.textContent = 'A verification email was sent. Enter its code or click its confirmation link.';
        if (result.data.session) await supabaseClient.auth.signOut();
        pendingSignup = false;
        showAuthView('verification');
        return;
      }
      if (!register && !result.data.user?.email_confirmed_at) {
        try {
          if (!(await isCustomEmailVerified(email))) {
            setPendingVerification(email, password, 'dashboard');
            document.getElementById('verification-email').textContent = email;
            verificationMessage.textContent = 'Verify your email before logging in. A new code can be sent below.';
            showAuthView('verification');
            return;
          }
        } catch (error) {
          authMessage.textContent = 'Verification service is unavailable. Please try again.';
          return;
        }
      }
      pendingSignup = false;
    } else {
      pendingSignup = false;
      localStorage.setItem('nai-demo-user', JSON.stringify({ email, name }));
    }
    if (register && registerButton) {
      registerButton.disabled = false;
      if (registerLabel) registerLabel.textContent = 'Create account';
    }
    showDashboard();
  }

  document.getElementById('login-form').addEventListener('submit', event => {
    event.preventDefault();
    submitAuth('login');
  });
  document.getElementById('register-form').addEventListener('submit', event => {
    event.preventDefault();
    submitAuth('register');
  });
  document.getElementById('auth-alert-close').addEventListener('click', hideAuthAlert);
  document.getElementById('auth-alert-dismiss').addEventListener('click', hideAuthAlert);
  document.getElementById('auth-alert-login').addEventListener('click', () => {
    hideAuthAlert();
    showAuthView('login');
  });
  document.getElementById('email-verification-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!pendingVerification) return;
    const code = document.getElementById('verification-code').value.trim();
    const submitButton = document.querySelector('.verification-submit');
    submitButton.disabled = true;
    submitButton.textContent = 'Verifying...';
    const response = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingVerification.email, code })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      verificationMessage.textContent = result.error || 'Verification failed.';
      submitButton.disabled = false;
      submitButton.textContent = 'Verify and continue';
      return;
    }
    const verifiedEmail = pendingVerification.email;
    const nextView = pendingVerification.nextView || 'login';
    sessionStorage.setItem(`nai-custom-verified:${verifiedEmail}`, 'true');
    clearPendingVerification();
    if (nextView === 'password') {
      showAuthView('password');
    } else if (nextView === 'dashboard') {
      showDashboard();
    } else {
      document.getElementById('login-email').value = verifiedEmail;
      authMessage.textContent = 'Email verified. Log in to continue.';
      showAuthView('login');
    }
  });
  document.getElementById('resend-verification').addEventListener('click', async () => {
    if (!pendingVerification) return;
    const resendButton = document.getElementById('resend-verification');
    resendButton.disabled = true;
    resendButton.textContent = 'Sending...';
    try {
      await requestCustomVerification(pendingVerification.email);
      window.location.reload();
    } catch (error) {
      verificationMessage.textContent = error.message;
      resendButton.disabled = false;
      resendButton.textContent = 'Resend code';
    }
  });
  document.getElementById('verification-back-login').addEventListener('click', () => {
    const email = pendingVerification?.email || '';
    clearPendingVerification();
    document.getElementById('login-email').value = email;
    showAuthView('login');
  });
  document.getElementById('password-setup-form').addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.getElementById('system-password').value;
    const confirmation = document.getElementById('system-password-confirm').value;
    const submitButton = document.querySelector('.password-setup-submit');
    if (password !== confirmation) {
      passwordSetupMessage.textContent = 'Passwords do not match.';
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Saving password...';
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) {
      passwordSetupMessage.textContent = error.message;
      submitButton.disabled = false;
      submitButton.textContent = 'Save password and continue';
      return;
    }
    const { data: updatedUser } = await supabaseClient.auth.getUser();
    if (updatedUser.user) localStorage.setItem(`nai-password-ready-${updatedUser.user.id}`, 'true');
    showDashboard();
  });
  async function submitAdminAuth() {
    const email = document.getElementById('admin-login-email').value.trim();
    const password = document.getElementById('admin-login-password').value;
    const submitButton = document.querySelector('#admin-login-form button[type="submit"]');
    const submitLabel = submitButton.querySelector('span');
    adminAuthMessage.textContent = '';
    submitButton.disabled = true;
    submitLabel.textContent = 'Verifying access...';
    if (supabaseClient) {
      pendingAdminLogin = true;
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        pendingAdminLogin = false;
        adminAuthMessage.textContent = error.message;
        submitButton.disabled = false;
        submitLabel.textContent = 'Enter control room';
        return;
      }
      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', (await supabaseClient.auth.getUser()).data.user.id)
        .single();
      if (profileError || profile?.role !== 'admin') {
        await supabaseClient.auth.signOut();
        pendingAdminLogin = false;
        authScreen.classList.remove('hidden');
        showAuthView('admin');
        adminAuthMessage.textContent = 'Admin access is not enabled for this account. Set its profiles.role to admin in Supabase, then try again.';
        submitButton.disabled = false;
        submitLabel.textContent = 'Enter control room';
        return;
      }
      pendingAdminLogin = false;
    } else {
      localStorage.setItem('nai-demo-admin', JSON.stringify({ email }));
    }
    authScreen.classList.add('hidden');
    adminPortal.classList.remove('hidden');
    showAdminView('admin-overview-view');
  }

  document.getElementById('admin-password-toggle')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const passwordInput = document.getElementById('admin-login-password');
    const isVisible = passwordInput.type === 'text';
    passwordInput.type = isVisible ? 'password' : 'text';
    button.setAttribute('aria-label', isVisible ? 'Show admin password' : 'Hide admin password');
    button.setAttribute('aria-pressed', String(!isVisible));
  });

  document.getElementById('admin-email-toggle')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const emailInput = document.getElementById('admin-login-email');
    const isVisible = emailInput.type === 'email';
    emailInput.type = isVisible ? 'password' : 'email';
    button.setAttribute('aria-label', isVisible ? 'Show admin email' : 'Hide admin email');
    button.setAttribute('aria-pressed', String(!isVisible));
  });

  document.getElementById('admin-login-form').addEventListener('submit', event => {
    event.preventDefault();
    submitAdminAuth();
  });
  document.getElementById('admin-to-login').addEventListener('click', () => showAuthView('login'));
  document.getElementById('admin-sign-out').addEventListener('click', async () => {
    const adminSignOut = document.getElementById('admin-sign-out');
    adminSignOut.classList.add('is-signing-out');
    await completeLogout('admin', 'Closing admin session');
    adminSignOut.classList.remove('is-signing-out');
  });
  async function signInWithGoogle(messageElement) {
    if (supabaseClient) {
      const redirectTo = supabaseConfig.appUrl || `${window.location.origin}${window.location.pathname}`;
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });
      if (error) messageElement.textContent = error.message;
      return;
    }
    messageElement.textContent = 'Connect Supabase to use Google sign-in.';
  }

  document.getElementById('auth-google-login').addEventListener('click', () => signInWithGoogle(authMessage));
  document.getElementById('auth-google-register').addEventListener('click', () => signInWithGoogle(registerMessage));

  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      if (authStateHandling) return;
      authStateHandling = true;
      const isGoogleUser = session?.user?.app_metadata?.provider === 'google';
      const hasSystemPassword = session?.user?.id && localStorage.getItem(`nai-password-ready-${session.user.id}`) === 'true';
      try {
        if (session && !pendingAdminLogin && !pendingSignup && isGoogleUser && ['SIGNED_IN', 'INITIAL_SESSION'].includes(_event)) {
          try {
          const verified = await isCustomEmailVerified(session.user.email);
          const verifiedThisSession = sessionStorage.getItem(`nai-custom-verified:${session.user.email}`) === 'true';
          const requestKey = `nai-google-verification-requested:${session.user.email}`;
          if (!verified && !verifiedThisSession) {
            if (!sessionStorage.getItem(requestKey)) {
              await requestCustomVerification(session.user.email);
              sessionStorage.setItem(requestKey, 'true');
            }
            setPendingVerification(session.user.email, null, hasSystemPassword ? 'dashboard' : 'password');
            document.getElementById('verification-email').textContent = session.user.email;
            verificationMessage.textContent = 'A verification code was sent to your Google account email.';
            showAuthView('verification');
          } else if (!hasSystemPassword) {
            showAuthView('password');
          } else {
            showDashboard();
          }
          } catch (error) {
            setPendingVerification(session.user.email, null, hasSystemPassword ? 'dashboard' : 'password');
            document.getElementById('verification-email').textContent = session.user.email;
            verificationMessage.textContent = error.message || 'Could not send the verification email.';
            showAuthView('verification');
          }
        } else if (session && !pendingAdminLogin && !pendingSignup && !session.user.email_confirmed_at) showAuthView('verification');
        else if (session && !pendingAdminLogin && !pendingSignup) showDashboard();
        else if (_event === 'INITIAL_SESSION') showAuthView('welcome');
        else if (_event === 'SIGNED_OUT' && !logoutTransitionActive) showAuthScreen();
      } finally {
        authStateHandling = false;
      }
    });
  } else if (pendingVerification) {
    document.getElementById('verification-email').textContent = pendingVerification.email;
    verificationMessage.textContent = 'Your verification is still pending.';
    showAuthView('verification');
  } else if (getDemoUser()) {
    showDashboard();
  } else {
    showAuthView('welcome');
  }

  signOutButton.addEventListener('click', async () => {
    signOutButton.classList.add('is-signing-out');
    await completeLogout('login', 'Signing out securely');
    signOutButton.classList.remove('is-signing-out');
  });

  mobileSignOutButton?.addEventListener('click', async () => {
    mobileSignOutButton.classList.add('is-signing-out');
    await completeLogout('login', 'Signing out securely');
    mobileSignOutButton.classList.remove('is-signing-out');
  });

  document.querySelector('.auth-forgot').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    if (!email) {
      authMessage.textContent = 'Enter your email first.';
      return;
    }
    if (supabaseClient) {
      const redirectTo = supabaseConfig.appUrl || window.location.href;
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
      authMessage.textContent = error ? error.message : 'Password reset instructions sent.';
    } else {
      authMessage.textContent = 'Password reset is available after Supabase is connected.';
    }
  });

  requestForm.addEventListener('submit', async event => {
    event.preventDefault();
    const user = await getCurrentUser();
    if (!user) {
      requestStatus.textContent = 'Sign in before sending a request.';
      return;
    }

    const requestKnowledgeFile = document.getElementById('request-knowledge-file').files[0];
    let knowledgeContent = '';
    if (requestKnowledgeFile) {
      knowledgeContent = requestKnowledgeFile.name.toLowerCase().endsWith('.docx')
        ? (await mammoth.extractRawText({ arrayBuffer: await requestKnowledgeFile.arrayBuffer() })).value
        : await requestKnowledgeFile.text();
    }
    const manualMessage = document.getElementById('request-message').value.trim();
    if (!manualMessage && !knowledgeContent.trim()) {
      requestStatus.textContent = 'Add a note or attach a knowledge file before sending.';
      return;
    }
    const requestMessage = manualMessage || `Knowledge provided in ${requestKnowledgeFile.name}.`;
    const request = {
      id: crypto.randomUUID(),
      email: user.email,
      system: document.getElementById('request-system').value.trim(),
      message: requestMessage,
      knowledgeContent,
      knowledgeFileName: requestKnowledgeFile?.name || null,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    if (supabaseClient) {
      const { error } = await supabaseClient.from('system_requests').insert({ requester_id: user.id, email: user.email, system_name: request.system, message: request.message, knowledge_content: request.knowledgeContent, knowledge_file_name: request.knowledgeFileName });
      if (error) { requestStatus.textContent = error.message; return; }
    } else {
      const requests = JSON.parse(localStorage.getItem('nai-demo-requests') || '[]');
      requests.push(request);
      localStorage.setItem('nai-demo-requests', JSON.stringify(requests));
    }
    requestForm.reset();
    requestStatus.textContent = 'Request sent to the admin.';
    renderRequests();
    showDashboardView('dashboard-access-view');
  });

  async function createAdminLink(requestId, overrides = {}) {
    const { data: request, error: requestError } = await supabaseClient
      .from('system_requests').select('id, requester_id, system_name, knowledge_content, knowledge_file_name').eq('id', requestId).single();
    if (requestError) throw requestError;
    const finalSystemName = overrides.systemName?.trim() || request.system_name;
    const { data: system, error: systemError } = await supabaseClient
      .from('systems').insert({ owner_id: request.requester_id, name: finalSystemName }).select('id').single();
    if (systemError) throw systemError;
    const rawToken = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
    const tokenHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const { data: token, error: tokenError } = await supabaseClient.from('embed_tokens').insert({
      system_id: system.id, owner_id: request.requester_id, token_hash: tokenHash,
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString()
    }).select('id').single();
    if (tokenError) throw tokenError;
    if (request.knowledge_content) {
      const { error: documentError } = await supabaseClient.from('knowledge_documents').insert({
        system_id: system.id,
        owner_id: request.requester_id,
        file_name: request.knowledge_file_name || `${request.system_name}-knowledge.txt`,
        storage_path: `admin-request/${request.id}/${crypto.randomUUID()}`,
        content: request.knowledge_content,
        mime_type: 'text/plain'
      });
      if (documentError) throw documentError;
    }
    const embedLink = `${window.location.origin}${window.location.pathname}?embed=1&mode=mascot#nai-token=${rawToken}`;
    const { error: updateError } = await supabaseClient.from('system_requests').update({
      status: 'approved', embed_token_id: token.id, embed_link: embedLink, updated_at: new Date().toISOString()
    }).eq('id', requestId);
    if (updateError) throw updateError;
    return { embedLink };
  }

  adminRequestList?.addEventListener('click', async event => {
    const review = event.target.closest('[data-review-request]');
    const approve = event.target.closest('[data-approve-request]');
    const reject = event.target.closest('[data-reject-request]');
    const requestId = review?.dataset.reviewRequest || approve?.dataset.approveRequest || reject?.dataset.rejectRequest;
    if (!requestId || !supabaseClient) return;
    try {
      if (review) {
        const { data: request, error } = await supabaseClient
          .from('system_requests')
          .select('email, system_name, message, knowledge_content, knowledge_file_name')
          .eq('id', requestId)
          .single();
        if (error) throw error;
        activeAdminRequestId = requestId;
        systemName.value = request.system_name || '';
        requesterEmail.value = request.email || '';
        resetAttachedSystem();
        if (request.knowledge_content) {
          attachDocument(request.knowledge_file_name || `${request.system_name}-knowledge.txt`, request.knowledge_content);
          showAttachedFile({
            name: request.knowledge_file_name || `${request.system_name}-knowledge.txt`,
            size: new Blob([request.knowledge_content]).size
          });
        } else {
          showKnowledgeMessage('No guide was included with this request.');
        }
        document.getElementById('admin-knowledge-count').textContent = attachedSystem.documents.length;
        showAdminView('admin-knowledge-view');
        return;
      }
      if (reject) await supabaseClient.from('system_requests').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', requestId);
      if (approve) {
        const { embedLink } = await createAdminLink(requestId, {
          systemName: activeAdminRequestId === requestId ? systemName.value : ''
        });
        await navigator.clipboard.writeText(embedLink);
      }
      await renderAdminRequests();
    } catch (error) {
      adminRequestList.insertAdjacentHTML('afterbegin', `<p class="text-xs text-rose-200">${escapeHtml(error.message)}</p>`);
    }
  });

  function createEmbedToken() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function createEmbedCode(url, name) {
    const safeName = name.replace(/["&<>]/g, '');
    return `<iframe src="${url}" title="${safeName} NAI assistant" width="420" height="620" style="position:fixed;right:16px;bottom:16px;border:0;background:transparent" allow="clipboard-write"></iframe>`;
  }

  function getEmbedPreviewLink(link) {
    const url = new URL(link, window.location.origin);
    url.searchParams.set('embed', '1');
    url.searchParams.set('mode', 'mascot');
    return url.toString();
  }

  function showAdminView(viewId) {
    const content = document.querySelector('.admin-content');
    content?.classList.add('is-refreshing');
    document.querySelectorAll('.admin-view').forEach(view => view.classList.toggle('hidden', view.id !== viewId));
    document.querySelectorAll('.admin-nav').forEach(button => button.classList.toggle('admin-nav-active', button.dataset.adminView === viewId));
    if (viewId === 'admin-overview-view') {
      document.getElementById('admin-knowledge-count').textContent = attachedSystem.documents.length;
      renderAdminRequests();
    }
    if (viewId === 'admin-shared-knowledge-view') {
      if (sharedBehaviorInput) sharedBehaviorInput.value = sharedBehavior;
    }
    if (viewId === 'admin-main-knowledge-view') {
      document.getElementById('main-knowledge-count').textContent = mainSystem.documents.length;
      renderMainKnowledgeList();
    }
    setTimeout(() => content?.classList.remove('is-refreshing'), 220);
  }

  function copyText(input) {
    if (!input.value) return;
    navigator.clipboard.writeText(input.value);
  }

  async function loadAttachedSystemFromToken() {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('nai-token');
    if (!token) return;

    try {
      const response = await fetch(`/api/embed/config?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (response.ok) {
        const config = await response.json();
        configureNAI({ name: config.name });
        (config.documents || []).forEach(document => attachDocument(document.fileName, document.text));
        return;
      }
    } catch (error) {
      console.warn('Remote NAI system configuration could not be restored.');
    }

    const saved = localStorage.getItem(`nai-system-${token}`);
    if (saved) {
      try {
        const config = JSON.parse(saved);
        configureNAI({ name: config.name });
        (config.documents || []).forEach(document => attachDocument(document.fileName, document.text));
        return;
      } catch (error) {
        console.warn('Local NAI system configuration could not be restored.');
      }
    }

    if (!supabaseClient) return;
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const { data: tokenRecord } = await supabaseClient.from('embed_tokens').select('system_id').eq('token_hash', tokenHash).single();
      if (!tokenRecord) return;
      const [{ data: system }, { data: documents }] = await Promise.all([
        supabaseClient.from('systems').select('name').eq('id', tokenRecord.system_id).single(),
        supabaseClient.from('knowledge_documents').select('file_name, content').eq('system_id', tokenRecord.system_id)
      ]);
      if (!system) return;
      configureNAI({ name: system.name });
      (documents || []).forEach(document => attachDocument(document.file_name, document.content));
    } catch (error) {
      console.warn('NAI system configuration could not be restored.');
    }
  }

  loadAttachedSystemFromToken();

  document.getElementById('close-admin')?.addEventListener('click', () => {
    adminPortal.classList.add('hidden');
  });

  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'q') return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    authScreen.classList.remove('hidden');
    showAuthView('admin');
  });

  knowledgeFile.addEventListener('change', async () => {
    const file = knowledgeFile.files[0];
    if (!file) return;
    await loadKnowledgeFile(file);
  });

  mainKnowledgeFile?.addEventListener('change', async () => {
    const file = mainKnowledgeFile.files[0];
    if (!file) return;
    await loadMainKnowledgeFile(file);
  });

  sharedBehaviorSave?.addEventListener('click', () => {
    sharedBehavior = sharedBehaviorInput.value.trim();
    if (sharedBehavior) localStorage.setItem(sharedBehaviorKey, sharedBehavior);
    else localStorage.removeItem(sharedBehaviorKey);
    attachedSystem.knowledge = [...getSharedKnowledge(), ...defaultKnowledge];
    rebuildMainKnowledge();
    sharedBehaviorStatus.textContent = sharedBehavior
      ? 'Shared behavior saved for NAI and new user companions.'
      : 'Shared behavior cleared.';
  });

  mainKnowledgeList?.addEventListener('click', event => {
    const saveButton = event.target.closest('[data-main-save]');
    const removeButton = event.target.closest('[data-main-remove]');
    const index = Number(saveButton?.dataset.mainSave ?? removeButton?.dataset.mainRemove);
    if (!Number.isInteger(index) || !mainSystem.documents[index]) return;
    if (saveButton) {
      const editor = mainKnowledgeList.querySelector(`[data-main-content="${index}"]`);
      mainSystem.documents[index].text = editor.value;
      rebuildMainKnowledge();
      mainKnowledgeStatus.textContent = `${mainSystem.documents[index].fileName} changes saved.`;
    }
    if (removeButton) {
      mainSystem.documents.splice(index, 1);
      rebuildMainKnowledge();
      document.getElementById('main-knowledge-count').textContent = mainSystem.documents.length;
      mainKnowledgeStatus.textContent = 'Main knowledge file removed.';
      renderMainKnowledgeList();
    }
  });

  function showKnowledgeMessage(message) {
    knowledgeStatus.classList.remove('has-file');
    knowledgeStatus.textContent = message;
  }

  function showAttachedFile(file) {
    const fileType = file.name.toLowerCase().endsWith('.docx') ? 'DOCX' : 'TXT';
    knowledgeStatus.classList.add('has-file');
    knowledgeStatus.replaceChildren();

    const typeBadge = document.createElement('span');
    typeBadge.className = 'knowledge-file-type';
    typeBadge.textContent = fileType;
    typeBadge.setAttribute('aria-hidden', 'true');

    const details = document.createElement('span');
    details.className = 'knowledge-file-details';

    const fileName = document.createElement('span');
    fileName.className = 'knowledge-file-name';
    fileName.textContent = file.name;
    fileName.title = file.name;

    const fileMeta = document.createElement('span');
    fileMeta.className = 'knowledge-file-meta';
    fileMeta.textContent = `${file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`} attached`;

    details.append(fileName, fileMeta);
    knowledgeStatus.append(typeBadge, details);
  }

  async function loadKnowledgeFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      showKnowledgeMessage('File is larger than 5 MB.');
      return;
    }

    try {
      const text = file.name.toLowerCase().endsWith('.docx')
        ? (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
        : await file.text();
      attachDocument(file.name, text);
      document.getElementById('admin-knowledge-count').textContent = attachedSystem.documents.length;
      showAttachedFile(file);
    } catch (error) {
      showKnowledgeMessage('Could not read this file.');
    }
  }

  async function loadMainKnowledgeFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      mainKnowledgeStatus.textContent = 'File is larger than 5 MB.';
      return;
    }

    try {
      const text = file.name.toLowerCase().endsWith('.docx')
        ? (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
        : await file.text();
      if (!text.trim()) {
        mainKnowledgeStatus.textContent = 'This file does not contain any knowledge.';
        return;
      }
      if (replaceMainKnowledge.checked) {
        mainSystem.documents = [];
      }
      attachMainDocument(file.name, text);
      document.getElementById('main-knowledge-count').textContent = mainSystem.documents.length;
      mainKnowledgeStatus.textContent = `${file.name} is now part of NAI knowledge.`;
      renderMainKnowledgeList();
    } catch (error) {
      mainKnowledgeStatus.textContent = 'Could not read this file.';
    }
  }

  knowledgeDropzone?.addEventListener('dragover', event => {
    event.preventDefault();
    knowledgeDropzone.classList.add('is-dragging');
  });
  knowledgeDropzone?.addEventListener('dragleave', () => knowledgeDropzone.classList.remove('is-dragging'));
  knowledgeDropzone?.addEventListener('drop', async event => {
    event.preventDefault();
    knowledgeDropzone.classList.remove('is-dragging');
    const file = [...event.dataTransfer.files].find(item => /\.(txt|docx)$/i.test(item.name));
    if (file) await loadKnowledgeFile(file);
    else showKnowledgeMessage('Choose a TXT or DOCX guide.');
  });

  mainKnowledgeDropzone?.addEventListener('dragover', event => {
    event.preventDefault();
    mainKnowledgeDropzone.classList.add('is-dragging');
  });
  mainKnowledgeDropzone?.addEventListener('dragleave', () => mainKnowledgeDropzone.classList.remove('is-dragging'));
  mainKnowledgeDropzone?.addEventListener('drop', async event => {
    event.preventDefault();
    mainKnowledgeDropzone.classList.remove('is-dragging');
    const file = [...event.dataTransfer.files].find(item => /\.(txt|docx)$/i.test(item.name));
    if (file) await loadMainKnowledgeFile(file);
    else mainKnowledgeStatus.textContent = 'Choose a TXT or DOCX guide.';
  });

  document.getElementById('generate-link').addEventListener('click', async () => {
    const name = systemName.value.trim() || 'My Connected System';
    configureNAI({ name });
    const token = createEmbedToken();
    const position = 'bottom-right';
    const mode = embedMode?.value || 'mascot';
    const url = `${window.location.origin}${window.location.pathname}?embed=1&position=${position}&mode=${mode}#nai-token=${token}`;
    const positionStyle = 'right:16px;bottom:16px';
    embedLink.value = url;
    embedCode.value = `<iframe src="${url}" title="${name} NAI assistant" width="420" height="620" style="position:fixed;${positionStyle};border:0;background:transparent" allow="clipboard-write"></iframe>`;
    const documents = [
      ...attachedSystem.documents,
      ...(sharedBehavior.trim() ? [{ fileName: 'NAI shared behavior.txt', text: sharedBehavior }] : [])
    ];
    localStorage.setItem(`nai-system-${token}`, JSON.stringify({ name, requesterEmail: requesterEmail.value.trim(), documents }));
    try {
      const response = await fetch('/api/embed/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, systemName: name, position, mode, documents })
      });
      if (!response.ok) throw new Error('Remote embed configuration failed.');
      showKnowledgeMessage(`${attachedSystem.documents.length} guide file(s) secured for this client link.`);
    } catch (error) {
      showKnowledgeMessage('Could not publish the client link. Try again.');
    }
  });

  document.getElementById('copy-link').addEventListener('click', () => copyText(embedLink));
  document.getElementById('copy-code').addEventListener('click', () => copyText(embedCode));

  Promise.all([
    import('./user/dashboard.js'),
    import('./admin/dashboard.js')
  ]).then(([userDashboardModule, adminDashboardModule]) => {
    userDashboardModule.initUserDashboard({ renderRequests, showDashboardView });
    adminDashboardModule.initAdminDashboard({ renderAdminRequests, showAdminView });
  });

  function toggleChat(open) {
    isChatOpen = open;
    if (open) {
      chatCard.classList.remove('hidden');
      setTimeout(() => {
        chatCard.classList.remove('translate-y-8', 'opacity-0', 'scale-95');
      }, 10);
      setExpression('happy', 1.5);
    } else {
      chatCard.classList.add('translate-y-8', 'opacity-0', 'scale-95');
      setTimeout(() => {
        chatCard.classList.add('hidden');
      }, 300);
      setExpression('neutral');
    }
  }

  mascotTrigger.addEventListener('click', () => toggleChat(!isChatOpen));
  closeChat.addEventListener('click', () => toggleChat(false));

  function appendMessage(text, sender = 'bot') {
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex items-start gap-2.5 ${sender === 'user' ? 'justify-end' : ''}`;
    
    const inner = document.createElement('div');
    inner.className = sender === 'user'
      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white p-3 rounded-2xl rounded-tr-none max-w-[85%]'
      : 'bg-purple-900/40 border border-purple-500/30 p-3 rounded-2xl rounded-tl-none max-w-[85%] text-slate-200 whitespace-pre-line';
    
    inner.innerText = text;
    msgDiv.appendChild(inner);
    chatStream.appendChild(msgDiv);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    appendMessage(text, 'user');
    chatInput.value = '';

    setExpression('talking', 1.2);
    actionArmWave = 1.4;
    typingIndicator.classList.remove('hidden');
    chatStream.scrollTop = chatStream.scrollHeight;

    setTimeout(async () => {
      try {
        const reply = await getNAIResponse(text);
        appendMessage(reply, 'bot');
      } catch (error) {
        console.error('NAI response failed.', error);
        appendMessage('I could not load that answer right now. Please try again.', 'bot');
      } finally {
        typingIndicator.classList.add('hidden');
        setExpression('happy', 2.0);
      }
    }, 900);
  });

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initMascotDetailed, { once: true });
  } else {
    initMascotDetailed();
  }

  const embedParams = new URLSearchParams(window.location.search);
  if (embedParams.has('embed')) {
    document.body.classList.add(`embed-${embedParams.get('mode') || 'mascot'}`);
  }