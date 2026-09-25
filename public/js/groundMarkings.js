import { VENUES, TRACK, TRACK_WIDTH, TRACK_DEPTH } from './groundCatalog.js';

// Coordinates are metres before one uniform projection into the rectangular UV.
export function stadiumPath(g, straight, radius) {
  g.beginPath(); g.moveTo(-straight / 2, -radius); g.lineTo(straight / 2, -radius);
  g.arc(straight / 2, 0, radius, -Math.PI / 2, Math.PI / 2);
  g.lineTo(-straight / 2, radius);
  g.arc(-straight / 2, 0, radius, Math.PI / 2, Math.PI * 1.5); g.closePath();
}
export function paintTrack(g) {
  g.save(); g.translate(.5, .5); g.scale(1 / TRACK_WIDTH, 1 / TRACK_DEPTH);
  // A visible safety apron separates the outer lane from mesh-edge shading and filtering.
  g.fillStyle = '#798969'; g.fillRect(-TRACK_WIDTH / 2, -TRACK_DEPTH / 2, TRACK_WIDTH, TRACK_DEPTH);
  stadiumPath(g, TRACK.straight, TRACK.radius + TRACK.lanes * TRACK.lane);
  g.fillStyle = '#b46950'; g.fill();
  g.lineWidth = TRACK.lineWidth; g.strokeStyle = '#eee6d7';
  stadiumPath(g, TRACK.straight, TRACK.radius); g.fillStyle = '#718956'; g.fill();
  for (let lane = 0; lane <= TRACK.lanes; lane++) {
    stadiumPath(g, TRACK.straight, TRACK.radius + lane * TRACK.lane); g.stroke();
  }
  // Common finish on the straight; lane numbers stay within their own lanes.
  g.beginPath(); g.moveTo(TRACK.straight / 2 - 3, TRACK.radius);
  g.lineTo(TRACK.straight / 2 - 3, TRACK.radius + TRACK.lanes * TRACK.lane); g.stroke();
  g.font = '1px sans-serif'; g.fillStyle = '#f5edde';
  for (let i = 0; i < TRACK.lanes; i++) g.fillText(String(i + 1), TRACK.straight / 2 - 6, TRACK.radius + (i + .7) * TRACK.lane);
  g.restore();
}

function drawBasketballCourt(g) {
  g.strokeStyle = '#f3ede0'; g.lineWidth = .05;
  g.strokeRect(-14, -7.5, 28, 15);
  g.beginPath(); g.moveTo(0, -7.5); g.lineTo(0, 7.5); g.stroke();
  g.beginPath(); g.arc(0, 0, 1.8, 0, Math.PI * 2); g.stroke();
  for (const sign of [-1, 1]) {
    g.save(); g.scale(sign, 1);
    g.strokeRect(14 - 5.8, -2.45, 5.8, 4.9);
    g.beginPath(); g.arc(14 - 5.8, 0, 1.8, Math.PI / 2, Math.PI * 1.5); g.stroke();
    const basket = 14 - 1.575, radius = 6.75, side = 6.6, a = Math.asin(side / radius);
    const join = basket - Math.sqrt(radius * radius - side * side);
    g.beginPath(); g.moveTo(14, -side); g.lineTo(join, -side);
    g.arc(basket, 0, radius, Math.PI + a, Math.PI - a, true);
    g.lineTo(14, side); g.stroke();
    g.restore();
  }
}

export function paintBasketball(g) {
  g.save(); g.translate(.5, .5); g.scale(.84 / 28, .84 / 15);
  drawBasketballCourt(g);
  g.restore();
}

export function paintParking(g, widthM = 36, depthM = 25) {
  const line = (x, y, a, b) => { g.beginPath(); g.moveTo(x, y); g.lineTo(a, b); g.stroke(); };
  const W = Math.max(12, widthM);
  const D = Math.max(10, depthM);
  const marginX = 0.06;
  const usableW = 1 - 2 * marginX;

  // Real-world car stall width ~2.5m
  const numCols = Math.max(4, Math.floor((W * usableW) / 2.5));
  const dx = usableW / numCols;

  if (D >= 28) {
    // 4-row layout with 2 aisles (central back-to-back stall island)
    // Row 0 (top): y from 0.05 to 0.22
    line(marginX, 0.05, 1 - marginX, 0.05);
    for (let i = 0; i <= numCols; i++) {
      const x = marginX + i * dx;
      line(x, 0.05, x, 0.22);
    }
    // Rows 1 & 2 (center island): y from 0.38 to 0.62, divider at 0.50
    line(marginX, 0.50, 1 - marginX, 0.50);
    for (let i = 0; i <= numCols; i++) {
      const x = marginX + i * dx;
      line(x, 0.38, x, 0.62);
    }
    // Row 3 (bottom): y from 0.78 to 0.95
    const carCols = Math.max(2, Math.floor(numCols * 0.68));
    line(marginX, 0.95, marginX + carCols * dx, 0.95);
    for (let i = 0; i <= carCols; i++) {
      const x = marginX + i * dx;
      line(x, 0.78, x, 0.95);
    }
    // Motorcycle stalls on bottom-right
    const motoStartX = marginX + carCols * dx + 0.015;
    const motoEndX = 1 - marginX;
    const motoSpan = motoEndX - motoStartX;
    const numMotos = Math.max(3, Math.floor((W * motoSpan) / 1.05));
    const motoDx = motoSpan / numMotos;
    line(motoStartX, 0.81, motoEndX, 0.81);
    line(motoStartX, 0.95, motoEndX, 0.95);
    for (let i = 0; i <= numMotos; i++) {
      const x = motoStartX + i * motoDx;
      line(x, 0.81, x, 0.95);
    }
  } else {
    // 2-row layout with single central driveway
    // Row 0 (top): y from 0.06 to 0.32
    line(marginX, 0.06, 1 - marginX, 0.06);
    for (let i = 0; i <= numCols; i++) {
      const x = marginX + i * dx;
      line(x, 0.06, x, 0.32);
    }
    // Row 1 (bottom left: car stalls): y from 0.68 to 0.94
    const carCols = Math.max(2, Math.floor(numCols * 0.65));
    line(marginX, 0.94, marginX + carCols * dx, 0.94);
    for (let i = 0; i <= carCols; i++) {
      const x = marginX + i * dx;
      line(x, 0.68, x, 0.94);
    }
    // Row 1 (bottom right: motorcycle stalls): y from 0.72 to 0.94
    const motoStartX = marginX + carCols * dx + 0.02;
    const motoEndX = 1 - marginX;
    const motoSpan = motoEndX - motoStartX;
    const numMotos = Math.max(3, Math.floor((W * motoSpan) / 1.05));
    const motoDx = motoSpan / numMotos;
    line(motoStartX, 0.72, motoEndX, 0.72);
    line(motoStartX, 0.94, motoEndX, 0.94);
    for (let i = 0; i <= numMotos; i++) {
      const x = motoStartX + i * motoDx;
      line(x, 0.72, x, 0.94);
    }
  }
}

export function paintCourtArray(g, cols = 1, rows = 1) {
  if (cols <= 1 && rows <= 1) { paintBasketball(g); return; }
  g.save();
  const marginX = 0.04, marginY = 0.04;
  const availW = 1 - 2 * marginX, availH = 1 - 2 * marginY;
  const slotW = availW / cols, slotH = availH / rows;
  const courtAspect = 15 / 28;
  const fitW = Math.min(slotW * 0.90, (slotH * 0.90) / courtAspect);
  const fitH = fitW * courtAspect;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = marginX + (c + 0.5) * slotW;
      const cy = marginY + (r + 0.5) * slotH;
      g.save();
      g.translate(cx, cy);
      g.scale(fitW / 28, fitH / 15);
      drawBasketballCourt(g);
      g.restore();
    }
  }
  g.restore();
}

export function paintVenue(g, id) {
  const v = VENUES[id], L = v.length, W = v.width, p = v.marking;
  g.save(); g.translate(.5, .5); g.scale(.8 / L, .8 / W);
  g.strokeStyle = '#f0ecdc'; g.fillStyle = '#f0ecdc'; g.lineWidth = Math.max(.05, L / 600);
  const line = (x, y, a, b) => { g.beginPath(); g.moveTo(x, y); g.lineTo(a, b); g.stroke(); };
  const circle = (x, y, r, start = 0, end = Math.PI * 2) => { g.beginPath(); g.arc(x, y, r, start, end); g.stroke(); };
  const rect = (x, y, w, h) => g.strokeRect(x, y, w, h);
  const bounds = () => rect(-L / 2, -W / 2, L, W);
  const centre = () => line(0, -W / 2, 0, W / 2);
  const ends = draw => { for (const sign of [-1, 1]) { g.save(); g.scale(sign, 1); draw(); g.restore(); } };
  if (['tennis', 'badminton', 'pickleball', 'volleyball', 'beach', 'takraw'].includes(p)) {
    bounds();
    if (p === 'tennis') {
      for (const y of [-8.23 / 2, 8.23 / 2]) line(-L / 2, y, L / 2, y);
      for (const x of [-6.4, 6.4]) line(x, -8.23 / 2, x, 8.23 / 2);
      line(-6.4, 0, 6.4, 0);
      for (const x of [-L / 2, L / 2]) line(x, 0, x - Math.sign(x) * .1, 0);
    } else if (p === 'badminton') {
      for (const y of [-2.59, 2.59]) line(-L / 2, y, L / 2, y);
      for (const x of [-1.98, 1.98, -L / 2 + .76, L / 2 - .76]) line(x, -W / 2, x, W / 2);
      ends(() => line(1.98, 0, L / 2, 0));
    } else if (p === 'pickleball') {
      for (const x of [-2.1336, 2.1336]) line(x, -W / 2, x, W / 2);
      ends(() => line(2.1336, 0, L / 2, 0));
    } else if (p === 'volleyball') { centre(); for (const x of [-3, 3]) line(x, -W / 2, x, W / 2); }
    else if (p === 'takraw') { centre(); for (const x of [-L / 2 + 2.45, L / 2 - 2.45]) circle(x, 0, .3); }
  } else if (['soccer', 'futsal', 'handball', 'hockey', 'netball'].includes(p)) {
    bounds();
    if (p !== 'netball') centre();
    if (p === 'soccer') {
      circle(0, 0, 9.15);
      ends(() => {
        rect(L / 2 - 16.5, -20.16, 16.5, 40.32); rect(L / 2 - 5.5, -9.16, 5.5, 18.32);
        circle(L / 2 - 11, 0, .18);
        const a = Math.acos(5.5 / 9.15); circle(L / 2 - 11, 0, 9.15, Math.PI - a, Math.PI + a);
        circle(L / 2, -W / 2, 1, Math.PI / 2, Math.PI); circle(L / 2, W / 2, 1, Math.PI, Math.PI * 1.5);
      });
    } else if (p === 'netball') {
      for (const x of [-L / 6, L / 6]) line(x, -W / 2, x, W / 2);
      circle(0, 0, .45); ends(() => circle(L / 2, 0, 4.9, Math.PI / 2, Math.PI * 1.5));
    } else {
      if (p === 'futsal') circle(0, 0, 3);
      const radius = p === 'hockey' ? 14.63 : 6, halfGoal = p === 'hockey' ? 1.83 : 1.5;
      ends(() => {
        g.beginPath(); g.moveTo(L / 2, -halfGoal - radius);
        g.arc(L / 2, -halfGoal, radius, -Math.PI / 2, -Math.PI, true);
        g.lineTo(L / 2 - radius, halfGoal);
        g.arc(L / 2, halfGoal, radius, Math.PI, Math.PI / 2, true); g.stroke();
        if (p === 'handball') line(L / 2 - 7, -.5, L / 2 - 7, .5);
        if (p === 'futsal') { circle(L / 2 - 6, 0, .1); circle(L / 2 - 10, 0, .1); }
        if (p === 'hockey') line(L / 2 - 22.9, -W / 2, L / 2 - 22.9, W / 2);
      });
    }
  } else if (p === 'football' || p === 'rugby') {
    bounds(); const inset = p === 'football' ? 9.144 : 10, play = L - 2 * inset;
    for (const x of [-play / 2, 0, play / 2]) line(x, -W / 2, x, W / 2);
    if (p === 'football') {
      for (let i = 1; i < 20; i++) line(-play / 2 + i * 4.572, -W / 2, -play / 2 + i * 4.572, W / 2);
    } else for (const x of [-play / 2 + 22, play / 2 - 22]) line(x, -W / 2, x, W / 2);
  } else if (p === 'cricket') {
    g.beginPath(); g.ellipse(0, 0, L / 2, W / 2, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#c6b48a'; g.fillRect(-10.06, -1.525, 20.12, 3.05);
    for (const sign of [-1, 1]) { line(sign * 10.06, -1.32, sign * 10.06, 1.32); line(sign * (10.06 - 1.22), -1.83, sign * (10.06 - 1.22), 1.83); }
  } else if (p === 'baseball' || p === 'softball') {
    const base = p === 'baseball' ? 27.432 : 18.288, diag = base / Math.SQRT2, home = -W * .4;
    g.fillStyle = '#b99770'; g.beginPath(); g.moveTo(0, home); g.lineTo(diag, home + diag); g.lineTo(0, home + 2 * diag); g.lineTo(-diag, home + diag); g.closePath(); g.fill();
    line(0, home, L * .44, home + L * .44); line(0, home, -L * .44, home + L * .44);
    circle(0, home, L * .62, Math.PI / 4, Math.PI * .75);
    g.fillStyle = '#eee7d5'; for (const [x, y] of [[0, home], [diag, home + diag], [0, home + 2 * diag], [-diag, home + diag]]) g.fillRect(x - .35, y - .35, .7, .7);
    circle(0, home + (p === 'baseball' ? 18.44 : 13.11), 1.5);
  } else if (p === 'kabaddi') {
    bounds(); centre(); for (const x of [-4.75, -3.75, 3.75, 4.75]) line(x, -W / 2, x, W / 2);
    for (const y of [-W / 2 + 1, W / 2 - 1]) line(-L / 2, y, L / 2, y);
  } else if (p === 'sumo' || p === 'wrestling') {
    circle(0, 0, p === 'sumo' ? 2.275 : 4.5);
    if (p === 'wrestling') { circle(0, 0, 3.5); circle(0, 0, 1); }
    else for (const x of [-.35, .35]) line(x, -.45, x, .45);
  } else if (['boules', 'bocce', 'gateball'].includes(p)) {
    bounds(); if (p === 'bocce') for (const x of [-L / 2 + 4, L / 2 - 4]) line(x, -W / 2, x, W / 2);
  } else if (p === 'archery') {
    line(-L * .3, -W / 2, -L * .3, W / 2); line(-L * .4, -W / 2, -L * .4, W / 2);
  } else if (p === 'longjump') {
    rect(-L / 2, -.61, L - 9, 1.22); g.fillStyle = '#dfc795'; g.fillRect(L / 2 - 9, -1.5, 9, 3);
    line(L / 2 - 10, -.61, L / 2 - 10, .61);
  } else if (p === 'raked') {
    // Intentional gravel rake ripples around the garden's rock group.
    g.strokeStyle = '#aaa796'; g.lineWidth = .08;
    for (let r = 2; r < 7; r += .45) circle(L * .2, W * .15, r);
  } else if (p === 'courtyard' || p === 'forecourt') {
    // A perimeter walking strip, leaving the gathering area unobstructed.
    g.strokeStyle = '#7d776c'; rect(-L * .46, -W * .46, L * .92, W * .92);
  }
  // Commons, markets and plazas have no invented sport/grid markings.
  g.restore();
}
