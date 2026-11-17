// save.js — the game's save file: a JSON record in the browser's localStorage holding the
// player's money, story progress, unlocks and position. Nothing leaves the machine.

import { SAVE_KEY } from './config.js';

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || typeof data.money !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: Math.round(state.money),
      missionIndex: state.missionIndex,
      storyDone: !!state.storyDone,
      hasGun: !!state.hasGun,
      totalEarned: Math.round(state.totalEarned || 0),
      sideJobsDone: state.sideJobsDone || 0,
      x: state.x, z: state.z,
      savedAt: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* private mode */ }
}
