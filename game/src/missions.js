// missions.js — the story and the hustle of Solbay: a five-mission campaign for Reno Vale
// (an errand for Club Azahar's Marisol Cruz, a borrowed gold coupe, a Corsair ambush in the
// alley, a hot cargo run for Piper Lang, and a four-star escape to the airfield), plus endless
// generated side jobs (fares and parcel runs). A MissionManager walks a list of steps — go
// somewhere, take a car, clear a fight, deliver under fire — drives the glowing checkpoint
// markers, and pays out through the game object it is handed each frame.

import * as THREE from 'three';
import { NAMES } from './config.js';
import { LOCATIONS } from './world.js';
import { Car } from './vehicles.js';
import { randRange, pick } from './random.js';

const MARKER_COLORS = { story: 0xffb340, target: 0xff4757, job: 0x2ee66b, pickup: 0x6ee7ff };

export function makeMarker(colorHex) {
  const group = new THREE.Group();
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.7, 16, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
  cyl.position.y = 8;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.15, 1.7, 24),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12;
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.3, 4),
    new THREE.MeshBasicMaterial({ color: colorHex }));
  tip.rotation.x = Math.PI; tip.position.y = 3.4;
  group.add(cyl, ring, tip);
  group.visible = false;
  return group;
}

const L = LOCATIONS;

export const STORY = [
  {
    id: 'first-wheels', title: 'FIRST WHEELS', reward: 250,
    steps: [
      { type: 'goto', at: L.clubDoor, r: 3.5, text: `Meet ${NAMES.fixer} outside ${NAMES.club}`, dialogue: [
        [NAMES.fixer, 'Reno Vale. Piper says you can drive and keep your mouth shut. Both get tested tonight.'],
        [NAMES.hero, 'Piper exaggerates. Mostly the second part.'],
        [NAMES.fixer, 'My coupe is parked around the corner. Take it to Pier 9 and wait for my call. And Reno — bring it back without a scratch.'],
      ] },
      { type: 'takecar', spawn: { kind: 'coupe', color: 0xff5ea8, x: -6, z: 6, heading: 1.6 }, text: "Get into Marisol's coupe" },
      { type: 'goto', at: L.pier, r: 6, inCar: true, text: 'Drive to Pier 9, at the end of the boardwalk', dialogue: [
        [NAMES.mechanic, 'Piper here, on Marisol\'s phone. She likes the way you drive, which scares me a little. Come by my garage tomorrow — I have paying work.'],
        [NAMES.hero, 'Tell her the coupe is in one piece. See you there.'],
      ] },
    ],
  },
  {
    id: 'borrowed-shine', title: 'BORROWED SHINE', reward: 600,
    steps: [
      { type: 'goto', at: L.garageDoor, r: 3.5, text: `See ${NAMES.mechanic} at ${NAMES.garage}`, dialogue: [
        [NAMES.mechanic, 'A collector owes Marisol money. His gold coupe sits in the marina lot, and he parks it like he wants it stolen.'],
        [NAMES.mechanic, 'So steal it. Bring it to my garage. If the law notices, lose them first — I don\'t need sirens at my door.'],
      ] },
      { type: 'stealcar', spawn: { kind: 'sports', color: 0xd4af37, x: L.goldCar.x, z: L.goldCar.z, heading: 2.4 }, at: L.marinaLot, text: 'Steal the gold coupe from the marina lot' },
      { type: 'delivercar', at: { x: 115, z: 44 }, r: 5.5, text: `Deliver the coupe to ${NAMES.garage}`, noWanted: true, dialogue: [
        [NAMES.mechanic, 'Look at that shine. The collector is going to cry into his marina slip. Marisol wired your cut — spend it slow.'],
      ] },
    ],
  },
  {
    id: 'corsair-static', title: 'CORSAIR STATIC', reward: 800, grantGun: true,
    steps: [
      { type: 'goto', at: L.clubDoor, r: 3.5, text: `Marisol has a problem. See her at ${NAMES.club}`, dialogue: [
        [NAMES.fixer, `${NAMES.rival} have been leaning on my door staff. Four of them drink in the alley behind Harbor Street, like they own it.`],
        [NAMES.fixer, 'Take this pistol. Teach them the alley is mine. Then come back and tell me it\'s done.'],
        [NAMES.hero, 'Four against one. They should have brought more.'],
      ] },
      { type: 'eliminate', at: L.alley, count: 4, text: `Clear the Corsairs out of the back alley` },
      { type: 'goto', at: L.clubDoor, r: 3.5, text: `Report back to ${NAMES.fixer}`, dialogue: [
        [NAMES.fixer, 'The alley is quiet and my door staff can breathe again. You are becoming useful, Reno. Dangerous, but useful.'],
      ] },
    ],
  },
  {
    id: 'hot-cargo', title: 'HOT CARGO', reward: 1000,
    steps: [
      { type: 'goto', at: L.garageDoor, r: 3.5, text: `Piper needs a driver. See her at the garage`, dialogue: [
        [NAMES.mechanic, 'My van is loaded with... let\'s say "party supplies" for the harbour warehouse. The Corsairs would love to stop it.'],
        [NAMES.mechanic, 'Get it there in one piece. If the van dies, the deal dies, and Marisol hears about it. No pressure.'],
      ] },
      { type: 'takecar', spawn: { kind: 'van', color: 0x95a5a6, x: 115, z: 48, heading: 3.1 }, text: "Get into Piper's van" },
      { type: 'goto', at: L.warehouse, r: 7, inCar: true, trackHealth: true, text: 'Deliver the van to the harbour warehouse', hostileCars: 2, dialogue: [
        [NAMES.mechanic, 'Van\'s here, cargo\'s here, you\'re here. That\'s the whole checklist. Payment sent, hero.'],
      ] },
    ],
  },
  {
    id: 'solbay-goodbye', title: 'SOLBAY GOODBYE', reward: 2500,
    steps: [
      { type: 'goto', at: L.clubDoor, r: 3.5, text: `Marisol is leaving Solbay. See her at ${NAMES.club}`, dialogue: [
        [NAMES.fixer, 'The Corsairs burned my office an hour ago. I am done with this city — but I am not leaving on a bus.'],
        [NAMES.fixer, 'Drive me to the airfield. Every badge in Solbay will try to stop us. Get me there anyway, and everything I owe you doubles.'],
      ] },
      { type: 'pickup', at: L.clubDoor, pedAt: { x: -20, z: -1 }, text: 'Pick up Marisol — pull up beside her in any car' },
      { type: 'escape', at: L.airfield, r: 9, text: 'Get Marisol to Solbay Airfield — lose the law or outrun it', dialogue: [
        [NAMES.fixer, 'You drive like this city built you. Solbay is yours now, Reno. Try not to burn it down before I visit.'],
        [NAMES.hero, 'No promises. Travel safe, Marisol.'],
      ] },
    ],
  },
];

const JOB_POINTS = [
  { x: -23, z: -4, label: 'Club Azahar rank' }, { x: 30, z: 210, label: 'Pier rank' },
  { x: -115, z: 100, label: 'Hospital rank' }, { x: 115, z: 44, label: 'Garage rank' },
];
const DESTINATIONS = [
  L.pier, L.viewpoint, L.airfield, L.warehouse, L.marinaLot, L.hospital,
  { x: -161, z: -115 }, { x: 161, z: 69 }, { x: -69, z: 161 }, { x: 69, z: -161 }, { x: -161, z: 23 },
];

export class MissionManager {
  constructor(scene) {
    this.marker = makeMarker(MARKER_COLORS.story);
    scene.add(this.marker);
    this.jobMarker = makeMarker(MARKER_COLORS.job);
    scene.add(this.jobMarker);
    this.missionIndex = 0;
    this.storyDone = false;
    this.current = null;      // active story mission runtime
    this.sideJob = null;      // active side job runtime
    this.time = 0;
  }

  get busy() { return !!this.current; }

  objective() {
    if (this.current) {
      const step = this.current.steps[this.current.stepIndex];
      return { title: this.current.def.title, text: step?.text ?? '', sub: step?.sub ?? '', marker: this.#storyTarget() };
    }
    if (this.sideJob) return { title: this.sideJob.title, text: this.sideJob.text, sub: this.sideJob.sub ?? '', marker: this.sideJob.target };
    if (this.storyDone) return { title: 'SOLBAY IS YOURS', text: 'Story complete. Free roam, work side jobs at the green ranks, and make the city yours.', sub: '', marker: null };
    const next = STORY[this.missionIndex];
    return { title: 'STORY', text: next ? `Start "${next.title}" at the gold marker` : 'Free roam', sub: '', marker: this.#idleTarget() };
  }

  #idleTarget() {
    const def = STORY[this.missionIndex];
    if (!def) return null;
    const first = def.steps[0];
    return first.at ? { x: first.at.x, z: first.at.z, color: 'story' } : null;
  }

  #storyTarget() {
    const step = this.current?.steps[this.current.stepIndex];
    if (!step) return null;
    if (step.type === 'takecar' || step.type === 'stealcar') {
      const car = this.current.spawnedCar;
      return car ? { x: car.pos.x, z: car.pos.z, color: 'target' } : (step.at ? { x: step.at.x, z: step.at.z, color: 'story' } : null);
    }
    return step.at ? { x: step.at.x, z: step.at.z, color: step.type === 'eliminate' ? 'target' : 'story' } : null;
  }

  // Begin the next story mission (called when the player reaches the idle marker / presses E there).
  startStoryMission(game) {
    const def = STORY[this.missionIndex];
    if (!def || this.current) return false;
    this.current = { def, stepIndex: 0, steps: def.steps, spawnedCar: null, hostiles: [], hostileCars: [], started: false };
    if (def.grantGun) game.grantGun();
    game.hud.showBanner(def.title, `Reward $${def.reward}`);
    game.sound.missionComplete();
    this.#setupStep(game);
    return true;
  }

  #setupStep(game) {
    const step = this.current.steps[this.current.stepIndex];
    if (!step) return;
    if ((step.type === 'takecar' || step.type === 'stealcar') && step.spawn && !this.current.spawnedCar) {
      const s = step.spawn;
      const car = new Car(game.scene, s.kind, s.color, s.x, s.z, s.heading);
      car.driver = null;
      this.current.spawnedCar = car;
      game.registerCar(car);
    }
    if (step.type === 'pickup' && step.pedAt) {
      this.current.passengerPed = game.peds.spawnAt(step.pedAt.x, step.pedAt.z, false);
    }
    if (step.type === 'escape') {
      game.wanted.heat = Math.max(game.wanted.heat, 4); // straight to four stars
      game.wanted.lockFloor = 4;
      game.toast('The whole force is coming. DRIVE!');
    }
    if (step.type === 'goto' && step.hostileCars) {
      for (let k = 0; k < step.hostileCars; k++) {
        const p = game.player.pos;
        const car = new Car(game.scene, 'coupe', 0x30343c, p.x + randRange(game.rng, -50, 50), p.z - 60 - k * 18, 0);
        car.driver = 'hostile';
        this.current.hostileCars.push(car);
        game.registerCar(car);
      }
    }
  }

  #advanceStep(game) {
    const step = this.current.steps[this.current.stepIndex];
    if (step?.dialogue) {
      game.dialogue(step.dialogue, () => this.#afterDialogue(game));
    } else this.#afterDialogue(game);
  }

  #afterDialogue(game) {
    if (!this.current) return;
    this.current.stepIndex++;
    if (this.current.stepIndex >= this.current.steps.length) { this.#completeMission(game); return; }
    this.#setupStep(game);
  }

  #completeMission(game) {
    const def = this.current.def;
    game.addMoney(def.reward, true);
    game.hud.showBanner('MISSION COMPLETE', `${def.title} · +$${def.reward}`);
    game.sound.missionComplete();
    this.#cleanup(game);
    this.current = null;
    this.missionIndex++;
    if (this.missionIndex >= STORY.length) {
      this.storyDone = true;
      game.hud.showBanner('STORY COMPLETE', 'Solbay is yours, Reno.', 4);
    }
    game.autosave();
  }

  failMission(game, reason) {
    if (!this.current) return;
    game.hud.showBanner('MISSION FAILED', reason, 3);
    game.sound.missionFail();
    this.#cleanup(game);
    this.current = null;
    game.wanted.lockFloor = 0;
  }

  #cleanup(game) {
    if (!this.current) return;
    for (const ped of this.current.hostiles) if (!ped.down) { ped.hostile = false; ped.state = 'walk'; }
    for (const car of this.current.hostileCars) { game.unregisterCar(car); car.dispose(game.scene); }
    if (this.current.passengerPed) { this.current.passengerPed.dispose(game.scene); game.peds.peds.splice(game.peds.peds.indexOf(this.current.passengerPed), 1); }
    this.current.hostiles = [];
    this.current.hostileCars = [];
    this.current.passengerPed = null;
  }

  // The player was wasted or busted: any active mission resets to its first step.
  onPlayerDown(game) {
    if (this.current) {
      this.#cleanup(game);
      this.current = null;
    }
    if (this.sideJob) this.sideJob = null;
    game.wanted.lockFloor = 0;
  }

  // ---- side jobs -------------------------------------------------------

  nearJobPoint(pos) {
    for (const jp of JOB_POINTS) if (Math.hypot(pos.x - jp.x, pos.z - jp.z) < 3.4) return jp;
    return null;
  }

  startSideJob(game) {
    if (this.sideJob) return false;
    const rng = game.rng;
    const dest = pick(rng, DESTINATIONS);
    const kind = rng() > 0.5 ? 'fare' : 'parcel';
    const from = game.player.pos;
    if (kind === 'fare') {
      // A passenger waits somewhere across town; the pickup point becomes the first leg.
      const pickupAt = pick(rng, DESTINATIONS);
      const ped = game.peds.spawnAt(pickupAt.x + 2, pickupAt.z + 2, false);
      this.sideJob = {
        kind, title: 'FARE RUN', stage: 'pickup', ped,
        target: { x: pickupAt.x, z: pickupAt.z, color: 'pickup' },
        dest: { x: dest.x, z: dest.z }, timer: 0, reward: 0,
        text: 'Pick up the passenger at the blue marker',
      };
    } else {
      const dist = Math.hypot(dest.x - from.x, dest.z - from.z);
      this.sideJob = {
        kind, title: 'PARCEL RUSH', stage: 'deliver',
        target: { x: dest.x, z: dest.z, color: 'job' }, dest,
        timer: dist / 9 + 45, reward: Math.round(dist * 0.85) + 40,
        text: `Rush the parcel across town — $${Math.round(dist * 0.85) + 40} on delivery`,
      };
      this.sideJob.sub = '';
    }
    game.sound.pickup();
    return true;
  }

  #updateSideJob(dt, game) {
    const job = this.sideJob;
    if (!job) { this.jobMarker.visible = false; return; }
    const p = game.player.pos;
    const t = job.target;
    this.jobMarker.visible = true;
    this.jobMarker.position.set(t.x, game.world.groundHeight(t.x, t.z), t.z);
    if (job.stage === 'pickup') {
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      if (game.player.driving && d < 5 && Math.abs(game.player.car.speed) < 1.5) {
        job.ped.dispose(game.scene);
        game.peds.peds.splice(game.peds.peds.indexOf(job.ped), 1);
        job.ped = null;
        job.stage = 'deliver';
        const dist = Math.hypot(job.dest.x - p.x, job.dest.z - p.z);
        job.timer = dist / 9 + 45;
        job.reward = Math.round(dist * 0.85) + 40;
        job.target = { x: job.dest.x, z: job.dest.z, color: 'job' };
        job.text = `Drive the passenger across town — $${job.reward} fare`;
        game.toast('Passenger in. The clock is running!');
        game.sound.pickup();
      }
    } else {
      job.timer -= dt;
      job.sub = `Time left ${Math.max(0, job.timer).toFixed(0)}s`;
      const d = Math.hypot(p.x - job.target.x, p.z - job.target.z);
      if (d < 6.5 && (!game.player.driving || Math.abs(game.player.car.speed) < 2.5)) {
        game.addMoney(job.reward, true);
        game.state.sideJobsDone++;
        game.hud.showBanner('JOB DONE', `+$${job.reward}`);
        game.sound.cash();
        this.sideJob = null;
        game.autosave();
      } else if (job.timer <= 0) {
        game.hud.showBanner('JOB FAILED', 'Too slow — no pay', 2.4);
        game.sound.missionFail();
        if (job.ped) { job.ped.dispose(game.scene); game.peds.peds.splice(game.peds.peds.indexOf(job.ped), 1); }
        this.sideJob = null;
      }
    }
  }

  // ---- per-frame -------------------------------------------------------

  update(dt, game) {
    this.time += dt;
    const pulse = 0.3 + Math.sin(this.time * 3.2) * 0.1;
    this.marker.children[0].material.opacity = pulse;
    this.jobMarker.children[0].material.opacity = pulse;
    this.#updateSideJob(dt, game);
    if (!this.current) {
      const idle = this.#idleTarget();
      if (idle && !this.sideJob) {
        this.marker.visible = true;
        this.marker.children[0].material.color.setHex(MARKER_COLORS.story);
        this.marker.children[1].material.color.setHex(MARKER_COLORS.story);
        this.marker.position.set(idle.x, game.world.groundHeight(idle.x, idle.z), idle.z);
      } else this.marker.visible = false;
      return;
    }
    const step = this.current.steps[this.current.stepIndex];
    const target = this.#storyTarget();
    if (target) {
      this.marker.visible = true;
      this.marker.position.set(target.x, game.world.groundHeight(target.x, target.z), target.z);
      this.marker.children[0].material.color.setHex(MARKER_COLORS[target.color] ?? MARKER_COLORS.story);
      this.marker.children[1].material.color.setHex(MARKER_COLORS[target.color] ?? MARKER_COLORS.story);
      this.marker.children[2].material.color.setHex(MARKER_COLORS[target.color] ?? MARKER_COLORS.story);
    } else this.marker.visible = false;
    if (!step || game.dialogueOpen) return;

    const p = game.player.pos;
    const near = (at, r) => Math.hypot(p.x - at.x, p.z - at.z) < r;
    switch (step.type) {
      case 'goto': {
        const inCarOk = !step.inCar || game.player.driving;
        if (step.trackHealth && this.current.spawnedCar && this.current.spawnedCar.health <= 0) {
          this.failMission(game, 'The van was wrecked');
          return;
        }
        if (near(step.at, step.r) && inCarOk) this.#advanceStep(game);
        break;
      }
      case 'takecar': {
        if (game.player.driving && game.player.car === this.current.spawnedCar) this.#advanceStep(game);
        break;
      }
      case 'stealcar': {
        if (game.player.driving && game.player.car === this.current.spawnedCar) {
          game.toast('Got it. Now deliver it — clean.');
          this.#advanceStep(game);
        }
        break;
      }
      case 'delivercar': {
        const inCar = game.player.driving && game.player.car === this.current.spawnedCar;
        if (inCar && near(step.at, step.r)) {
          if (step.noWanted && game.wanted.active) {
            step.sub = 'Lose the police before you deliver (break their line of sight)';
          } else { step.sub = ''; this.#advanceStep(game); }
        }
        break;
      }
      case 'eliminate': {
        if (!this.current.hostiles.length && !this.current.fightStarted) {
          if (near(step.at, 42)) {
            this.current.fightStarted = true;
            for (let k = 0; k < step.count; k++) {
              const ped = game.peds.spawnAt(step.at.x + randRange(game.rng, -7, 7), step.at.z + randRange(game.rng, -7, 7), true);
              this.current.hostiles.push(ped);
            }
            game.toast('Corsairs! Take them down!');
            game.wanted.reportCrime(0.4);
          }
        } else if (this.current.fightStarted) {
          const left = this.current.hostiles.filter((h) => !h.down).length;
          step.sub = `${left} Corsair${left === 1 ? '' : 's'} standing`;
          if (left === 0) { step.sub = ''; this.#advanceStep(game); }
        }
        break;
      }
      case 'pickup': {
        if (game.player.driving && near(step.at, 5.5) && Math.abs(game.player.car.speed) < 2) {
          if (this.current.passengerPed) {
            this.current.passengerPed.dispose(game.scene);
            game.peds.peds.splice(game.peds.peds.indexOf(this.current.passengerPed), 1);
            this.current.passengerPed = null;
          }
          game.toast('Marisol is in. GO!');
          this.#advanceStep(game);
        }
        break;
      }
      case 'escape': {
        if (near(step.at, step.r)) {
          game.wanted.clear();
          this.#advanceStep(game);
        }
        break;
      }
    }
    // Hostile cars hunt the player for the cargo run.
    for (const car of this.current.hostileCars) {
      if (car.dead) { car.coast(dt); continue; }
      const targetPos = game.player.pos;
      const desired = Math.atan2(targetPos.x - car.pos.x, targetPos.z - car.pos.z);
      const delta = Math.atan2(Math.sin(desired - car.heading), Math.cos(desired - car.heading));
      car.drive(dt, 0.95, Math.max(-1, Math.min(1, delta * 1.8)), false);
      game.world.resolveCircle(car.pos, 1.7);
    }
    if (step?.trackHealth && this.current.spawnedCar) step.sub = `Van condition ${Math.max(0, Math.round(this.current.spawnedCar.health))}%`;
  }
}
