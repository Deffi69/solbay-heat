// player.js — RENO VALE, the player character: a low-poly figure with swinging limbs and a
// draw-able pistol, the on-foot controller (walk, sprint, jump, camera-relative movement),
// the driving controls that feed the shared car physics, entering and stealing cars, and the
// third-person camera with building-aware pull-in.

import * as THREE from 'three';
import { TUNING, WORLD_EDGE } from './config.js';
import { clamp, angleDelta } from './random.js';

function heroMesh() {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: 0xff7f2a });   // Reno's sunset-orange shirt
  const skin = new THREE.MeshLambertMaterial({ color: 0xc68863 });
  const pants = new THREE.MeshLambertMaterial({ color: 0xf0ead6 });  // cream chinos
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.74, 0.3), shirt);
  torso.position.y = 1.12; torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 8, 7), skin);
  head.position.y = 1.68;
  const shades = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.05), new THREE.MeshLambertMaterial({ color: 0x11131a }));
  shades.position.set(0, 1.7, 0.19);
  const legGeo = new THREE.BoxGeometry(0.18, 0.78, 0.2); legGeo.translate(0, -0.39, 0);
  const legL = new THREE.Mesh(legGeo, pants); legL.position.set(-0.14, 0.78, 0);
  const legR = new THREE.Mesh(legGeo, pants); legR.position.set(0.14, 0.78, 0);
  const armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.16); armGeo.translate(0, -0.28, 0);
  const armL = new THREE.Mesh(armGeo, shirt); armL.position.set(-0.35, 1.42, 0);
  const armR = new THREE.Mesh(armGeo, shirt); armR.position.set(0.35, 1.42, 0);
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.34), new THREE.MeshLambertMaterial({ color: 0x23252c }));
  gunBody.position.set(0, -0.6, 0.14);
  gun.add(gunBody);
  gun.visible = false;
  armR.add(gun);
  group.add(torso, head, shades, legL, legR, armL, armR);
  return { group, legL, legR, armL, armR, gun };
}

export class Player {
  constructor(scene, x, z) {
    const parts = heroMesh();
    this.group = parts.group;
    this.legL = parts.legL; this.legR = parts.legR;
    this.armL = parts.armL; this.armR = parts.armR;
    this.gunMesh = parts.gun;
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    this.heading = Math.PI; // facing the club, south... (heading 0 faces +Z)
    this.mode = 'foot';     // 'foot' | 'car'
    this.car = null;
    this.vy = 0;
    this.grounded = true;
    this.phase = 0;
    this.speedNow = 0;
    this.armed = false;
  }
  get pos() { return this.group.position; }
  get driving() { return this.mode === 'car'; }

  setArmed(on) { this.armed = on; this.gunMesh.visible = on && this.mode === 'foot'; }

  enterCar(car) {
    this.mode = 'car';
    this.car = car;
    car.occupied = true;
    this.group.visible = false;
    this.gunMesh.visible = false;
  }

  exitCar(world) {
    const car = this.car;
    this.mode = 'foot';
    this.car = null;
    if (car) {
      car.occupied = false;
      // Step out on the car's left side.
      const sideX = Math.cos(car.heading), sideZ = -Math.sin(car.heading);
      this.pos.set(car.pos.x + sideX * 1.9, 0, car.pos.z + sideZ * 1.9);
      world.resolveCircle(this.pos, TUNING.playerRadius);
      this.pos.y = world.groundHeight(this.pos.x, this.pos.z);
      this.heading = car.heading;
    }
    this.group.visible = true;
    this.gunMesh.visible = this.armed;
  }

  update(dt, ctx) {
    if (this.driving) { this.#updateDriving(dt, ctx); return; }
    this.#updateOnFoot(dt, ctx);
  }

  #updateOnFoot(dt, ctx) {
    const { input, world, cameraYaw } = ctx;
    let mx = 0, mz = 0;
    const f = { x: Math.sin(cameraYaw), z: Math.cos(cameraYaw) };
    const r = { x: Math.cos(cameraYaw), z: -Math.sin(cameraYaw) };
    if (input.down('KeyW')) { mx += f.x; mz += f.z; }
    if (input.down('KeyS')) { mx -= f.x; mz -= f.z; }
    if (input.down('KeyD')) { mx += r.x; mz += r.z; }
    if (input.down('KeyA')) { mx -= r.x; mz -= r.z; }
    const moving = (mx !== 0 || mz !== 0);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = sprint ? TUNING.playerSprintSpeed : TUNING.playerWalkSpeed;
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const desired = Math.atan2(mx, mz);
      this.heading += clamp(angleDelta(this.heading, desired), -11 * dt, 11 * dt);
      this.pos.x += Math.sin(this.heading) * speed * dt * Math.max(0.25, Math.cos(angleDelta(this.heading, desired)));
      this.pos.z += Math.cos(this.heading) * speed * dt * Math.max(0.25, Math.cos(angleDelta(this.heading, desired)));
      this.speedNow = speed;
    } else this.speedNow = 0;
    // Aiming with the mouse turns the body to the camera.
    if (ctx.aiming) this.heading += clamp(angleDelta(this.heading, cameraYaw), -14 * dt, 14 * dt);
    // Jump and gravity over the ground height (the pier deck counts).
    const ground = world.groundHeight(this.pos.x, this.pos.z);
    if (input.justPressed('Space') && this.grounded) { this.vy = 5.4; this.grounded = false; }
    if (!this.grounded) {
      this.vy -= 15 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) { this.pos.y = ground; this.vy = 0; this.grounded = true; }
    } else this.pos.y = ground;
    world.resolveCircle(this.pos, TUNING.playerRadius);
    this.pos.z = clamp(this.pos.z, -WORLD_EDGE, 258);
    this.pos.x = clamp(this.pos.x, -WORLD_EDGE, WORLD_EDGE);
    // Limb animation.
    this.phase += dt * (3 + this.speedNow * 1.9);
    const swing = Math.sin(this.phase) * clamp(this.speedNow * 0.09, 0, 0.6);
    this.legL.rotation.x = swing; this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.85;
    this.armR.rotation.x = this.armed ? -1.25 : swing * 0.85; // armed: pistol raised ahead
    this.group.rotation.y = this.heading;
  }

  #updateDriving(dt, ctx) {
    const { input, world } = ctx;
    const car = this.car;
    let throttle = 0, steer = 0;
    if (input.down('KeyW')) throttle += 1;
    if (input.down('KeyS')) throttle -= 1;
    if (input.down('KeyA')) steer += 1;
    if (input.down('KeyD')) steer -= 1;
    car.boosting = input.down('ShiftLeft') || input.down('ShiftRight');
    const before = { x: car.pos.x, z: car.pos.z, speed: car.speed };
    car.drive(dt, throttle, steer, input.down('Space'));
    world.resolveCircle(car.pos, 1.7);
    car.pos.x = clamp(car.pos.x, -WORLD_EDGE, WORLD_EDGE);
    car.pos.z = clamp(car.pos.z, -WORLD_EDGE, 236);
    // A hard stop against a building is a crash: it costs speed and makes noise via callback.
    const stopped = Math.abs(before.speed) > 7 && Math.abs(car.speed) < Math.abs(before.speed) * 0.45;
    const moved = Math.hypot(car.pos.x - before.x, car.pos.z - before.z);
    if ((stopped || (Math.abs(before.speed) > 9 && moved < Math.abs(before.speed) * dt * 0.3))) {
      car.speed *= 0.35;
      ctx.onCrash?.(Math.abs(before.speed));
    }
    this.pos.copy(car.pos);
    this.heading = car.heading;
  }
}

// A smoothed third-person camera: mouse orbit, wheel-free fixed distances (C cycles them),
// and a pull-in when a building stands between the camera and the player.
export class ThirdPersonCamera {
  constructor() {
    this.yaw = Math.PI;
    this.pitch = 0.32;
    this.distances = [7.5, 11, 16];
    this.distIndex = 1;
    this.smoothed = new THREE.Vector3(0, 6, -12);
  }

  cycleDistance() { this.distIndex = (this.distIndex + 1) % this.distances.length; }

  update(dt, input, camera, target, driving, world) {
    const sens = driving ? 0.0026 : 0.0032;
    this.yaw -= input.mouseDX * sens;
    this.pitch = clamp(this.pitch + input.mouseDY * sens, -0.12, 1.15);
    const dist = this.distances[this.distIndex] * (driving ? 1.25 : 1);
    const cx = target.x - Math.sin(this.yaw) * Math.cos(this.pitch) * dist;
    const cz = target.z - Math.cos(this.yaw) * Math.cos(this.pitch) * dist;
    let cy = target.y + 1.6 + Math.sin(this.pitch) * dist;
    // Pull the camera in front of any building that blocks the view.
    let useDist = dist;
    for (let step = 0.9; step >= 0.25; step -= 0.13) {
      const sx = target.x - Math.sin(this.yaw) * Math.cos(this.pitch) * dist * step;
      const sz = target.z - Math.cos(this.yaw) * Math.cos(this.pitch) * dist * step;
      const sy = target.y + 1.6 + Math.sin(this.pitch) * dist * step;
      let inside = false;
      for (const c of world.colliders) {
        if (sx > c.minX - 0.3 && sx < c.maxX + 0.3 && sz > c.minZ - 0.3 && sz < c.maxZ + 0.3 && sy < c.h + 0.3) { inside = true; break; }
      }
      if (!inside) { useDist = dist * step; break; }
      useDist = dist * 0.22;
    }
    const want = new THREE.Vector3(
      target.x - Math.sin(this.yaw) * Math.cos(this.pitch) * useDist,
      Math.max(0.7, target.y + 1.6 + Math.sin(this.pitch) * useDist),
      target.z - Math.cos(this.yaw) * Math.cos(this.pitch) * useDist);
    const blend = 1 - Math.pow(0.0001, dt); // fast but smooth
    this.smoothed.lerp(want, clamp(blend, 0, 1));
    camera.position.copy(this.smoothed);
    camera.lookAt(target.x, target.y + 1.7, target.z);
    return this.yaw;
  }
}
