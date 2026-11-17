// hud.js — everything drawn over the 3D view: the objective panel, wanted stars, money and
// clock, health and busted bars, weapon readout, speedometer, prompts, toasts, dialogue
// boxes, mission banners, and the circular minimap (roads, blocks, the beach, blips for the
// objective, side jobs, hostiles and the police, and the player's arrow).

import { CITY, streetCoord } from './config.js';
import { clamp } from './random.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.objectiveTitle = $('objectiveTitle');
    this.objectiveText = $('objectiveText');
    this.objectiveSub = $('objectiveSub');
    this.wantedEl = $('wanted');
    this.moneyEl = $('money');
    this.clockEl = $('clock');
    this.healthFill = $('healthFill');
    this.bustedFill = $('bustedFill');
    this.weaponEl = $('weapon');
    this.speedo = $('speedo');
    this.crosshair = $('crosshair');
    this.promptEl = $('prompt');
    this.toastEl = $('toast');
    this.dialogueEl = $('dialogue');
    this.dialogueName = $('dialogueName');
    this.dialogueText = $('dialogueText');
    this.banner = $('missionBanner');
    this.bannerTitle = $('missionBannerTitle');
    this.bannerSub = $('missionBannerSub');
    this.vignette = $('vignette');
    this.mapCtx = $('minimap').getContext('2d');
    this.toastTimer = 0;
    this.bannerTimer = 0;
    this.lastStars = -1;
    this.lastMoney = null;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setObjective(title, text, sub = '') {
    this.objectiveTitle.textContent = title;
    this.objectiveText.textContent = text;
    this.objectiveSub.textContent = sub;
  }

  toast(text, seconds = 3) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = seconds;
  }

  showBanner(title, sub = '', seconds = 2.6) {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.classList.remove('hidden');
    this.bannerTimer = seconds;
  }

  showDialogue(name, text) {
    this.dialogueName.textContent = name;
    this.dialogueText.textContent = text;
    this.dialogueEl.classList.remove('hidden');
  }
  hideDialogue() { this.dialogueEl.classList.add('hidden'); }
  get dialogueOpen() { return !this.dialogueEl.classList.contains('hidden'); }

  setPrompt(html) {
    if (html) { this.promptEl.innerHTML = html; this.promptEl.classList.remove('hidden'); }
    else this.promptEl.classList.add('hidden');
  }

  update(dt, s) {
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.classList.add('hidden'); }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.banner.classList.add('hidden'); }
    if (s.stars !== this.lastStars) {
      this.lastStars = s.stars;
      let html = '';
      for (let i = 0; i < 5; i++) html += i < s.stars ? '★' : '<span class="off">★</span>';
      this.wantedEl.innerHTML = html;
    }
    if (s.money !== this.lastMoney) {
      this.lastMoney = s.money;
      this.moneyEl.textContent = '$' + Math.round(s.money).toLocaleString('en-US');
    }
    const hh = String(Math.floor(s.clockMin / 60) % 24).padStart(2, '0');
    const mm = String(Math.floor(s.clockMin % 60)).padStart(2, '0');
    this.clockEl.textContent = `DAY ${s.day} · ${hh}:${mm}`;
    this.healthFill.style.width = clamp(s.health, 0, 100) + '%';
    this.bustedFill.style.width = clamp(s.busted * 100, 0, 100) + '%';
    this.weaponEl.innerHTML = s.weaponText;
    this.crosshair.classList.toggle('hidden', !s.showCrosshair);
    if (s.speedKmh !== null) {
      this.speedo.classList.remove('hidden');
      this.speedo.innerHTML = `${Math.abs(Math.round(s.speedKmh))} <small>KM/H</small>`;
    } else this.speedo.classList.add('hidden');
    this.vignette.style.opacity = s.damageFlash > 0 ? String(clamp(s.damageFlash, 0, 1)) : '0';
  }

  // The minimap: a 120-metre-radius north-up view. view = {player, heading, blocks, blips, police}
  drawMinimap(view) {
    const g = this.mapCtx, S = 196, C = S / 2, R = 120;
    const scale = C / R;
    const px = view.player.x, pz = view.player.z;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(C, C, C - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#274b63'; g.fillRect(0, 0, S, S); // city ground wash
    const toMap = (x, z) => [C + (x - px) * scale, C + (z - pz) * scale];
    // Sand and sea to the south.
    let [, sandY] = toMap(0, CITY.beachZ);
    g.fillStyle = '#e8d193'; g.fillRect(0, sandY, S, S - sandY);
    let [, seaY] = toMap(0, CITY.oceanZ);
    g.fillStyle = '#1e7f96'; g.fillRect(0, seaY, S, S - seaY);
    // Blocks.
    g.fillStyle = '#8b93a1';
    for (const b of view.blocks) {
      const [x0, y0] = toMap(b.x - b.half, b.z - b.half);
      const [x1, y1] = toMap(b.x + b.half, b.z + b.half);
      if (x1 < 0 || y1 < 0 || x0 > S || y0 > S) continue;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // Streets.
    g.strokeStyle = '#2c2f36'; g.lineWidth = CITY.roadHalf * 2 * scale;
    g.beginPath();
    for (let i = -CITY.halfBlocks; i <= CITY.halfBlocks; i++) {
      const [vx] = toMap(streetCoord(i), 0);
      g.moveTo(vx, 0); g.lineTo(vx, S);
      const [, hz] = toMap(0, streetCoord(i));
      g.moveTo(0, hz); g.lineTo(S, hz);
    }
    g.stroke();
    // Blips.
    for (const blip of view.blips) {
      const [x, y] = toMap(blip.x, blip.z);
      if (x < 4 || y < 4 || x > S - 4 || y > S - 4) continue;
      g.fillStyle = blip.color;
      if (blip.shape === 'diamond') {
        g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y); g.lineTo(x, y + 6); g.lineTo(x - 5, y); g.closePath(); g.fill();
        g.strokeStyle = '#10131f'; g.lineWidth = 1.4; g.stroke();
      } else {
        g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
      }
    }
    // Police as blue dots.
    g.fillStyle = '#4da3ff';
    for (const cop of view.police) {
      const [x, y] = toMap(cop.x, cop.z);
      if (x < 3 || y < 3 || x > S - 3 || y > S - 3) continue;
      g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
    }
    // The player's arrow, centre, turned to the player's heading.
    g.translate(C, C);
    g.rotate(view.heading);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#10131f'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath();
    g.fill(); g.stroke();
    g.restore();
    g.fillStyle = '#fff';
    g.font = '700 11px Arial';
    g.fillText('N', C - 3, 14);
  }
}
