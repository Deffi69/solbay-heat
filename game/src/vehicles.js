// vehicles.js — the cars of Solbay: a low-poly car factory (sedans, coupes, sports cars, vans
// and police interceptors built from boxes and cylinders), an arcade car physics step shared by
// the player, traffic and police, and the traffic system that keeps the streets moving with
// right-hand lane driving between intersections.

import * as THREE from 'three';
import { CITY, PALETTE, TUNING, streetCoord } from './config.js';
import { pick, randRange, clamp, angleDelta } from './random.js';

const bodyGeo = new THREE.BoxGeometry(1.82, 0.62, 4.3);
const cabinGeo = new THREE.BoxGeometry(1.62, 0.55, 2.1);
const sportBodyGeo = new THREE.BoxGeometry(1.92, 0.5, 4.5);
const vanBodyGeo = new THREE.BoxGeometry(1.95, 1.5, 4.6);
const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.26, 10);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x15161a });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x1c2f42 });
const trimMat = new THREE.MeshLambertMaterial({ color: 0x22242a });
const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff6c9 });
const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff2a33 });

// Build one car's meshes. kind: 'sedan' | 'coupe' | 'sports' | 'van' | 'police'.
// The group faces +Z; wheels are in userData so the driver can spin them.
export function makeCarMesh(kind, colorHex) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: colorHex });
  let body;
  if (kind === 'van') {
    body = new THREE.Mesh(vanBodyGeo, paint); body.position.y = 1.05;
    const cab = new THREE.Mesh(cabinGeo, glassMat); cab.scale.set(1.05, 0.62, 0.6); cab.position.set(0, 1.62, 1.75); group.add(cab);
  } else if (kind === 'sports') {
    body = new THREE.Mesh(sportBodyGeo, paint); body.position.y = 0.48;
    const cab = new THREE.Mesh(cabinGeo, glassMat); cab.scale.set(0.92, 0.72, 0.9); cab.position.set(0, 0.86, -0.25); group.add(cab);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.42), trimMat);
    spoiler.position.set(0, 0.92, -2.05); group.add(spoiler);
  } else {
    body = new THREE.Mesh(bodyGeo, paint); body.position.y = 0.58;
    const cab = new THREE.Mesh(cabinGeo, glassMat); cab.position.set(0, 1.08, -0.25); group.add(cab);
  }
  body.castShadow = true;
  group.add(body);
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.24, 0.3), trimMat);
  bumperF.position.set(0, 0.38, 2.12); group.add(bumperF);
  const bumperB = bumperF.clone(); bumperB.position.z = -2.12; group.add(bumperB);
  for (const sx of [-0.72, 0.72]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.06), headlightMat);
    hl.position.set(sx, 0.62, 2.16); group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), taillightMat);
    tl.position.set(sx, 0.66, -2.16); group.add(tl);
  }
  const wheels = [];
  const wheelY = 0.35, wheelX = 0.86, wheelZF = 1.42, wheelZB = -1.42;
  for (const [wx, wz] of [[-wheelX, wheelZF], [wheelX, wheelZF], [-wheelX, wheelZB], [wheelX, wheelZB]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, wheelY, wz);
    w.castShadow = true;
    group.add(w); wheels.push(w);
  }
  if (kind === 'police') {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.3, 4.34), new THREE.MeshLambertMaterial({ color: 0x1c2f42 }));
    stripe.position.y = 0.52; group.add(stripe);
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.09, 0.4), trimMat);
    barBase.position.set(0, 1.42, -0.25); group.add(barBase);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0xff2233 }));
    red.position.set(-0.3, 1.54, -0.25); group.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.set(0.3, 1.54, -0.25); group.add(blue);
    group.userData.lightbar = [red, blue];
  }
  group.userData.wheels = wheels;
  return group;
}

// One car in the world: a mesh, a heading, a speed, and whoever is driving it.
export class Car {
  constructor(scene, kind, colorHex, x, z, heading) {
    this.kind = kind;
    this.group = makeCarMesh(kind, colorHex);
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.steerVisual = 0;
    this.health = 100;
    this.occupied = false;     // the player is in it
    this.userData = {};        // per-car scratch space (routes, timers) for the AI systems
    this.driver = null;        // 'traffic' | 'police' | 'hostile' | 'player' | null (parked)
    this.stolen = false;
    this.dead = false;
    scene.add(this.group);
  }
  get pos() { return this.group.position; }
  forwardX() { return Math.sin(this.heading); }
  forwardZ() { return Math.cos(this.heading); }

  // Arcade drive step. throttle -1..1, steer -1..1 (left positive), handbrake bool.
  drive(dt, throttle, steer, handbrake) {
    const baseTop = this.kind === 'sports' ? 34 : this.kind === 'police' ? 31 : this.kind === 'van' ? 22 : 27;
    const topSpeed = this.boosting ? baseTop * 1.18 : baseTop;
    const accel = throttle >= 0 ? TUNING.carAccel * (this.kind === 'sports' ? 1.35 : 1) * (this.boosting ? 1.3 : 1) : TUNING.carBrake;
    if (throttle !== 0) this.speed += accel * throttle * dt * (this.speed < 0 && throttle > 0 ? 2.2 : 1);
    const drag = TUNING.carDrag * this.speed + 0.012 * this.speed * Math.abs(this.speed);
    this.speed -= drag * dt;
    if (handbrake) this.speed -= this.speed * 2.4 * dt;
    if (throttle === 0) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 2.2 * dt);
    this.speed = clamp(this.speed, -9, topSpeed);
    const steerAuthority = clamp(this.speed / 7, -1, 1);
    this.heading += steer * TUNING.carTurnRate * steerAuthority * dt * (handbrake ? 1.5 : 1);
    this.steerVisual = steer;
    this.pos.x += this.forwardX() * this.speed * dt;
    this.pos.z += this.forwardZ() * this.speed * dt;
    this.#pose();
  }

  // Roll to a stop and settle the mesh (used for parked and wrecked cars).
  coast(dt) {
    this.speed -= this.speed * 1.8 * dt;
    if (Math.abs(this.speed) < 0.02) this.speed = 0;
    this.pos.x += this.forwardX() * this.speed * dt;
    this.pos.z += this.forwardZ() * this.speed * dt;
    this.#pose();
  }

  #pose() {
    this.group.position.y = 0;
    this.group.rotation.set(0, this.heading, 0);
    const spin = this.speed * 0.11;
    for (const w of this.group.userData.wheels) w.rotation.x += spin;
    const front = this.group.userData.wheels.slice(0, 2);
    for (const w of front) w.rotation.y = this.steerVisual * 0.42;
  }

  dispose(scene) { scene.remove(this.group); }
}

// The lane point for a car travelling from intersection A to intersection B (right-hand side).
export function lanePoint(a, b, t) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const ox = (-dz / len) * CITY.laneOffset, oz = (dx / len) * CITY.laneOffset;
  return { x: a.x + dx * t + ox, z: a.z + dz * t + oz };
}

function neighbours(node) {
  const out = [];
  const H = CITY.halfBlocks;
  if (node.i > -H) out.push({ i: node.i - 1, j: node.j });
  if (node.i < H) out.push({ i: node.i + 1, j: node.j });
  if (node.j > -H) out.push({ i: node.i, j: node.j - 1 });
  if (node.j < H) out.push({ i: node.i, j: node.j + 1 });
  return out.map((n) => ({ ...n, x: streetCoord(n.i), z: streetCoord(n.j) }));
}

// Keeps a fleet of AI cars circulating the grid: each follows a lane from intersection to
// intersection, slows for the car in front, and respawns near the player when it strays far.
export class TrafficSystem {
  constructor(scene, world, rng, count = 20) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.cars = [];
    for (let k = 0; k < count; k++) {
      const kind = pick(rng, ['sedan', 'sedan', 'coupe', 'sports', 'van']);
      const car = new Car(scene, kind, pick(rng, PALETTE.carPaints), 0, 0, 0);
      car.driver = 'traffic';
      this.#placeOnRandomSegment(car, null);
      this.cars.push(car);
    }
  }

  #placeOnRandomSegment(car, near) {
    const H = CITY.halfBlocks;
    let i, j;
    if (near) {
      const ni = Math.round(near.x / CITY.blockPitch), nj = Math.round(near.z / CITY.blockPitch);
      i = clamp(ni + Math.floor(randRange(this.rng, -3, 3)), -H, H);
      j = clamp(nj + Math.floor(randRange(this.rng, -3, 3)), -H, H);
    } else {
      i = Math.floor(randRange(this.rng, -H, H + 1));
      j = Math.floor(randRange(this.rng, -H, H + 1));
    }
    const a = { i, j, x: streetCoord(i), z: streetCoord(j) };
    const options = neighbours(a);
    const b = pick(this.rng, options);
    car.userData.route = { a, b };
    const t = this.rng() * 0.7;
    const p = lanePoint(a, b, t);
    car.pos.set(p.x, 0, p.z);
    car.heading = Math.atan2(b.x - a.x, b.z - a.z);
    car.speed = TUNING.trafficSpeed * randRange(this.rng, 0.7, 1);
    car.group.rotation.y = car.heading;
  }

  update(dt, playerPos, allCars, onHonk) {
    for (const car of this.cars) {
      if (car.driver !== 'traffic') continue; // stolen: no longer ours
      if (car.dead) { car.coast(dt); continue; }
      const dxp = car.pos.x - playerPos.x, dzp = car.pos.z - playerPos.z;
      if (dxp * dxp + dzp * dzp > 300 * 300) { this.#placeOnRandomSegment(car, playerPos); continue; }
      const route = car.userData.route;
      const target = lanePoint(route.a, route.b, 1);
      const distToEnd = Math.hypot(target.x - car.pos.x, target.z - car.pos.z);
      if (distToEnd < 7) {
        const options = neighbours(route.b).filter((n) => !(n.i === route.a.i && n.j === route.a.j));
        const next = options.length ? pick(this.rng, options) : route.a;
        car.userData.route = { a: route.b, b: next };
        continue;
      }
      // Look ahead along the segment for the next corner, so turns start early and wide.
      const look = lanePoint(route.a, route.b, clamp(1 - (distToEnd - 16) / CITY.blockPitch, 0, 1));
      const desired = Math.atan2(look.x - car.pos.x, look.z - car.pos.z);
      const delta = angleDelta(car.heading, desired);
      const steer = clamp(delta * 1.6, -1, 1);
      // Slow for anything close ahead (another car, or the player's car standing in the road).
      let throttle = 0.55, blocked = false;
      for (const other of allCars) {
        if (other === car || other.dead) continue;
        const ox = other.pos.x - car.pos.x, oz = other.pos.z - car.pos.z;
        const ahead = ox * car.forwardX() + oz * car.forwardZ();
        const side = Math.abs(ox * car.forwardZ() - oz * car.forwardX());
        if (ahead > 0 && ahead < 10 && side < 2.4) { throttle = ahead < 5.5 ? -0.4 : 0.05; blocked = true; break; }
      }
      if (blocked && this.rng() < dt * 0.25) onHonk?.();
      const cruise = TUNING.trafficSpeed * (car.kind === 'sports' ? 1.25 : 1);
      if (car.speed > cruise) throttle = Math.min(throttle, 0);
      car.drive(dt, throttle, steer, false);
      this.world.resolveCircle(car.pos, 1.6);
    }
  }
}

// Parked cars along the kerbs and in the marina lot: the player's supply of stealable wheels.
export function spawnParkedCars(scene, world, rng) {
  const cars = [];
  const spots = world.parkingSpots.filter(() => rng() > 0.35).slice(0, 42);
  for (const s of spots) {
    const kind = pick(rng, ['sedan', 'sedan', 'coupe', 'van', 'sports']);
    const car = new Car(scene, kind, pick(rng, PALETTE.carPaints), s.x, s.z, s.heading + randRange(rng, -0.05, 0.05));
    car.group.rotation.y = car.heading;
    cars.push(car);
  }
  return cars;
}
