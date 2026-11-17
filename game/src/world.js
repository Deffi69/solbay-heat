// world.js — builds the city of Solbay: the street grid, tower blocks with procedural facades,
// neon signs, palm trees, streetlights, the beach, the pier and the ocean, plus the special
// places the story uses (the club, the garage, the warehouse, the marina lot, the airfield).
// It also owns collision: every building is an axis-aligned box the player, cars and police
// are pushed out of, and it answers ground height (the pier deck) and road questions.

import * as THREE from 'three';
import { CITY, PALETTE, streetCoord, WORLD_EDGE } from './config.js';
import { randRange, pick, clamp } from './random.js';

// Merge many transformed geometries into one BufferGeometry (all non-indexed) so the whole
// city's palms and props can be a handful of draw calls.
function mergeGeoms(items) {
  let total = 0;
  const parts = items.map(({ geo, matrix }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(matrix);
    total += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o3 = 0, o2 = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o3);
    nor.set(g.attributes.normal.array, o3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
    o3 += g.attributes.position.array.length;
    o2 += (g.attributes.uv ? g.attributes.uv.array.length : g.attributes.position.count * 2);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

function mat4(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
  return m;
}

// A facade texture drawn on a canvas: a window grid over a tinted wall, some windows lit.
function facadeTexture(rng, tintHex, floors, cols) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const tint = new THREE.Color(tintHex);
  g.fillStyle = `rgb(${tint.r * 255 | 0},${tint.g * 255 | 0},${tint.b * 255 | 0})`;
  g.fillRect(0, 0, 256, 256);
  const fw = 256 / cols, fh = 256 / floors;
  for (let y = 0; y < floors; y++) for (let x = 0; x < cols; x++) {
    const lit = rng() > 0.72;
    g.fillStyle = lit ? 'rgba(255,214,130,0.95)' : 'rgba(38,54,74,0.9)';
    g.fillRect(x * fw + fw * 0.22, y * fh + fh * 0.2, fw * 0.56, fh * 0.55);
  }
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 0; y <= floors; y++) g.fillRect(0, y * fh - 1, 256, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function signTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  let size = 64;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  do { g.font = `900 ${size}px Arial`; size -= 4; } while (g.measureText(text).width > 478 && size > 18);
  g.shadowColor = fg; g.shadowBlur = 22;
  g.fillStyle = fg; g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function palmLeafTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = '#2e8b57'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(64, 128); g.quadraticCurveTo(60, 60, 64, 4); g.stroke();
  g.lineWidth = 3; g.strokeStyle = '#37a866';
  for (let i = 0; i < 9; i++) {
    const y = 116 - i * 12, spread = 12 + i * 5.4;
    g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 - spread * 0.6, y - 8, 64 - spread, y + 6); g.stroke();
    g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 + spread * 0.6, y - 8, 64 + spread, y + 6); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const LOCATIONS = {
  spawn: { x: -34, z: -2, label: 'Club Azahar corner' },
  clubDoor: { x: -23, z: -4, label: 'Club Azahar' },
  garageDoor: { x: 115, z: 42, label: "Piper's Garage" },
  warehouse: { x: 161, z: -104, label: 'Harbour warehouse' },
  marinaLot: { x: 161, z: 161, label: 'Marina lot' },
  goldCar: { x: 152, z: 152, label: 'The gold coupe' },
  alley: { x: 23, z: 134, label: 'Back alley' },
  airfield: { x: 40, z: -161, label: 'Solbay Airfield' },
  pier: { x: 30, z: 238, label: 'Pier 9 viewpoint' },
  hospital: { x: -115, z: 104, label: 'Solbay General' },
  viewpoint: { x: -150, z: 226, label: 'Sunset point' },
};

export class World {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.colliders = [];       // {minX,maxX,minZ,maxZ,h}
    this.blockRects = [];      // for the minimap
    this.parkingSpots = [];    // {x,z,heading}
    this.intersections = [];
    for (let i = -CITY.halfBlocks; i <= CITY.halfBlocks; i++)
      for (let j = -CITY.halfBlocks; j <= CITY.halfBlocks; j++)
        this.intersections.push({ x: streetCoord(i), z: streetCoord(j), i, j });

    this.#lights();
    this.#groundAndRoads();
    this.#buildings();
    this.#palmsAndProps();
    this.#beachAndOcean();
    this.#backdrop();
  }

  #lights() {
    const hemi = new THREE.HemisphereLight(0xbfdcff, 0xe6cf9e, 0.95);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(PALETTE.sun, 2.0);
    sun.position.set(-140, 190, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -130; sun.shadow.camera.right = 130;
    sun.shadow.camera.top = 130; sun.shadow.camera.bottom = -130;
    sun.shadow.camera.far = 620;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.scene.fog = new THREE.Fog(PALETTE.fog, 190, 620);
    this.scene.background = new THREE.Color(PALETTE.sky);
  }

  #groundAndRoads() {
    const scene = this.scene;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 760),
      new THREE.MeshLambertMaterial({ color: PALETTE.ground }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Asphalt strips with a painted centre line, one per street.
    const roadTexC = document.createElement('canvas'); roadTexC.width = 128; roadTexC.height = 128;
    const rg = roadTexC.getContext('2d');
    rg.fillStyle = '#33373d'; rg.fillRect(0, 0, 128, 128);
    rg.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 260; i++) rg.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    rg.fillStyle = '#f5d76e'; rg.fillRect(62, 10, 4, 38);
    const roadTex = new THREE.CanvasTexture(roadTexC);
    roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
    roadTex.colorSpace = THREE.SRGBColorSpace;
    const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
    const extent = streetCoord(CITY.halfBlocks) + CITY.blockPitch;
    for (let i = -CITY.halfBlocks; i <= CITY.halfBlocks; i++) {
      const at = streetCoord(i);
      const vTex = roadTex.clone(); vTex.needsUpdate = true; vTex.repeat.set(1, extent / 16);
      const v = new THREE.Mesh(new THREE.PlaneGeometry(CITY.roadHalf * 2, extent * 2), new THREE.MeshLambertMaterial({ map: vTex }));
      v.rotation.x = -Math.PI / 2; v.rotation.z = Math.PI / 2;
      v.position.set(at, 0.02, 0); v.receiveShadow = true; scene.add(v);
      const hTex = roadTex.clone(); hTex.needsUpdate = true; hTex.repeat.set(extent / 16, 1);
      const h = new THREE.Mesh(new THREE.PlaneGeometry(extent * 2, CITY.roadHalf * 2), new THREE.MeshLambertMaterial({ map: hTex }));
      h.rotation.x = -Math.PI / 2;
      h.position.set(0, 0.021, at); h.receiveShadow = true; scene.add(h);
    }

    // Block slabs (sidewalk + plot) under the buildings.
    const slabMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
    const slabGeo = new THREE.BoxGeometry(CITY.blockPitch - CITY.roadHalf * 2, 0.24, CITY.blockPitch - CITY.roadHalf * 2);
    for (let i = -CITY.halfBlocks; i < CITY.halfBlocks; i++)
      for (let j = -CITY.halfBlocks; j < CITY.halfBlocks; j++) {
        const cx = streetCoord(i) + CITY.blockPitch / 2, cz = streetCoord(j) + CITY.blockPitch / 2;
        if (j === -CITY.halfBlocks && (i === 0 || i === 1)) continue; // airfield apron stays bare
        if (i === 3 && j === 3) continue;                              // marina lot is open asphalt
        const slab = new THREE.Mesh(slabGeo, slabMat);
        slab.position.set(cx, 0.12, cz);
        slab.receiveShadow = true;
        scene.add(slab);
        this.blockRects.push({ x: cx, z: cz, half: (CITY.blockPitch - CITY.roadHalf * 2) / 2 });
      }
    // Marina lot asphalt.
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshLambertMaterial({ color: 0x3c4046 }));
    lot.rotation.x = -Math.PI / 2; lot.position.set(161, 0.03, 161); lot.receiveShadow = true;
    scene.add(lot);
    this.blockRects.push({ x: 161, z: 161, half: 18 });
    // Airfield apron.
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(86, 34), new THREE.MeshLambertMaterial({ color: 0x8f8c82 }));
    apron.rotation.x = -Math.PI / 2; apron.position.set(46, 0.03, -161); apron.receiveShadow = true;
    scene.add(apron);
    this.blockRects.push({ x: 46, z: -161, half: 17 });
  }

  #addBuilding(cx, cz, w, d, h, tint, texIndex) {
    const base = this.facadeTextures[texIndex % this.facadeTextures.length];
    const tex = base.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 13)), Math.max(1, Math.round(h / 13)));
    const side = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffc873, emissiveMap: tex, emissiveIntensity: 0.14 });
    const top = new THREE.MeshLambertMaterial({ color: 0x8d8578 });
    const mesh = new THREE.Mesh(this.unitBox, [side, side, top, top, side, side]);
    mesh.scale.set(w, h, d);
    mesh.position.set(cx, h / 2 + 0.24, cz);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
    // Rooftop clutter on taller towers.
    if (h > 22 && this.rng() > 0.4) {
      const tank = new THREE.Mesh(this.unitBox, new THREE.MeshLambertMaterial({ color: 0x9a6b4f }));
      const tw = Math.min(5, w * 0.3);
      tank.scale.set(tw, 3.4, tw);
      tank.position.set(cx + randRange(this.rng, -w / 4, w / 4), h + 0.24 + 1.7, cz + randRange(this.rng, -d / 4, d / 4));
      tank.castShadow = true;
      this.scene.add(tank);
    }
    return mesh;
  }

  #addSign(x, y, z, ry, w, h, text, bg, fg) {
    const tex = signTexture(text, bg, fg);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(x, y, z); sign.rotation.y = ry;
    this.scene.add(sign);
  }

  #buildings() {
    const rng = this.rng;
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.facadeTextures = [];
    for (let t = 0; t < 5; t++)
      this.facadeTextures.push(facadeTexture(rng, PALETTE.buildingTints[t % PALETTE.buildingTints.length], 10, 8));

    const inner = CITY.blockPitch - CITY.roadHalf * 2; // 32m of buildable plot
    for (let i = -CITY.halfBlocks; i < CITY.halfBlocks; i++)
      for (let j = -CITY.halfBlocks; j < CITY.halfBlocks; j++) {
        const cx = streetCoord(i) + CITY.blockPitch / 2, cz = streetCoord(j) + CITY.blockPitch / 2;
        if (j === -CITY.halfBlocks && (i === 0 || i === 1)) continue; // airfield
        if (i === 3 && j === 3) continue;                              // marina lot
        const downtown = clamp(1 - Math.hypot(cx, cz) / 260, 0, 1);
        const tint = () => pick(rng, PALETTE.buildingTints);
        const isClub = i === -1 && j === -1, isGarage = i === 2 && j === 0;
        const isWarehouse = i === 3 && j === -3, isHospital = i === -3 && j === 2;
        if (isClub) {
          this.#addBuilding(cx, cz, 26, 20, 13, 0x3b2d4d, 3);
          this.#addSign(cx, 10.5, cz + 10.15, 0, 20, 4.4, 'CLUB AZAHAR', '#1b1030', '#ff5ea8');
          this.#addSign(cx, 6.4, cz + 10.15, 0, 13, 2.2, 'LIVE MUSIC · OPEN LATE', '#1b1030', '#6ee7ff');
        } else if (isGarage) {
          this.#addBuilding(cx, cz, 24, 18, 8, 0xd8d3c3, 1);
          this.#addSign(cx, 6.6, cz + 9.15, 0, 17, 3, "PIPER'S GARAGE", '#263238', '#ffd23e');
        } else if (isWarehouse) {
          this.#addBuilding(cx, cz, 28, 22, 10, 0x7d7468, 2);
          this.#addSign(cx, 8, cz + 11.15, 0, 15, 2.6, 'HARBOUR FREIGHT', '#333', '#f5f5f5');
        } else if (isHospital) {
          this.#addBuilding(cx, cz, 26, 22, 17, 0xf0f0f0, 4);
          this.#addSign(cx, 14.6, cz + 11.15, 0, 16, 3, 'SOLBAY GENERAL', '#e8e8e8', '#e33d4f');
        } else if (downtown > 0.45 && rng() > 0.35) {
          const h = randRange(rng, 26, 34) + downtown * randRange(rng, 10, 42);
          const bw = randRange(rng, 19, 24), bd = randRange(rng, 19, 24);
          this.#addBuilding(cx, cz, bw, bd, h, tint(), randRange(rng, 0, 4) | 0);
          if (rng() > 0.55) {
            const labels = [['HOTEL MAR', '#123', '#6ee7ff'], ['SOLBAY', '#20142e', '#ffb340'], ['BANCO SOL', '#0f2b1e', '#7dff8a'], ['AZAHAR', '#1b1030', '#ff5ea8']];
            const [txt, bg, fg] = pick(rng, labels);
            this.#addSign(cx, h * 0.82, cz + bd / 2 + 0.15, 0, 15, 3, txt, bg, fg);
          }
        } else {
          const n = 2 + (rng() * 2 | 0);
          for (let k = 0; k < n; k++) {
            const w = randRange(rng, 11, 15), d = randRange(rng, 11, 15);
            const ox = (k % 2 === 0 ? -1 : 1) * (inner / 4) + randRange(rng, -1.5, 1.5);
            const oz = (k < 2 ? -1 : 1) * (inner / 4) + randRange(rng, -1.5, 1.5);
            const h = randRange(rng, 8, 17) + downtown * randRange(rng, 4, 16);
            this.#addBuilding(cx + ox, cz + oz, w, d, h, tint(), randRange(rng, 0, 4) | 0);
          }
        }
        // Parking spots along the block's south and east kerbs (on the road, hugging the edge).
        if (rng() > 0.25) this.parkingSpots.push({ x: cx - 6, z: cz + inner / 2 + 1.7, heading: Math.PI / 2 });
        if (rng() > 0.25) this.parkingSpots.push({ x: cx + 8, z: cz + inner / 2 + 1.7, heading: Math.PI / 2 });
        if (rng() > 0.4) this.parkingSpots.push({ x: cx + inner / 2 + 1.7, z: cz - 4, heading: 0 });
      }
  }

  #palmsAndProps() {
    const rng = this.rng;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 6.4, 5);
    trunkGeo.translate(0, 3.2, 0);
    const leafTex = palmLeafTexture();
    const frondGeo = new THREE.PlaneGeometry(4.6, 2.2);
    frondGeo.translate(0, 1, 0); // pivot at the crown, blade hanging out and down
    const trunks = [], fronds = [];
    const addPalm = (x, z, s) => {
      const lean = randRange(rng, -0.09, 0.09), ry = rng() * Math.PI * 2;
      const base = new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, ry, lean)),
        new THREE.Vector3(s, s, s));
      trunks.push({ geo: trunkGeo, matrix: base.clone() });
      for (let f = 0; f < 6; f++) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(0, 6.3, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, f * Math.PI / 3, 0)),
          new THREE.Vector3(1.4, 1.4, 1.4));
        m.premultiply(base);
        fronds.push({ geo: frondGeo, matrix: m });
      }
    };
    for (let x = -205; x <= 205; x += randRange(rng, 11, 19)) addPalm(x, 224 + randRange(rng, -3, 5), randRange(rng, 0.85, 1.25));
    for (let k = 0; k < 46; k++) {
      const i = Math.floor(randRange(rng, -4, 4)), j = Math.floor(randRange(rng, -4, 4));
      addPalm(streetCoord(i) + CITY.roadHalf + 2.2, streetCoord(j) + randRange(rng, -14, 14), randRange(rng, 0.7, 1.05));
    }
    const trunkMesh = new THREE.Mesh(mergeGeoms(trunks), new THREE.MeshLambertMaterial({ color: 0x8a6b4a }));
    trunkMesh.castShadow = true;
    this.scene.add(trunkMesh);
    const frondMesh = new THREE.Mesh(mergeGeoms(fronds),
      new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, color: 0xbfffc9 }));
    this.scene.add(frondMesh);

    // Streetlights: an instanced pole and lamp head at every intersection corner pair.
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.6, 5); poleGeo.translate(0, 2.8, 0);
    const headGeo = new THREE.SphereGeometry(0.32, 6, 5); headGeo.translate(0, 5.6, 0);
    const spots = [];
    for (const n of this.intersections) { spots.push([n.x + 8.2, n.z + 8.2]); spots.push([n.x - 8.2, n.z - 8.2]); }
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x3a4149 }), spots.length);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xfff2b0 }), spots.length);
    spots.forEach(([x, z], idx) => { const m = mat4(x, 0, z); poles.setMatrixAt(idx, m); heads.setMatrixAt(idx, m); });
    this.scene.add(poles); this.scene.add(heads);

    // Crates and barrels by the warehouse and the alley (with colliders: they are solid).
    const crateMat = new THREE.MeshLambertMaterial({ color: 0xa9825a });
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x707880 });
    const addCrate = (x, z, s) => {
      const crate = new THREE.Mesh(this.unitBox, crateMat);
      crate.scale.set(s, s, s); crate.position.set(x, s / 2, z);
      crate.rotation.y = rng() * 0.6; crate.castShadow = true;
      this.scene.add(crate);
      this.colliders.push({ minX: x - s / 2, maxX: x + s / 2, minZ: z - s / 2, maxZ: z + s / 2, h: s });
    };
    addCrate(150, -100, 2.2); addCrate(152.6, -100, 2.2); addCrate(154.5, -97.5, 1.6);
    addCrate(170, -96, 2.6); addCrate(18, 134, 1.8); addCrate(27, 136, 1.8);
    for (let k = 0; k < 7; k++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 8), barrelMat);
      barrel.position.set(146 + k * 1.4, 0.65, -94 + (k % 2) * 1.6);
      barrel.castShadow = true;
      this.scene.add(barrel);
    }
    // A parked light aircraft on the airfield apron, pure decoration.
    const plane = new THREE.Group();
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 7, 8), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    fus.rotation.z = Math.PI / 2; fus.position.y = 1.3; plane.add(fus);
    const wing = new THREE.Mesh(this.unitBox, new THREE.MeshLambertMaterial({ color: 0xd35400 }));
    wing.scale.set(1.6, 0.12, 6.4); wing.position.y = 1.5; plane.add(wing);
    const tail = new THREE.Mesh(this.unitBox, new THREE.MeshLambertMaterial({ color: 0xd35400 }));
    tail.scale.set(0.14, 1.4, 1); tail.position.set(-3.4, 2, 0); plane.add(tail);
    plane.position.set(58, 0, -168); plane.rotation.y = 0.5;
    plane.traverse((o) => { o.castShadow = true; });
    this.scene.add(plane);
    this.colliders.push({ minX: 53, maxX: 63, minZ: -172, maxZ: -164, h: 3 });
  }

  #beachAndOcean() {
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(760, 52), new THREE.MeshLambertMaterial({ color: PALETTE.sand }));
    sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.01, CITY.beachZ + 24);
    sand.receiveShadow = true;
    this.scene.add(sand);
    const oceanTexC = document.createElement('canvas'); oceanTexC.width = 128; oceanTexC.height = 128;
    const og = oceanTexC.getContext('2d');
    og.fillStyle = '#1e7f96'; og.fillRect(0, 0, 128, 128);
    og.fillStyle = 'rgba(255,255,255,0.13)';
    for (let i = 0; i < 22; i++) og.fillRect(Math.random() * 100, Math.random() * 128, 26, 2);
    this.oceanTex = new THREE.CanvasTexture(oceanTexC);
    this.oceanTex.wrapS = this.oceanTex.wrapT = THREE.RepeatWrapping;
    this.oceanTex.repeat.set(24, 8);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(760, 190),
      new THREE.MeshPhongMaterial({ color: PALETTE.ocean, map: this.oceanTex, shininess: 90, specular: 0x99ddff }));
    ocean.rotation.x = -Math.PI / 2; ocean.position.set(0, 0.06, CITY.oceanZ + 92);
    this.scene.add(ocean);
    // Pier 9: a wooden deck on posts running out over the water.
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x9a7a52 });
    const deck = new THREE.Mesh(this.unitBox, deckMat);
    deck.scale.set(6, 0.5, 46); deck.position.set(30, 0.32, 240);
    deck.castShadow = true; deck.receiveShadow = true;
    this.scene.add(deck);
    for (let k = 0; k < 5; k++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 6), deckMat);
      post.position.set(27.6, -0.2, 222 + k * 10); this.scene.add(post);
      const post2 = post.clone(); post2.position.x = 32.4; this.scene.add(post2);
    }
    this.pierRect = { minX: 27, maxX: 33, minZ: 217, maxZ: 263 };
  }

  #backdrop() {
    // A ring of far silhouette towers so the horizon never looks empty.
    const mat = new THREE.MeshBasicMaterial({ color: 0x6f87a8 });
    for (let k = 0; k < 42; k++) {
      const a = (k / 42) * Math.PI * 2;
      if (Math.sin(a) > 0.55) continue; // keep the ocean horizon open
      const r = randRange(this.rng, 400, 520);
      const h = randRange(this.rng, 30, 95);
      const tower = new THREE.Mesh(this.unitBox, mat);
      tower.scale.set(randRange(this.rng, 18, 34), h, randRange(this.rng, 18, 34));
      tower.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      this.scene.add(tower);
    }
    // The sun itself: a warm disc low in the west.
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(13, 24),
      new THREE.MeshBasicMaterial({ color: 0xffdf8f, fog: false }));
    sunDisc.position.set(-460, 175, 300);
    sunDisc.lookAt(0, 40, 0);
    this.scene.add(sunDisc);
  }

  // Per-frame housekeeping: drift the ocean texture, follow the player with the shadow camera.
  update(dt, focus) {
    if (this.oceanTex) this.oceanTex.offset.x += dt * 0.008;
    if (focus && this.sun) {
      this.sun.position.set(focus.x - 140, 190, focus.z + 90);
      this.sun.target.position.set(focus.x, 0, focus.z);
    }
  }

  groundHeight(x, z) {
    const p = this.pierRect;
    if (p && x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return 0.57;
    return 0;
  }

  isOnRoad(x, z) {
    const mod = (v) => ((v % CITY.blockPitch) + CITY.blockPitch) % CITY.blockPitch;
    const mx = mod(x), mz = mod(z);
    const nearStreet = (m) => m < CITY.roadHalf || m > CITY.blockPitch - CITY.roadHalf;
    return nearStreet(mx) || nearStreet(mz);
  }

  // Push a circle (an entity) out of every building box and inside the world edge.
  resolveCircle(pos, radius) {
    for (const c of this.colliders) {
      const nx = clamp(pos.x, c.minX, c.maxX), nz = clamp(pos.z, c.minZ, c.maxZ);
      const dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: leave by the nearest face.
        const left = pos.x - c.minX, right = c.maxX - pos.x, top = pos.z - c.minZ, bottom = c.maxZ - pos.z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) pos.x = c.minX - radius;
        else if (m === right) pos.x = c.maxX + radius;
        else if (m === top) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
    pos.x = clamp(pos.x, -WORLD_EDGE, WORLD_EDGE);
    pos.z = clamp(pos.z, -WORLD_EDGE, Math.max(WORLD_EDGE, pos.z));
    return pos;
  }
}
