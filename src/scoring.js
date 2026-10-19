// Turns the rotation a dolphin accumulated during one jump into tricks and points.

const TAU = Math.PI * 2;
// A rotation counts once it gets within this many radians of a full turn,
// so a 330° flip still scores.
const ROTATION_GRACE = (30 * Math.PI) / 180;

const TRICK_TYPES = {
  backflip: { label: 'Backflip', base: 500 },
  frontflip: { label: 'Frontflip', base: 550 },
  spin: { label: 'Spin', base: 400 },
  roll: { label: 'Barrel Roll', base: 300 },
};

export const LANDING = {
  perfect: { label: 'PERFECT!', maxAngle: 20, scoreMult: 1.5, speedKeep: 1.15 },
  clean: { label: 'Clean', maxAngle: 45, scoreMult: 1.0, speedKeep: 1.04 },
  wipeout: { label: 'WIPEOUT', maxAngle: 180, scoreMult: 0, speedKeep: 0.5 },
};

export function fullTurns(radians) {
  return Math.floor((Math.abs(radians) + ROTATION_GRACE) / TAU);
}

// rotation: accumulated local-axis rotation {x: pitch, y: yaw, z: roll} in radians.
export function countTricks(rotation) {
  const tricks = [];
  const flips = fullTurns(rotation.x);
  if (flips) tricks.push({ type: rotation.x > 0 ? 'backflip' : 'frontflip', count: flips });
  const spins = fullTurns(rotation.y);
  if (spins) tricks.push({ type: 'spin', count: spins });
  const rolls = fullTurns(rotation.z);
  if (rolls) tricks.push({ type: 'roll', count: rolls });
  return tricks;
}

export function describeTricks(tricks) {
  return tricks
    .map(({ type, count }) => {
      const { label } = TRICK_TYPES[type];
      return count > 1 ? `${label} ×${count}` : label;
    })
    .join(' + ');
}

export function gradeLanding(angleDeg) {
  if (angleDeg <= LANDING.perfect.maxAngle) return 'perfect';
  if (angleDeg <= LANDING.clean.maxAngle) return 'clean';
  return 'wipeout';
}

// Points for one jump before the combo multiplier.
export function scoreJump({ tricks, maxHeight, grade }) {
  let trickPoints = 0;
  for (const { type, count } of tricks) {
    // Each extra rotation of the same trick is worth a bit more than the last.
    trickPoints += TRICK_TYPES[type].base * count * (1 + 0.25 * (count - 1));
  }
  const variety = 1 + 0.5 * Math.max(0, tricks.length - 1);
  const heightPoints = Math.floor(Math.max(0, maxHeight)) * 10;
  return Math.round((trickPoints * variety + heightPoints) * LANDING[grade].scoreMult);
}

export function comboMultiplier(combo) {
  return 1 + 0.25 * Math.max(0, combo - 1);
}

// Tracks score and combo across jumps.
export class ScoreKeeper {
  constructor() {
    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.bestJump = 0;
    this.maxHeight = 0;
  }

  land({ rotation, maxHeight, grade }) {
    const tricks = countTricks(rotation);
    this.maxHeight = Math.max(this.maxHeight, maxHeight);
    if (grade === 'wipeout') {
      this.combo = 0;
      return { tricks, grade, points: 0, combo: 0, multiplier: 1 };
    }
    // Plain jumps keep the combo alive but only tricks grow it.
    if (tricks.length) this.combo += 1;
    const multiplier = comboMultiplier(this.combo);
    const points = Math.round(scoreJump({ tricks, maxHeight, grade }) * multiplier);
    this.score += points;
    this.bestJump = Math.max(this.bestJump, points);
    return { tricks, grade, points, combo: this.combo, multiplier };
  }
}
