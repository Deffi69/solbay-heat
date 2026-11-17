// combat.js — gunfire and fists: a pooled particle system (sparks, smoke, muzzle flashes), a
// tracer line pool, and the analytic ray tests that decide what a shot or a punch actually
// hit — pedestrians (with a headshot bonus), cars, and police interceptors.

import * as THREE from 'three';
import { TUNING } from './config.js';

const MAX_PARTICLES = 420;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.tracers = [];
    for (let k = 0; k < 10; k++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerHead = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -50;
  }

  burst(x, y, z, colorHex, count, speed = 4, life = 0.5, up = 2) {
    const color = new THREE.Color(colorHex);
    for (let n = 0; n < count; n++) {
      const i = this.head; this.head = (this.head + 1) % MAX_PARTICLES;
      this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, r = Math.random() * speed;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = Math.random() * up;
      this.vel[i * 3 + 2] = Math.sin(a) * r;
      this.colors[i * 3] = color.r; this.colors[i * 3 + 1] = color.g; this.colors[i * 3 + 2] = color.b;
      this.life[i] = this.maxLife[i] = life * (0.5 + Math.random() * 0.7);
    }
  }

  tracer(from, to) {
    const t = this.tracers[this.tracerHead];
    this.tracerHead = (this.tracerHead + 1) % this.tracers.length;
    const attr = t.line.geometry.attributes.position;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    t.life = 0.07;
    t.line.material.opacity = 0.9;
  }

  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.positions[i * 3 + 1] = -50; continue; }
      this.vel[i * 3 + 1] -= 5.5 * dt;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    for (const t of this.tracers) {
      if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9; }
    }
  }
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const t = lx * dx + ly * dy + lz * dz;
  if (t < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - t * t;
  if (d2 > r * r) return -1;
  return t - Math.sqrt(r * r - d2);
}

// Resolves the player's attacks. The game keeps the registries; this class only does maths
// and effects, and reports what was hit through the returned record.
export class Combat {
  constructor(effects) {
    this.effects = effects;
    this.cooldown = 0;
    this.ammo = TUNING.magazine;
    this.reloading = 0;
  }

  // origin: Vector3 at the player's shoulder; dir: normalised Vector3 from the camera.
  // Returns {kind:'ped'|'car', target, point, headshot} or {kind:'miss', point}.
  shoot(origin, dir, peds, cars) {
    let bestT = TUNING.pistolRange, hit = null;
    for (const ped of peds) {
      if (ped.down) continue;
      const p = ped.pos;
      const headT = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, p.x, p.y + 1.68, p.z, 0.26);
      if (headT > 0 && headT < bestT) { bestT = headT; hit = { kind: 'ped', target: ped, headshot: true }; continue; }
      const bodyT = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, p.x, p.y + 1.05, p.z, 0.58);
      if (bodyT > 0 && bodyT < bestT) { bestT = bodyT; hit = { kind: 'ped', target: ped, headshot: false }; }
    }
    for (const car of cars) {
      if (car.dead) continue;
      const p = car.pos;
      const t = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, p.x, 0.75, p.z, 2.35);
      if (t > 0 && t < bestT) { bestT = t; hit = { kind: 'car', target: car, headshot: false }; }
    }
    const point = new THREE.Vector3(
      origin.x + dir.x * bestT, origin.y + dir.y * bestT, origin.z + dir.z * bestT);
    const muzzle = new THREE.Vector3(origin.x + dir.x * 0.7, origin.y - 0.12, origin.z + dir.z * 0.7);
    this.effects.tracer(muzzle, point);
    this.effects.burst(muzzle.x, muzzle.y, muzzle.z, 0xffca66, 3, 1.2, 0.12, 0.4);
    if (hit) {
      const sparkColor = hit.kind === 'ped' ? 0xd8404f : 0xffb340;
      this.effects.burst(point.x, point.y, point.z, sparkColor, hit.kind === 'ped' ? 8 : 10, 3, 0.4, 1.6);
    }
    return hit ? { ...hit, point } : { kind: 'miss', point };
  }

  // A punch: anything within reach in front of the player. Returns the ped hit, or null.
  punch(playerPos, heading, peds) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    for (const ped of peds) {
      if (ped.down) continue;
      const dx = ped.pos.x - playerPos.x, dz = ped.pos.z - playerPos.z;
      if (Math.hypot(dx, dz) < 1.7 && dx * fx + dz * fz > 0.2) return ped;
    }
    return null;
  }
}
