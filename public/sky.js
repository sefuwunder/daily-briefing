/* Tonight's sky — a tiny built-in star chart. Zero dependencies.
 *
 * Star positions are degree-level from a built-in catalog of bright stars
 * (J2000 RA/Dec): fine for casual stargazing, NOT for navigation.
 * Renders a zenith-centered azimuthal projection (horizon = outer circle,
 * N up, E right — map orientation, not mirrored like a printed sky chart).
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.SkyChart = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // name, RA in hours (J2000), Dec in degrees (J2000), V magnitude, constellation
  const STARS = [
    ["Sirius", 6.7525, -16.7161, -1.46, "CMa"],
    ["Canopus", 6.3992, -52.6957, -0.74, "Car"],
    ["Rigil Kent", 14.6600, -60.8353, -0.27, "Cen"],
    ["Arcturus", 14.2611, 19.1824, -0.05, "Boo"],
    ["Vega", 18.6156, 38.7837, 0.03, "Lyr"],
    ["Capella", 5.2781, 45.9980, 0.08, "Aur"],
    ["Rigel", 5.2422, -8.2016, 0.13, "Ori"],
    ["Procyon", 7.6550, 5.2250, 0.34, "CMi"],
    ["Achernar", 1.6286, -57.2368, 0.46, "Eri"],
    ["Betelgeuse", 5.9194, 7.4070, 0.42, "Ori"],
    ["Hadar", 14.0636, -60.3730, 0.61, "Cen"],
    ["Altair", 19.8464, 8.8683, 0.76, "Aql"],
    ["Acrux", 12.4433, -63.0991, 0.76, "Cru"],
    ["Aldebaran", 4.5986, 16.5093, 0.86, "Tau"],
    ["Antares", 16.4900, -26.4320, 0.96, "Sco"],
    ["Spica", 13.4200, -11.1613, 0.97, "Vir"],
    ["Pollux", 7.7553, 28.0262, 1.14, "Gem"],
    ["Fomalhaut", 22.9608, -29.6222, 1.16, "PsA"],
    ["Deneb", 20.6906, 45.2803, 1.25, "Cyg"],
    ["Mimosa", 12.7953, -59.6888, 1.25, "Cru"],
    ["Regulus", 10.1394, 11.9672, 1.35, "Leo"],
    ["Adhara", 6.9772, -28.9721, 1.50, "CMa"],
    ["Castor", 7.5767, 31.8883, 1.58, "Gem"],
    ["Gacrux", 12.5192, -57.1168, 1.63, "Cru"],
    ["Shaula", 17.5601, -37.1038, 1.62, "Sco"],
    ["Bellatrix", 5.4189, 6.3500, 1.64, "Ori"],
    ["Elnath", 5.4383, 28.6075, 1.65, "Tau"],
    ["Miaplacidus", 9.2200, -69.7172, 1.68, "Car"],
    ["Alnilam", 5.6036, -1.2019, 1.69, "Ori"],
    ["Alnair", 22.1372, -46.9610, 1.74, "Gru"],
    ["Regor", 8.1589, -47.3366, 1.75, "Vel"],
    ["Alioth", 12.9006, 55.9598, 1.77, "UMa"],
    ["Alnitak", 5.6794, -1.9428, 1.77, "Ori"],
    ["Dubhe", 11.0622, 61.7510, 1.79, "UMa"],
    ["Mirfak", 3.4053, 49.8612, 1.79, "Per"],
    ["Wezen", 7.1397, -26.3932, 1.83, "CMa"],
    ["Kaus Australis", 18.4017, -34.3846, 1.85, "Sgr"],
    ["Sargas", 17.6219, -43.2395, 1.86, "Sco"],
    ["Avior", 8.3753, -59.5092, 1.86, "Car"],
    ["Alkaid", 13.7922, 49.3133, 1.86, "UMa"],
    ["Menkalinan", 5.9922, 44.9474, 1.90, "Aur"],
    ["Atria", 16.8114, -69.0279, 1.91, "TrA"],
    ["Alhena", 6.6286, 16.3992, 1.92, "Gem"],
    ["Peacock", 20.4275, -56.7351, 1.94, "Pav"],
    ["Mirzam", 6.3783, -17.9559, 1.98, "CMa"],
    ["Alphard", 9.4597, -8.6586, 1.98, "Hya"],
    ["Polaris", 2.5303, 89.2641, 1.98, "UMi"],
    ["Hamal", 2.1194, 23.4624, 2.00, "Ari"],
    ["Algieba", 10.3328, 19.8415, 2.01, "Leo"],
    ["Nunki", 18.9212, -26.2967, 2.02, "Sgr"],
    ["Deneb Kaitos", 0.7264, -17.9866, 2.04, "Cet"],
    ["Alpheratz", 0.1400, 29.0909, 2.07, "And"],
    ["Kochab", 14.8450, 74.1555, 2.08, "UMi"],
    ["Rasalhague", 17.5822, 12.5600, 2.08, "Oph"],
    ["Algol", 3.1361, 40.9568, 2.09, "Per"],
    ["Saiph", 5.7958, -9.6696, 2.09, "Ori"],
    ["Denebola", 11.8178, 14.5721, 2.11, "Leo"],
    ["Sadr", 20.3706, 40.2570, 2.20, "Cyg"],
    ["Suhail", 9.1331, -43.4325, 2.21, "Vel"],
    ["Naos", 8.0597, -40.0033, 2.25, "Pup"],
    ["Aspidiske", 9.2831, -59.2748, 2.25, "Car"],
    ["Mintaka", 5.5333, -0.2991, 2.23, "Ori"],
    ["Mizar", 13.3989, 54.9254, 2.23, "UMa"],
    ["Etamin", 17.9433, 51.4890, 2.24, "Dra"],
    ["Schedar", 0.6750, 56.5373, 2.24, "Cas"],
    ["Caph", 0.1528, 59.1498, 2.27, "Cas"],
    ["Dschubba", 16.0056, -22.6217, 2.29, "Sco"],
    ["Merak", 11.0306, 56.3824, 2.37, "UMa"],
    ["Enif", 21.7364, 9.8750, 2.39, "Peg"],
    ["Sabik", 17.1731, -15.7249, 2.43, "Oph"],
    ["Phecda", 11.8972, 53.6948, 2.44, "UMa"],
    ["Alderamin", 21.3097, 62.5856, 2.45, "Cep"],
    ["Aludra", 7.4008, -29.3031, 2.45, "CMa"],
    ["Gienah", 20.7703, 33.9708, 2.46, "Cyg"],
    ["Gamma Cas", 0.9450, 60.7167, 2.47, "Cas"],
    ["Markab", 23.0794, 15.2053, 2.48, "Peg"],
    ["Scheat", 23.0631, 28.0828, 2.42, "Peg"],
    ["Zosma", 11.2350, 20.5236, 2.56, "Leo"],
    ["Arneb", 5.5455, -17.8222, 2.58, "Lep"],
    ["Graffias", 16.0908, -19.8044, 2.62, "Sco"],
    ["Phact", 5.6608, -34.0741, 2.65, "Col"],
    ["Ruchbah", 1.4300, 60.2353, 2.68, "Cas"],
    ["Lesath", 16.8361, -37.2956, 2.69, "Sco"],
    ["Tarazed", 19.7711, 10.6132, 2.72, "Aql"],
    ["Rastaban", 17.5072, 52.3010, 2.79, "Dra"],
    ["Paikauhale", 16.5981, -28.2157, 2.82, "Sco"],
    ["Algenib", 0.2206, 15.1836, 2.84, "Peg"],
    ["Alcyone", 3.7900, 24.1168, 2.87, "Tau"],
    ["Gomeisa", 7.4525, 8.2893, 2.89, "CMi"],
    ["Albireo", 19.5119, 27.9597, 3.18, "Cyg"],
    ["Alrai", 23.6558, 77.6320, 3.21, "Cep"],
    ["Megrez", 12.2572, 57.0326, 3.31, "UMa"],
    ["Segin", 2.2275, 63.6699, 3.35, "Cas"],
    ["Sheliak", 18.8347, 33.3626, 3.52, "Lyr"],
    ["Alshain", 19.9181, 6.4068, 3.71, "Aql"],
  ].map(([name, ra, dec, mag, con]) => ({ name, ra, dec, mag, con }));

  // Constellation stick figures, as star-name pairs.
  const LINES = [
    ["Dubhe", "Merak"], ["Merak", "Phecda"], ["Phecda", "Megrez"],
    ["Megrez", "Alioth"], ["Alioth", "Mizar"], ["Mizar", "Alkaid"],
    ["Betelgeuse", "Bellatrix"], ["Betelgeuse", "Alnitak"], ["Bellatrix", "Mintaka"],
    ["Alnitak", "Alnilam"], ["Alnilam", "Mintaka"], ["Alnitak", "Rigel"],
    ["Mintaka", "Saiph"], ["Rigel", "Saiph"],
    ["Caph", "Schedar"], ["Schedar", "Gamma Cas"], ["Gamma Cas", "Ruchbah"], ["Ruchbah", "Segin"],
    ["Deneb", "Sadr"], ["Sadr", "Albireo"], ["Sadr", "Gienah"],
    ["Dschubba", "Graffias"], ["Graffias", "Antares"], ["Antares", "Paikauhale"],
    ["Paikauhale", "Lesath"], ["Lesath", "Shaula"], ["Shaula", "Sargas"],
    ["Regulus", "Algieba"], ["Algieba", "Zosma"], ["Zosma", "Denebola"],
    ["Castor", "Pollux"], ["Pollux", "Alhena"],
    ["Sirius", "Mirzam"], ["Sirius", "Wezen"], ["Wezen", "Adhara"],
    ["Altair", "Tarazed"], ["Altair", "Alshain"],
    ["Acrux", "Gacrux"], ["Mimosa", "Gacrux"],
    ["Markab", "Scheat"], ["Scheat", "Algenib"], ["Algenib", "Alpheratz"], ["Alpheratz", "Markab"],
    ["Aldebaran", "Alcyone"],
    ["Polaris", "Kochab"],
    ["Vega", "Sheliak"],
    ["Hadar", "Rigil Kent"],
  ];

  // Constellation name labels: [label, anchor star, dx, dy] in chart units.
  const CONSTELLATIONS = [
    ["Ursa Major", "Mizar", 12, -12],
    ["Orion", "Alnilam", 36, 8],
    ["Cassiopeia", "Gamma Cas", 10, -12],
    ["Cygnus", "Sadr", 32, -8],
    ["Scorpius", "Antares", -66, -10],
    ["Leo", "Algieba", 8, 16],
    ["Gemini", "Pollux", 32, -10],
    ["Canis Major", "Sirius", 36, 12],
  ];

  const byName = {};
  STARS.forEach((s) => { byName[s.name] = s; });

  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  // Greenwich Mean Sidereal Time, degrees 0..360.
  function gmstDeg(jd) {
    const T = (jd - 2451545.0) / 36525;
    const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
      + 0.000387933 * T * T - (T * T * T) / 38710000;
    return (((g % 360) + 360) % 360);
  }

  // -> { alt, az } in degrees; az measured from north, clockwise (E = 90).
  function altAz(raH, decD, latD, lonD, date) {
    const lst = (((gmstDeg(julianDay(date)) + lonD) % 360) + 360) % 360;
    const ha = (((lst - raH * 15) % 360) + 540) % 360 - 180; // -180..180
    const dec = (decD * Math.PI) / 180;
    const lat = (latD * Math.PI) / 180;
    const h = (ha * Math.PI) / 180;
    const sinAlt = Math.sin(dec) * Math.sin(lat)
      + Math.cos(dec) * Math.cos(lat) * Math.cos(h);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const y = Math.sin(h);
    const x = Math.cos(h) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat);
    const azSouth = (Math.atan2(y, x) * 180) / Math.PI; // from south, +westward
    const az = ((((azSouth + 180) % 360) + 360) % 360); // from north, clockwise
    return { alt: (alt * 180) / Math.PI, az };
  }

  // Convert a wall-clock time in an IANA timezone to a UTC Date.
  function zonedToUtc(tz, y, mo, d, h, mi) {
    const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(guess);
    const p = {};
    for (const x of parts) p[x.type] = x.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
    return new Date(guess.getTime() - (asUTC - guess.getTime()));
  }

  // The upcoming `hour`:00 in the given timezone (rolls to tomorrow if past).
  function tonightAt(tz, hour, now) {
    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    });
    let [y, m, d] = dayFmt.format(now).split("-").map(Number);
    let t = zonedToUtc(tz || "UTC", y, m, d, hour, 0);
    if (t.getTime() <= now.getTime()) {
      [y, m, d] = dayFmt.format(new Date(t.getTime() + 86400000)).split("-").map(Number);
      t = zonedToUtc(tz || "UTC", y, m, d, hour, 0);
    }
    return t;
  }

  // Project a star to chart pixels. Exposed for tests.
  function project(raH, decD, lat, lon, date, W, H) {
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 14;
    const { alt, az } = altAz(raH, decD, lat, lon, date);
    const r = ((90 - alt) / 90) * R;
    const a = (az * Math.PI) / 180;
    return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a), alt, az, R, cx, cy };
  }

  // Render the chart into a <canvas>. Returns { visible, labeled, top3 }.
  function render(canvas, opts) {
    const { lat, lon, date } = opts;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const u = Math.min(W, H) / 300; // scale unit (chart designed at 300px)
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 30 * u;

    // deep-sky background
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, "#0b1230");
    bg.addColorStop(0.7, "#070c20");
    bg.addColorStop(1, "#04060f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // horizon glow + rim (kept subtle)
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,150,80,0.16)";
    ctx.lineWidth = 4 * u;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(200,220,255,0.4)";
    ctx.lineWidth = 1.2 * u;
    ctx.stroke();

    const pt = (s) => {
      const { alt, az } = altAz(s.ra, s.dec, lat, lon, date);
      const r = ((90 - alt) / 90) * R;
      const a = (az * Math.PI) / 180;
      return { s, alt, x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
    };
    const visible = STARS.map(pt).filter((p) => p.alt > 0);
    const visSet = new Set(visible.map((p) => p.s.name));
    const inside = (x, y, margin) => Math.hypot(x - cx, y - cy) < R - margin;
    const collides = (placed, x, y, rad) =>
      placed.some((q) => Math.hypot(q[0] - x, q[1] - y) < rad);

    // constellation stick figures (both endpoints above the horizon)
    ctx.strokeStyle = "rgba(140,170,255,0.32)";
    ctx.lineWidth = 1 * u;
    for (const [a, b] of LINES) {
      if (!visSet.has(a) || !visSet.has(b)) continue;
      const pa = pt(byName[a]), pb = pt(byName[b]);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // stars, brightest first so dim ones layer underneath
    const byMag = [...visible].sort((p, q) => q.s.mag - p.s.mag);
    for (const p of byMag) {
      const size = Math.max(0.8 * u, (3.1 - p.s.mag * 0.5) * u);
      if (p.s.mag < 1) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 1.9, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200,215,255,0.12)";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = p.s.mag < 0.5 ? "#ffffff" : "rgba(232,238,255,0.92)";
      ctx.fill();
    }

    // labels for the ~12 brightest visible stars, skipping collisions and the rim
    const labeled = [];
    const placed = [];
    const LABEL_R = 24 * u, RIM_MARGIN = 20 * u;
    const bright = [...visible].sort((p, q) => p.s.mag - q.s.mag).slice(0, 12);
    ctx.font = `600 ${9.5 * u}px Inter, -apple-system, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const p of bright) {
      const lx = p.x + 6 * u, ly = p.y - 7 * u;
      if (!inside(lx, ly, RIM_MARGIN) || collides(placed, lx, ly, LABEL_R)) continue;
      placed.push([lx, ly]);
      ctx.fillStyle = "rgba(226,232,250,0.88)";
      ctx.fillText(p.s.name, lx, ly);
      labeled.push(p.s.name);
    }

    // constellation names: try a few offsets, take the first clear spot
    ctx.font = `700 ${8 * u}px Inter, -apple-system, sans-serif`;
    const NAME_R = 20 * u;
    for (const [label, anchor, dx, dy] of CONSTELLATIONS) {
      if (!visSet.has(anchor)) continue;
      const p = pt(byName[anchor]);
      const cands = [
        [p.x + dx * u, p.y + dy * u],
        [p.x - dx * u, p.y + dy * u],
        [p.x + dx * u, p.y - dy * u],
        [p.x, p.y + (dy + 16) * u],
      ];
      const spot = cands.find(([x, y]) => inside(x, y, RIM_MARGIN + 6 * u) && !collides(placed, x, y, NAME_R));
      if (!spot) continue;
      placed.push(spot);
      ctx.fillStyle = "rgba(150,170,220,0.55)";
      ctx.fillText(label.toUpperCase(), spot[0], spot[1]);
    }

    // cardinal points, just inside the rim so they never clip
    ctx.font = `700 ${10 * u}px Inter, -apple-system, sans-serif`;
    ctx.fillStyle = "rgba(200,210,235,0.75)";
    ctx.textAlign = "center";
    const ci = 13 * u;
    ctx.fillText("N", cx, cy - R + ci);
    ctx.fillText("S", cx, cy + R - ci);
    ctx.fillText("E", cx + R - ci, cy);
    ctx.fillText("W", cx - R + ci, cy);

    const top3 = [...visible].sort((p, q) => p.s.mag - q.s.mag).slice(0, 3).map((p) => p.s.name);
    return { visible: visible.length, labeled: labeled.length, top3 };
  }

  return {
    STARS, LINES, CONSTELLATIONS,
    julianDay, gmstDeg, altAz, zonedToUtc, tonightAt, project, render,
  };
});
