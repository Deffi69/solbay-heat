// pedestrians.js — the people of Solbay: low-poly walkers who stroll the sidewalks block by
// block, flee from danger, and fall when hurt. The same class plays the story's hostile
// lookouts, who close in on the player and shoot. Bodies are boxes and spheres with swinging
// legs, cheap enough for a crowd.

import * as THREE from 'three';
import { CITY, PALETTE, streetCoord } from './config.js';
import { pick, randRange, clamp, angleDelta } from './random.js';

const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
const headGeo = new THREE.SphereGeometry(0.21, 8, 7);
const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.2);
legGeo.translate(0, -0.39, 0);
const armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.16);
armGeo.translate(0, -0.28, 0);
const skinMats = [0xf1c27d, 0xe0ac69, 0x8d5524, 0xffdbac, 0x6b4423].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const pantsMats = [0x2c3e50, 0x5d4037, 0x37474f, 0x6a1b9a, 0x827717].map((c) => new THREE.MeshLambertMaterial({ color: c }));

export class Ped {
  constructor(scene, rng, x, z) {
    this.group = new THREE.Group();
    const shirt = new THREE.MeshLambertMaterial({ color: pick(rng, PALETTE.pedShirts) });
    const skin = pick(rng, skinMats);
    const pants = pick(rng, pantsMats);
    this.torso = new THREE.Mesh(torsoGeo, shirt); this.torso.position.y = 1.12; this.torso.castShadow = true;
    this.head = new THREE.Mesh(headGeo, skin); this.head.position.y = 1.68;
    this.legL = new THREE.Mesh(legGeo, pants); this.legL.position.set(-0.14, 0.78, 0);
    this.legR = new THREE.Mesh(legGeo, pants); this.legR.position.set(0.14, 0.78, 0);
    this.armL = new THREE.Mesh(armGeo, shirt); this.armL.position.set(-0.34, 1.42, 0);
    this.armR = new THREE.Mesh(armGeo, shirt); this.armR.position.set(0.34, 1.42, 0);
    this.group.add(this.torso, this.head, this.legL, this.legR, this.armL, this.armR);
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    this.heading = rng() * Math.PI * 2;
    this.speed = 0;
    this.walkSpeed = randRange(rng, 1.1, 1.7);
    this.phase = rng() * 6;
    this.state = 'walk';         // walk | flee | down
    this.health = 100;
    this.hostile = false;
    this.fleeFrom = null;
    this.fleeTime = 0;
    this.shootTimer = randRange(rng, 0.6, 1.4);
    this.waypoint = null;
    this.blockI = 0; this.blockJ = 0; this.corner = 0;
  }
  get pos() { return this.group.position; }
  get down() { return this.state === 'down'; }

  knockDown() {
    if (this.down) return;
    this.state = 'down';
    this.group.rotation.x = -Math.PI / 2;
    this.group.position.y = 0.25;
    this.speed = 0;
  }

  flee(fromX, fromZ, seconds = 5) {
    if (this.down || this.hostile) return;
    this.state = 'flee';
    this.fleeFrom = { x: fromX, z: fromZ };
    this.fleeTime = seconds;
  }

  #walkTo(dt, tx, tz, speed) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) return true;
    const desired = Math.atan2(dx, dz);
    this.heading += clamp(angleDelta(this.heading, desired), -3.4 * dt, 3.4 * dt);
    this.speed = speed;
    this.pos.x += Math.sin(this.heading) * speed * dt;
    this.pos.z += Math.cos(this.heading) * speed * dt;
    return false;
  }

  update(dt, ctx) {
    if (this.down) return;
    this.phase += dt * (4 + this.speed * 2.4);
    const swing = Math.sin(this.phase) * clamp(this.speed * 0.3, 0, 0.55);
    this.legL.rotation.x = swing; this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8; this.armR.rotation.x = swing * 0.8;
    this.group.rotation.y = this.heading;
    this.group.position.y = ctx.groundHeight(this.pos.x, this.pos.z);

    if (this.hostile) { this.#updateHostile(dt, ctx); return; }

    if (this.state === 'flee') {
      this.fleeTime -= dt;
      const away = Math.atan2(this.pos.x - this.fleeFrom.x, this.pos.z - this.fleeFrom.z);
      this.#walkTo(dt, this.pos.x + Math.sin(away) * 12, this.pos.z + Math.cos(away) * 12, 4.6);
      if (this.fleeTime <= 0) { this.state = 'walk'; this.waypoint = null; }
      return;
    }
    // Stroll the sidewalk rectangle of the current block, corner to corner.
    if (!this.waypoint) this.waypoint = this.#cornerPoint();
    if (this.#walkTo(dt, this.waypoint.x, this.waypoint.z, this.walkSpeed)) {
      this.corner = (this.corner + 1) % 4;
      if (this.corner === 0 && ctx.rng() > 0.55) {
        // Drift to a neighbouring block now and then, crossing at the corner.
        this.blockI = clamp(this.blockI + (ctx.rng() > 0.5 ? 1 : -1), -CITY.halfBlocks, CITY.halfBlocks - 1);
        this.blockJ = clamp(this.blockJ + (ctx.rng() > 0.5 ? 1 : -1), -CITY.halfBlocks, CITY.halfBlocks - 1);
      }
      this.waypoint = this.#cornerPoint();
    }
  }

  #cornerPoint() {
    const cx = streetCoord(this.blockI) + CITY.blockPitch / 2;
    const cz = streetCoord(this.blockJ) + CITY.blockPitch / 2;
    const inset = 14.2;
    const corners = [
      { x: cx - inset, z: cz - inset }, { x: cx + inset, z: cz - inset },
      { x: cx + inset, z: cz + inset }, { x: cx - inset, z: cz + inset },
    ];
    return corners[this.corner];
  }

  #updateHostile(dt, ctx) {
    const p = ctx.playerPos;
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (d > 20) this.#walkTo(dt, p.x, p.z, 3.4);
    else if (d < 7) this.#walkTo(dt, this.pos.x - (p.x - this.pos.x), this.pos.z - (p.z - this.pos.z), 2.2);
    else { this.speed = 0; this.heading = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); this.group.rotation.y = this.heading; }
    this.shootTimer -= dt;
    if (d < 30 && this.shootTimer <= 0) {
      this.shootTimer = randRange(ctx.rng, 0.9, 1.6);
      ctx.onHostileShot?.(this, d);
    }
  }

  dispose(scene) { scene.remove(this.group); }
}

// A living crowd: walkers are recycled to blocks near the player so the streets around the
// action are never empty, and far quiet streets cost nothing.
export class PedestrianSystem {
  constructor(scene, world, rng, count = 40) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.peds = [];
    for (let k = 0; k < count; k++) {
      const ped = new Ped(scene, rng, 0, 0);
      this.#placeNear(ped, null);
      this.peds.push(ped);
    }
  }

  #placeNear(ped, near) {
    const H = CITY.halfBlocks;
    let bi, bj;
    if (near) {
      bi = clamp(Math.floor(near.x / CITY.blockPitch) + Math.floor(randRange(this.rng, -2, 2)), -H, H - 1);
      bj = clamp(Math.floor(near.z / CITY.blockPitch) + Math.floor(randRange(this.rng, -2, 2)), -H, H - 1);
    } else {
      bi = Math.floor(randRange(this.rng, -H, H));
      bj = Math.floor(randRange(this.rng, -H, H));
    }
    ped.blockI = bi; ped.blockJ = bj;
    ped.corner = Math.floor(this.rng() * 4);
    ped.waypoint = null;
    const cx = streetCoord(bi) + CITY.blockPitch / 2, cz = streetCoord(bj) + CITY.blockPitch / 2;
    ped.pos.set(cx + randRange(this.rng, -13, 13), 0, cz + randRange(this.rng, -13, 13));
    if (ped.down) { // a recycled body stands back up, far from the scene of the crime
      ped.state = 'walk'; ped.health = 100;
      ped.group.rotation.x = 0; ped.group.position.y = 0;
    }
  }

  spawnAt(x, z, hostile = false) {
    const ped = new Ped(this.scene, this.rng, x, z);
    ped.hostile = hostile;
    if (hostile) { ped.health = 100; ped.walkSpeed = 3.2; }
    this.peds.push(ped);
    return ped;
  }

  update(dt, ctx) {
    for (const ped of this.peds) {
      if (ped.hostile) { ped.update(dt, ctx); continue; }
      const dx = ped.pos.x - ctx.playerPos.x, dz = ped.pos.z - ctx.playerPos.z;
      if (dx * dx + dz * dz > 240 * 240) { this.#placeNear(ped, ctx.playerPos); continue; }
      ped.update(dt, ctx);
      this.world.resolveCircle(ped.pos, 0.4);
    }
  }

  fleeArea(x, z, radius) {
    for (const ped of this.peds) {
      if (ped.down || ped.hostile) continue;
      if (Math.hypot(ped.pos.x - x, ped.pos.z - z) < radius) ped.flee(x, z);
    }
  }
}
