// police.js — the law of Solbay: a wanted system (heat that rises with witnessed crime and
// cools when the player breaks line of sight) and the police pursuit AI. Interceptors route
// through the street grid by breadth-first search, switch to a direct chase near the player,
// ram the player's car, and shoot on foot at high wanted levels.

import { CITY, TUNING, streetCoord } from './config.js';
import { clamp, angleDelta } from './random.js';
import { Car, lanePoint } from './vehicles.js';

export class WantedSystem {
  constructor() {
    this.heat = 0;          // 0..5, fractional
    this.lockFloor = 0;     // missions can hold the heat at a minimum
    this.unseenTime = 0;
  }
  get stars() { return Math.floor(this.heat + 0.0001); }
  get active() { return this.heat >= 1; }

  reportCrime(amount) {
    this.heat = clamp(this.heat + amount, 0, 5);
  }

  clear() { this.heat = 0; this.lockFloor = 0; this.unseenTime = 0; }

  update(dt, playerSeen) {
    if (playerSeen) this.unseenTime = 0; else this.unseenTime += dt;
    if (this.unseenTime > 7 && this.heat > this.lockFloor) {
      this.heat = Math.max(this.lockFloor, this.heat - TUNING.wantedDecayPerSec * dt * Math.max(1, this.stars));
    }
    if (this.heat < 1 && this.lockFloor < 1 && this.unseenTime > 7) this.heat = Math.max(0, this.heat - dt * 0.05);
  }
}

function nodeKey(i, j) { return i * 32 + j; }

// Breadth-first route across the intersection grid, as world-space points.
export function findRoute(fromX, fromZ, toX, toZ) {
  const H = CITY.halfBlocks;
  const snap = (x, z) => ({
    i: clamp(Math.round(x / CITY.blockPitch), -H, H),
    j: clamp(Math.round(z / CITY.blockPitch), -H, H),
  });
  const start = snap(fromX, fromZ), goal = snap(toX, toZ);
  if (start.i === goal.i && start.j === goal.j) return [{ x: toX, z: toZ }];
  const prev = new Map();
  const queue = [start];
  prev.set(nodeKey(start.i, start.j), null);
  while (queue.length) {
    const cur = queue.shift();
    if (cur.i === goal.i && cur.j === goal.j) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = cur.i + di, nj = cur.j + dj;
      if (ni < -H || ni > H || nj < -H || nj > H) continue;
      const k = nodeKey(ni, nj);
      if (prev.has(k)) continue;
      prev.set(k, cur);
      queue.push({ i: ni, j: nj });
    }
  }
  const path = [];
  let cur = goal;
  while (cur) {
    path.unshift({ x: streetCoord(cur.i), z: streetCoord(cur.j) });
    cur = prev.get(nodeKey(cur.i, cur.j));
  }
  path.push({ x: toX, z: toZ });
  return path;
}

export class PoliceSystem {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.cars = [];
    this.respawnTimer = 0;
  }

  desiredCount(stars) { return [0, 1, 2, 3, 4, 6][clamp(stars, 0, 5)]; }

  #spawn(playerPos) {
    // Appear at an intersection well away from the player, never in plain sight.
    const H = CITY.halfBlocks;
    let best = null, bestScore = -1;
    for (let tries = 0; tries < 12; tries++) {
      const i = Math.floor((this.rng() * (2 * H + 1))) - H;
      const j = Math.floor((this.rng() * (2 * H + 1))) - H;
      const x = streetCoord(i), z = streetCoord(j);
      const d = Math.hypot(x - playerPos.x, z - playerPos.z);
      const score = d > 75 && d < 190 ? 200 - Math.abs(d - 120) : d >= 190 ? 50 : -1;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    if (!best) return;
    const car = new Car(this.scene, 'police', 0xf4f6f8, best.x, best.z, this.rng() * Math.PI * 2);
    car.driver = 'police';
    car.userData.route = null;
    car.userData.routeTimer = 0;
    car.userData.shootTimer = 1 + this.rng();
    this.cars.push(car);
  }

  // True when any live officer can see the player (close enough; buildings ignored for feel).
  anySeesPlayer(playerPos) {
    for (const car of this.cars) {
      if (car.dead) continue;
      if (Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z) < 48) return true;
    }
    return false;
  }

  nearestDistance(playerPos) {
    let best = Infinity;
    for (const car of this.cars) {
      if (car.dead) continue;
      best = Math.min(best, Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z));
    }
    return best;
  }

  update(dt, ctx) {
    const { wanted, playerPos, playerCar, timeSec } = ctx;
    const want = this.desiredCount(wanted.stars);
    this.respawnTimer -= dt;
    const alive = this.cars.filter((c) => !c.dead);
    if (alive.length < want && this.respawnTimer <= 0) {
      this.#spawn(playerPos);
      this.respawnTimer = 2.2;
    }
    // Retire units when the heat is gone: they peel off and despawn far away.
    if (want === 0) {
      for (const car of this.cars) {
        car.coast(dt);
        if (Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z) > 120) { car.dispose(this.scene); car.dead = true; }
      }
      this.cars = this.cars.filter((c) => !c.dead);
      return;
    }
    const target = playerCar && !playerCar.dead ? playerCar.pos : playerPos;
    for (const car of this.cars) {
      if (car.dead) { car.coast(dt); continue; }
      // Flash the light bar.
      const bar = car.group.userData.lightbar;
      if (bar) {
        const phase = Math.sin(timeSec * 10 + car.pos.x) > 0;
        bar[0].visible = phase; bar[1].visible = !phase;
      }
      car.userData.routeTimer -= dt;
      const distToPlayer = Math.hypot(target.x - car.pos.x, target.z - car.pos.z);
      let aim;
      if (distToPlayer < 34) {
        // Direct chase: aim where the target will be in half a second.
        const tvx = playerCar ? playerCar.forwardX() * playerCar.speed : 0;
        const tvz = playerCar ? playerCar.forwardZ() * playerCar.speed : 0;
        aim = { x: target.x + tvx * 0.5, z: target.z + tvz * 0.5 };
      } else {
        if (!car.userData.route || car.userData.routeTimer <= 0) {
          car.userData.route = findRoute(car.pos.x, car.pos.z, target.x, target.z);
          car.userData.routeTimer = 1.6;
          car.userData.routeIdx = 1;
        }
        const route = car.userData.route;
        let idx = car.userData.routeIdx || 1;
        while (idx < route.length - 1 && Math.hypot(route[idx].x - car.pos.x, route[idx].z - car.pos.z) < 9) idx++;
        car.userData.routeIdx = idx;
        const a = route[Math.max(0, idx - 1)], b = route[idx];
        aim = lanePoint(a, b, 1);
        if (idx === route.length - 1) aim = { x: target.x, z: target.z };
      }
      const desired = Math.atan2(aim.x - car.pos.x, aim.z - car.pos.z);
      const delta = angleDelta(car.heading, desired);
      const steer = clamp(delta * 1.9, -1, 1);
      let throttle = 1;
      if (Math.abs(delta) > 2.2) throttle = -0.6;                 // badly turned around: reverse out
      else if (Math.abs(delta) > 1.1 && car.speed > 6) throttle = -0.5;
      if (distToPlayer < 7 && !playerCar) throttle = 0.1;          // on foot: pull up beside the player
      if (car.speed > TUNING.policeSpeed && distToPlayer > 20) throttle = 0.2;
      car.drive(dt, throttle, steer, false);
      this.world.resolveCircle(car.pos, 1.7);
      // Shooting from the car at a fleeing on-foot player, only when the heat is high.
      if (!playerCar && wanted.stars >= 3 && distToPlayer < 27) {
        car.userData.shootTimer -= dt;
        if (car.userData.shootTimer <= 0) {
          car.userData.shootTimer = 0.8 + this.rng() * 0.7;
          ctx.onPoliceShot?.(car, distToPlayer);
        }
      }
    }
    // Wrecks stay in the world a while, then are towed (removed) to keep the fleet fresh.
    for (const car of this.cars) {
      if (car.dead) {
        car.userData.towTimer = (car.userData.towTimer ?? 14) - dt;
        if (car.userData.towTimer <= 0) car.dispose(this.scene);
      }
    }
    this.cars = this.cars.filter((c) => !c.dead || (c.userData.towTimer ?? 1) > 0);
  }

  clearAll() {
    for (const car of this.cars) car.dispose(this.scene);
    this.cars = [];
  }
}
