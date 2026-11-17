// main.js — SOLBAY HEAT's conductor: builds the renderer, the city, the player, traffic,
// pedestrians, police, combat and missions; owns the game state (money, health, the clock,
// the save), the dialogue queue, crime reporting, collisions between cars, the busted/wasted
// endings, the menus, and the staged scenes the screenshots are taken from (?shot=...).

import * as THREE from 'three';
import { CITY, TUNING } from './config.js';
import { makeRng, clamp } from './random.js';
import { Input } from './input.js';
import { SoundBank } from './audio.js';
import { World, LOCATIONS } from './world.js';
import { TrafficSystem, spawnParkedCars, Car } from './vehicles.js';
import { PedestrianSystem } from './pedestrians.js';
import { Player, ThirdPersonCamera } from './player.js';
import { WantedSystem, PoliceSystem } from './police.js';
import { Effects, Combat } from './combat.js';
import { MissionManager } from './missions.js';
import { Hud } from './hud.js';
import { loadSave, writeSave, clearSave } from './save.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 20261117);

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 900);
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this.rng = makeRng(seed);
    this.input = new Input(this.canvas);
    this.sound = new SoundBank();
    this.world = new World(this.scene, this.rng);
    this.player = new Player(this.scene, LOCATIONS.spawn.x, LOCATIONS.spawn.z);
    this.cameraRig = new ThirdPersonCamera();
    this.cameraRig.yaw = 2.6;
    this.traffic = new TrafficSystem(this.scene, this.world, this.rng, 20);
    this.parked = spawnParkedCars(this.scene, this.world, this.rng);
    this.cars = [...this.traffic.cars, ...this.parked];
    this.peds = new PedestrianSystem(this.scene, this.world, this.rng, 40);
    this.wanted = new WantedSystem();
    this.police = new PoliceSystem(this.scene, this.world, this.rng);
    this.effects = new Effects(this.scene);
    this.combat = new Combat(this.effects);
    this.hud = new Hud();
    this.missions = new MissionManager(this.scene);

    this.mode = 'menu'; // menu | playing | paused | ended
    this.money = 120;
    this.health = 100;
    this.busted = 0;
    this.hasGun = false;
    this.clockMin = 10 * 60;
    this.day = 1;
    this.timeSec = 0;
    this.damageFlash = 0;
    this.state = { sideJobsDone: 0, totalEarned: 0 };
    this.dialogueQueue = null;
    this.dialogueCb = null;
    this.endKind = null;
    this.crashSoundTimer = 0;
    this.crimeTimer = 0;
    this.shotName = params.get('shot');
    this.shotCamera = null;

    this.#wireMenus();
    window.__game = this; // a handle for the maker's own debugging and screenshot staging
    if (this.shotName) this.#stageShot(this.shotName);
    this.last = performance.now();
    requestAnimationFrame((t) => this.#frame(t));
  }

  // -- the interface missions.js talks to --------------------------------
  get dialogueOpen() { return !!this.dialogueQueue; }
  toast(text) { this.hud.toast(text); }
  grantGun() {
    if (this.hasGun) return;
    this.hasGun = true;
    this.player.setArmed(true);
    this.toast('PISTOL acquired — click to shoot, R to reload');
  }
  addMoney(n, earned) {
    this.money += n;
    if (earned) this.state.totalEarned += n;
  }
  registerCar(car) { this.cars.push(car); }
  unregisterCar(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
  }
  dialogue(lines, cb) {
    this.dialogueQueue = [...lines];
    this.dialogueCb = cb || null;
    this.#showDialogueLine();
  }
  autosave() {
    writeSave({
      money: this.money, missionIndex: this.missions.missionIndex,
      storyDone: this.missions.storyDone, hasGun: this.hasGun,
      totalEarned: this.state.totalEarned, sideJobsDone: this.state.sideJobsDone,
      x: this.player.pos.x, z: this.player.pos.z,
    });
  }

  #showDialogueLine() {
    const line = this.dialogueQueue?.[0];
    if (!line) { this.hud.hideDialogue(); this.dialogueQueue = null; const cb = this.dialogueCb; this.dialogueCb = null; cb?.(); return; }
    this.hud.showDialogue(line[0], line[1]);
  }
  #advanceDialogue() {
    this.dialogueQueue?.shift();
    this.#showDialogueLine();
  }

  // -- menus ---------------------------------------------------------------
  #wireMenus() {
    const save = loadSave();
    if (save) document.getElementById('btnContinue').classList.remove('hidden');
    document.getElementById('btnNew').onclick = () => { this.sound.ensure(); clearSave(); this.startGame(null); };
    document.getElementById('btnContinue').onclick = () => { this.sound.ensure(); this.startGame(loadSave()); };
    document.getElementById('btnHow').onclick = () => document.getElementById('howPanel').classList.toggle('hidden');
    document.getElementById('btnResume').onclick = () => this.setPaused(false);
    document.getElementById('btnSave').onclick = () => { this.autosave(); this.hud.toast('Game saved'); };
    document.getElementById('btnRestart').onclick = () => { clearSave(); location.reload(); };
    document.getElementById('btnQuitToMenu').onclick = () => location.reload();
    document.getElementById('btnRespawn').onclick = () => this.respawn();
    this.canvas.addEventListener('mousedown', () => {
      if (this.mode === 'playing') { this.sound.ensure(); this.input.lockPointer(); }
    });
  }

  startGame(save) {
    document.getElementById('menu').classList.add('hidden');
    this.hud.show();
    this.mode = 'playing';
    if (save) {
      this.money = save.money;
      this.missions.missionIndex = save.missionIndex || 0;
      this.missions.storyDone = !!save.storyDone;
      this.state.totalEarned = save.totalEarned || 0;
      this.state.sideJobsDone = save.sideJobsDone || 0;
      if (save.hasGun) { this.hasGun = true; this.player.setArmed(true); }
      if (typeof save.x === 'number') this.player.pos.set(save.x, 0, save.z);
      this.toast('Welcome back to Solbay');
    } else {
      this.toast('Find Marisol at the gold marker');
    }
  }

  setPaused(on) {
    if (this.mode !== 'playing' && this.mode !== 'paused') return;
    this.mode = on ? 'paused' : 'playing';
    document.getElementById('pauseMenu').classList.toggle('hidden', !on);
    if (on) document.exitPointerLock?.();
  }

  endGame(kind) {
    this.mode = 'ended';
    this.endKind = kind;
    document.exitPointerLock?.();
    const title = document.getElementById('endTitle');
    const text = document.getElementById('endText');
    if (kind === 'wasted') {
      title.textContent = 'TAKEN DOWN';
      title.classList.remove('busted');
      const loss = Math.floor(this.money * 0.1);
      this.money -= loss;
      text.textContent = `Solbay General patched you up. Hospital bill: $${loss}. The city kept spinning without you.`;
    } else {
      title.textContent = 'BUSTED';
      title.classList.add('busted');
      const fine = 150 + this.wanted.stars * 100;
      this.money = Math.max(0, this.money - fine);
      text.textContent = `The Solbay PD walked you in. Fine paid: $${fine}. Your record just got longer.`;
    }
    this.missions.onPlayerDown(this);
    document.getElementById('endScreen').classList.remove('hidden');
    this.sound.missionFail();
  }

  respawn() {
    document.getElementById('endScreen').classList.add('hidden');
    this.mode = 'playing';
    this.health = 100;
    this.busted = 0;
    this.wanted.clear();
    this.police.clearAll();
    if (this.player.driving) this.player.exitCar(this.world);
    const spot = this.endKind === 'wasted' ? LOCATIONS.hospital : { x: 8, z: 8 };
    this.player.pos.set(spot.x, 0, spot.z);
    this.cameraRig.smoothed.set(spot.x - 8, 5, spot.z - 8);
    this.autosave();
  }

  damagePlayer(amount) {
    if (this.mode !== 'playing') return;
    this.health -= amount;
    this.damageFlash = 1;
    if (this.health <= 0) { this.health = 0; this.endGame('wasted'); }
  }

  // Witnessed crime: the heat only really bites when someone is around to see it.
  reportCrime(amount, x, z) {
    let witnessed = this.police.anySeesPlayer(this.player.pos);
    if (!witnessed) {
      for (const ped of this.peds.peds) {
        if (!ped.down && Math.hypot(ped.pos.x - x, ped.pos.z - z) < 26) { witnessed = true; break; }
      }
    }
    this.wanted.reportCrime(witnessed ? amount : amount * 0.35);
  }

  // -- interactions ---------------------------------------------------------
  #nearestCar(maxDist) {
    let best = null, bestD = maxDist;
    for (const car of this.cars) {
      if (car.dead || car.occupied) continue;
      const d = Math.hypot(car.pos.x - this.player.pos.x, car.pos.z - this.player.pos.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  #enterCar(car) {
    const wasTraffic = car.driver === 'traffic';
    if (wasTraffic) {
      // The driver bails out and runs.
      const driver = this.peds.spawnAt(car.pos.x + 1.5, car.pos.z, false);
      driver.flee(car.pos.x, car.pos.z, 6);
      car.driver = null;
    }
    if (!car.stolen) {
      car.stolen = true;
      this.reportCrime(wasTraffic ? 0.85 : 0.5, car.pos.x, car.pos.z);
      if (this.wanted.active) this.toast('Car taken — the law noticed');
    }
    this.player.enterCar(car);
    this.sound.doorSlam();
  }

  #updateInteractions() {
    const input = this.input;
    if (this.dialogueOpen) {
      if (input.justPressed('KeyE') || input.clicked) this.#advanceDialogue();
      this.hud.setPrompt(null);
      return;
    }
    let prompt = null;
    if (this.player.driving) {
      prompt = '<b>E</b> Get out';
      if (input.justPressed('KeyE')) {
        const car = this.player.car;
        this.player.exitCar(this.world);
        if (car) car.coast(0.016);
        this.sound.doorSlam();
      }
    } else {
      const car = this.#nearestCar(3.4);
      const idle = !this.missions.busy && !this.missions.storyDone ? this.missions.objective().marker : null;
      const atStory = idle && Math.hypot(this.player.pos.x - idle.x, this.player.pos.z - idle.z) < 3.4;
      const jobPoint = !this.missions.sideJob ? this.missions.nearJobPoint(this.player.pos) : null;
      if (atStory) prompt = '<b>E</b> Start the story mission';
      else if (jobPoint) prompt = '<b>E</b> Take a side job (fare / parcel)';
      else if (car) prompt = car.driver === 'traffic' ? '<b>E</b> Steal the car' : '<b>E</b> Get in the car';
      if (input.justPressed('KeyE')) {
        if (atStory) this.missions.startStoryMission(this);
        else if (jobPoint) this.missions.startSideJob(this);
        else if (car) this.#enterCar(car);
      }
    }
    this.hud.setPrompt(prompt);
  }

  // -- combat ---------------------------------------------------------------
  #updateCombat(dt) {
    const combat = this.combat;
    combat.cooldown -= dt;
    if (combat.reloading > 0) {
      combat.reloading -= dt;
      if (combat.reloading <= 0) { combat.ammo = TUNING.magazine; this.sound.reload(); }
    }
    if (!this.hasGun || this.player.driving || this.dialogueOpen) return;
    if (this.input.justPressed('KeyR') && combat.ammo < TUNING.magazine && combat.reloading <= 0) {
      combat.reloading = 1.1; this.sound.reload();
    }
    if (this.input.mouseDown && combat.cooldown <= 0 && combat.reloading <= 0) {
      if (combat.ammo <= 0) { this.sound.dryFire(); combat.reloading = 1.1; combat.cooldown = 0.3; return; }
      combat.ammo--;
      combat.cooldown = TUNING.pistolCooldown;
      this.sound.gunshot();
      const origin = new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.5, this.player.pos.z);
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const hit = combat.shoot(origin, dir, this.peds.peds, this.cars);
      this.reportCrime(0.45, this.player.pos.x, this.player.pos.z);
      this.peds.fleeArea(this.player.pos.x, this.player.pos.z, 16);
      if (hit.kind === 'ped') {
        const ped = hit.target;
        const dmg = hit.headshot ? 100 : TUNING.pistolDamage;
        ped.health -= dmg;
        this.sound.hitMarker();
        if (ped.health <= 0) {
          ped.knockDown();
          this.reportCrime(ped.hostile ? 0.3 : 1.5, ped.pos.x, ped.pos.z);
        } else if (!ped.hostile) ped.flee(this.player.pos.x, this.player.pos.z, 6);
      } else if (hit.kind === 'car') {
        const car = hit.target;
        car.health -= 14;
        if (car.kind === 'police') this.reportCrime(0.7, car.pos.x, car.pos.z);
        if (car.health <= 0 && !car.dead) {
          car.dead = true;
          car.speed = 0;
          this.effects.burst(car.pos.x, 1.2, car.pos.z, 0x555c66, 22, 3, 0.9, 2.5);
          if (car.kind === 'police') this.wanted.reportCrime(0.8);
        }
      }
    }
    if (this.input.justPressed('KeyF')) {
      const ped = combat.punch(this.player.pos, this.player.heading, this.peds.peds);
      if (ped) {
        this.sound.punch();
        ped.health -= 45;
        this.reportCrime(0.5, ped.pos.x, ped.pos.z);
        if (ped.health <= 0) { ped.knockDown(); this.reportCrime(0.9, ped.pos.x, ped.pos.z); }
        else ped.flee(this.player.pos.x, this.player.pos.z, 5);
      }
    }
  }

  onPoliceShot(car, dist) {
    const chance = clamp(0.62 - dist * 0.012, 0.15, 0.6);
    const from = new THREE.Vector3(car.pos.x, 1.3, car.pos.z);
    const to = new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z);
    this.effects.tracer(from, to);
    this.sound.gunshot();
    if (this.rng() < chance) this.damagePlayer(5 + this.rng() * 6);
  }

  onHostileShot(ped, dist) {
    const from = new THREE.Vector3(ped.pos.x, ped.pos.y + 1.45, ped.pos.z);
    const to = new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.1, this.player.pos.z);
    this.effects.tracer(from, to);
    if (dist < 46) this.sound.gunshot();
    const chance = clamp(0.5 - dist * 0.01, 0.12, 0.45);
    if (this.rng() < chance) this.damagePlayer(4 + this.rng() * 5);
  }

  // -- collisions between cars, and cars vs pedestrians ----------------------
  #updateCollisions(dt) {
    this.crimeTimer -= dt;
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (a.dead) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.dead) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 3.6 || d === 0) continue;
        const nx = dx / d, nz = dz / d, push = (3.6 - d) / 2;
        if (!a.occupied) { a.pos.x -= nx * push; a.pos.z -= nz * push; }
        if (!b.occupied) { b.pos.x += nx * push; b.pos.z += nz * push; }
        const relSpeed = Math.abs(a.speed - b.speed) + Math.abs(a.speed) * 0.3;
        if (relSpeed > 4) {
          const dmg = relSpeed * 1.6;
          a.health -= dmg * 0.6; b.health -= dmg * 0.6;
          if (this.crashSoundTimer <= 0) { this.sound.carCrash(relSpeed * 0.05); this.crashSoundTimer = 0.25; }
          if ((a.occupied || b.occupied)) {
            const other = a.occupied ? b : a;
            if (other.kind === 'police' && this.crimeTimer <= 0) { this.wanted.reportCrime(0.7); this.crimeTimer = 2; }
            if (this.player.driving && relSpeed > 11) this.damagePlayer(2.5);
          }
          a.speed *= 0.55; b.speed *= 0.55;
          if (a.health <= 0) { a.dead = true; a.speed = 0; }
          if (b.health <= 0) { b.dead = true; b.speed = 0; }
        }
      }
      // The player's car against pedestrians: a crime and a tragedy, every time.
      if (a.occupied && Math.abs(a.speed) > 3) {
        for (const ped of this.peds.peds) {
          if (ped.down) continue;
          if (Math.hypot(ped.pos.x - a.pos.x, ped.pos.z - a.pos.z) < 1.9) {
            ped.knockDown();
            a.speed *= 0.72;
            this.sound.punch();
            this.reportCrime(Math.abs(a.speed) > 9 ? 1.7 : 1.1, ped.pos.x, ped.pos.z);
          }
        }
      }
    }
    this.crashSoundTimer -= dt;
    // Smoke from wrecks.
    for (const car of cars) {
      if (!car.dead) continue;
      car.userData.smokeTimer = (car.userData.smokeTimer ?? Math.random() * 0.4) - dt;
      if (car.userData.smokeTimer <= 0) {
        car.userData.smokeTimer = 0.4;
        this.effects.burst(car.pos.x, 1.4, car.pos.z, 0x3c4148, 3, 0.8, 1.1, 1.8);
      }
    }
  }

  // -- the frame --------------------------------------------------------------
  #frame(now) {
    requestAnimationFrame((t) => this.#frame(t));
    let dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
    this.last = now;
    if (this.shotName) dt *= 0.35; // staged scenes run in slow motion so the marks hold
    if (this.mode === 'paused') { this.renderer.render(this.scene, this.camera); return; }
    this.timeSec += dt;
    const playing = this.mode === 'playing';
    const inMenu = this.mode === 'menu';

    if (playing && (this.input.justPressed('KeyP') || this.input.justPressed('Escape'))) {
      this.setPaused(true);
      this.input.endFrame();
      return;
    }
    if (playing && this.input.justPressed('KeyM')) {
      this.toast(this.sound.toggleMute() ? 'Sound off' : 'Sound on');
    }
    if (playing && this.input.justPressed('KeyC')) this.cameraRig.cycleDistance();

    const playerPos = this.player.pos;
    // The living city runs behind the menu too; the law only works when playing.
    this.traffic.update(dt, playerPos, this.cars, () => this.sound.carHorn());
    this.peds.update(dt, {
      playerPos, rng: this.rng,
      groundHeight: (x, z) => this.world.groundHeight(x, z),
      onHostileShot: (ped, d) => this.onHostileShot(ped, d),
    });
    if (playing) {
      if (this.dialogueOpen && this.player.driving) {
        this.player.car.coast(dt);
        this.player.pos.copy(this.player.car.pos);
      } else {
        this.player.update(dt, {
          input: this.input, world: this.world, cameraYaw: this.cameraRig.yaw,
          aiming: this.hasGun && this.input.mouseDown,
          onCrash: (speed) => {
            this.sound.carCrash(speed * 0.05);
            if (this.player.car) this.player.car.health -= speed * 1.1;
            if (speed > 12) this.damagePlayer(3);
          },
        });
      }
      if (this.shotCruise && this.player.driving) this.player.car.drive(dt, 0.8, 0, false);
      if (this.shotName) this.damageFlash = 0;
      this.#updateInteractions();
      this.#updateCombat(dt);
      this.missions.update(dt, this);
      this.police.update(dt, {
        wanted: this.wanted, playerPos, playerCar: this.player.driving ? this.player.car : null,
        timeSec: this.timeSec, onPoliceShot: (car, d) => this.onPoliceShot(car, d),
      });
      this.#updateCollisions(dt);
      // Wanted bookkeeping and the busted meter.
      const seen = this.police.anySeesPlayer(playerPos);
      this.wanted.update(dt, seen);
      if (!this.player.driving && this.wanted.active && this.police.nearestDistance(playerPos) < TUNING.bustedRange && this.player.speedNow < 2.2) {
        this.busted += TUNING.bustedFillPerSec * dt * this.wanted.stars;
        if (this.busted >= 1) { this.endGame('busted'); }
      } else this.busted = Math.max(0, this.busted - dt * 0.35);
      if (this.health < 100) this.health = Math.min(100, this.health + dt * (this.damageFlash <= 0 ? 2.2 : 0));
      // The clock: a Solbay day lasts about sixteen real minutes.
      this.clockMin += dt * 1.5;
      if (this.clockMin >= 1440) { this.clockMin -= 1440; this.day++; }
      // Sound follow-ups.
      const speedRatio = this.player.driving ? Math.abs(this.player.car.speed) / 30 : 0;
      this.sound.setEngine(speedRatio, this.player.driving);
      const copDist = this.police.nearestDistance(playerPos);
      this.sound.setSiren(copDist === Infinity ? 0 : clamp(1 - copDist / 70, 0, 1), this.timeSec);
      this.sound.updateMusic(dt, true);
    }
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    this.effects.update(dt);
    this.world.update(dt, playerPos);

    // Camera: menu gets a slow aerial orbit; play gets the third-person rig; shots are staged.
    if (this.shotCamera) {
      this.camera.position.copy(this.shotCamera.pos);
      this.camera.lookAt(this.shotCamera.look);
    } else if (inMenu) {
      const a = this.timeSec * 0.05;
      this.camera.position.set(Math.cos(a) * 120, 42, Math.sin(a) * 120);
      this.camera.lookAt(0, 6, 0);
    } else {
      this.cameraRig.update(dt, this.input, this.camera, this.player.pos, this.player.driving, this.world);
    }

    if (playing) {
      const obj = this.missions.objective();
      this.hud.setObjective(obj.title, obj.text, obj.sub);
      const blips = [];
      if (obj.marker) blips.push({ x: obj.marker.x, z: obj.marker.z, color: obj.marker.color === 'target' ? '#ff4757' : obj.marker.color === 'job' ? '#2ee66b' : obj.marker.color === 'pickup' ? '#6ee7ff' : '#ffb340', shape: 'diamond' });
      if (this.missions.sideJob && this.missions.current) blips.push({ x: this.missions.sideJob.target.x, z: this.missions.sideJob.target.z, color: '#2ee66b', shape: 'diamond' });
      if (this.missions.current) for (const h of this.missions.current.hostiles) if (!h.down) blips.push({ x: h.pos.x, z: h.pos.z, color: '#ff4757', shape: 'dot' });
      this.hud.update(dt, {
        stars: this.wanted.stars, money: this.money, clockMin: this.clockMin, day: this.day,
        health: this.health, busted: this.busted,
        weaponText: !this.hasGun ? 'FISTS · <b>—</b>' : this.combat.reloading > 0 ? 'PISTOL · <b>RELOADING</b>' : `PISTOL · <b>${this.combat.ammo} / ∞</b>`,
        showCrosshair: this.hasGun && !this.player.driving,
        speedKmh: this.player.driving ? this.player.car.speed * 3.6 : null,
        damageFlash: this.damageFlash * 0.85,
      });
      this.hud.drawMinimap({
        player: playerPos, heading: Math.PI - this.player.heading,
        blocks: this.world.blockRects, blips,
        police: this.police.cars.filter((c) => !c.dead).map((c) => c.pos),
      });
    }
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    if (this.shotName && !this.shotDone) {
      this.shotFrames = (this.shotFrames || 0) + 1;
      if (this.shotFrames > 12) { this.shotDone = true; window.__shotReady = true; }
    }
  }

  // -- staged scenes for the maker's screenshots ------------------------------
  #stageShot(name) {
    this.mode = 'playing';
    document.getElementById('menu').classList.add('hidden');
    this.hud.show();
    this.money = 1450;
    const P = this.player;
    if (name === 'cover' || name === 'chase') {
      const car = new Car(this.scene, 'sports', 0xc0392b, 6, 96, 0.2);
      this.registerCar(car);
      P.enterCar(car);
      car.speed = 16;
      this.hasGun = true; P.setArmed(true);
      this.wanted.heat = name === 'cover' ? 3.4 : 4.5;
      const cop1 = new Car(this.scene, 'police', 0xf4f6f8, 2, 80, 0.1);
      const cop2 = new Car(this.scene, 'police', 0xf4f6f8, 11, 86, -0.15);
      cop1.driver = cop2.driver = 'police';
      cop1.userData.routeTimer = 0; cop2.userData.routeTimer = 0;
      this.police.cars.push(cop1, cop2);
      this.registerCar(cop1); this.registerCar(cop2);
      this.missions.missionIndex = 4;
      this.missions.startStoryMission(this); // HUD shows the real SOLBAY GOODBYE opening step
      this.hud.bannerTimer = 0;
      this.hud.banner.classList.add('hidden');
      this.shotCruise = true;
      this.shotCamera = { pos: new THREE.Vector3(17, 4.5, 126), look: new THREE.Vector3(3, 1.0, 99) };
      if (name === 'chase') this.shotCamera = { pos: new THREE.Vector3(-13, 3.2, 118), look: new THREE.Vector3(6, 1.2, 98) };
    } else if (name === 'foot') {
      P.pos.set(-31, 0, 3);
      P.heading = 2.5;
      this.missions.startStoryMission(this);
      this.hud.bannerTimer = 0;
      this.hud.banner.classList.add('hidden');
      this.shotCamera = { pos: new THREE.Vector3(-37, 2.6, 10), look: new THREE.Vector3(-22, 1.4, -4) };
    } else if (name === 'drive') {
      const car = new Car(this.scene, 'coupe', 0xf39c12, -70, 187.4, Math.PI / 2);
      this.registerCar(car);
      P.enterCar(car);
      car.speed = 19;
      this.missions.missionIndex = 1;
      this.shotCruise = true;
      this.shotCamera = { pos: new THREE.Vector3(-50, 3.2, 210), look: new THREE.Vector3(-68, 1.2, 186) };
    }
  }
}

new Game();
