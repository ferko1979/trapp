/**
 * seedAllTraps.js
 * ──────────────────────────────────────────────────────────────
 * Seeds / updates all 6 trap definitions in Firestore and uploads
 * SVG artwork to Firebase Storage.
 *
 * Run from the functions/ directory:
 *   node scripts/seedAllTraps.js
 */

const admin  = require("firebase-admin");
const path   = require("path");

// ── Init ──────────────────────────────────────────────────────
const serviceAccount = require(path.resolve(__dirname, "../../serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId:  "playtrapnow",
});

const db = admin.firestore();

// ── SVG artwork ───────────────────────────────────────────────

/** Adult · Prank Zone – orange bomb with evil grin */
const SVG_PRANK_ZONE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="pz_bg" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#3d1000"/>
      <stop offset="100%" stop-color="#1a0500"/>
    </radialGradient>
    <radialGradient id="pz_bomb" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#4a4a4a"/>
      <stop offset="100%" stop-color="#1c1c1c"/>
    </radialGradient>
  </defs>
  <rect width="200" height="200" rx="24" fill="url(#pz_bg)"/>
  <!-- Outer orange ring -->
  <circle cx="100" cy="115" r="62" fill="none" stroke="#ff6b00" stroke-width="3" opacity="0.4"/>
  <!-- Bomb body -->
  <circle cx="100" cy="118" r="54" fill="url(#pz_bomb)" stroke="#ff6b00" stroke-width="2.5"/>
  <!-- Bomb shine -->
  <ellipse cx="80" cy="97" rx="16" ry="10" fill="rgba(255,255,255,0.12)" transform="rotate(-25,80,97)"/>
  <!-- Fuse rope -->
  <path d="M100 64 C105 52 120 44 128 34" stroke="#a0522d" stroke-width="5"
        fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Fuse spark -->
  <circle cx="128" cy="34" r="7" fill="#ff6b00" opacity="0.9"/>
  <circle cx="128" cy="34" r="11" fill="#ffcc00" opacity="0.4"/>
  <!-- Left eye -->
  <ellipse cx="82" cy="112" rx="9" ry="10" fill="#ff6b00"/>
  <ellipse cx="84" cy="110" rx="3" ry="4" fill="#1c1c1c"/>
  <!-- Right eye -->
  <ellipse cx="118" cy="112" rx="9" ry="10" fill="#ff6b00"/>
  <ellipse cx="120" cy="110" rx="3" ry="4" fill="#1c1c1c"/>
  <!-- Evil eyebrows -->
  <path d="M73 102 L92 107" stroke="#ff6b00" stroke-width="3" stroke-linecap="round"/>
  <path d="M108 107 L127 102" stroke="#ff6b00" stroke-width="3" stroke-linecap="round"/>
  <!-- Evil grin -->
  <path d="M72 130 Q100 152 128 130" stroke="#ff6b00" stroke-width="3.5"
        fill="none" stroke-linecap="round"/>
  <!-- Teeth -->
  <line x1="84" y1="131" x2="84" y2="140" stroke="#ff6b00" stroke-width="2.5"/>
  <line x1="93" y1="134" x2="93" y2="144" stroke="#ff6b00" stroke-width="2.5"/>
  <line x1="107" y1="134" x2="107" y2="144" stroke="#ff6b00" stroke-width="2.5"/>
  <line x1="116" y1="131" x2="116" y2="140" stroke="#ff6b00" stroke-width="2.5"/>
  <!-- HA HA text -->
  <text x="100" y="26" text-anchor="middle" font-family="Arial Black, sans-serif"
        font-weight="900" font-size="13" fill="#ff6b00" letter-spacing="2">HA HA!</text>
</svg>`;

/** Adult · Shadow Snare – silver bear trap with red glow */
const SVG_SHADOW_SNARE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="ss_bg" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#12002e"/>
      <stop offset="100%" stop-color="#05000f"/>
    </radialGradient>
    <radialGradient id="ss_glow" cx="50%" cy="60%" r="50%">
      <stop offset="0%" stop-color="#ff000033"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <linearGradient id="ss_metal" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e8e8e8"/>
      <stop offset="50%" stop-color="#a8a8a8"/>
      <stop offset="100%" stop-color="#d0d0d0"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="24" fill="url(#ss_bg)"/>
  <rect width="200" height="200" rx="24" fill="url(#ss_glow)"/>
  <!-- Ground shadow mist -->
  <ellipse cx="100" cy="155" rx="70" ry="12" fill="#ff000022"/>
  <!-- Bear trap – lower jaw -->
  <path d="M36 125 Q100 145 164 125 L164 138 Q100 162 36 138 Z"
        fill="url(#ss_metal)" stroke="#888" stroke-width="1.5"/>
  <!-- Lower teeth -->
  <path d="M50 128 L55 142 M65 131 L70 146 M80 133 L85 148 M95 134 L100 149
           M115 134 L120 149 M130 133 L135 148 M145 131 L150 146"
        stroke="#888" stroke-width="3" stroke-linecap="round"/>
  <!-- Bear trap – upper jaw (open) -->
  <path d="M36 75 Q100 55 164 75 L164 88 Q100 72 36 88 Z"
        fill="url(#ss_metal)" stroke="#888" stroke-width="1.5"/>
  <!-- Upper teeth -->
  <path d="M50 85 L55 71 M65 82 L70 68 M80 80 L85 66 M95 79 L100 65
           M115 79 L120 65 M130 80 L135 66 M145 82 L150 68"
        stroke="#888" stroke-width="3" stroke-linecap="round"/>
  <!-- Center spring -->
  <rect x="88" y="88" width="24" height="37" rx="4" fill="#777" stroke="#555" stroke-width="1.5"/>
  <line x1="100" y1="88" x2="100" y2="125" stroke="#555" stroke-width="2.5"/>
  <!-- Trigger plate (red glow) -->
  <ellipse cx="100" cy="106" rx="14" ry="8" fill="#cc0000" opacity="0.9"/>
  <ellipse cx="100" cy="106" rx="14" ry="8" fill="none" stroke="#ff4444" stroke-width="1.5"/>
  <!-- Chain links -->
  <path d="M100 162 Q100 175 100 185" stroke="#888" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="100" cy="178" rx="8" ry="5" fill="none" stroke="#888" stroke-width="3"/>
  <!-- "SNARE" label -->
  <text x="100" y="22" text-anchor="middle" font-family="Arial Black, sans-serif"
        font-weight="900" font-size="11" fill="#9b59b6" letter-spacing="3">SHADOW SNARE</text>
</svg>`;

/** Adult · Iron Cage – steel bars with red danger glow */
const SVG_IRON_CAGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="ic_bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a1a1a"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
    <linearGradient id="ic_bar" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#707070"/>
      <stop offset="40%" stop-color="#b0b0b0"/>
      <stop offset="100%" stop-color="#606060"/>
    </linearGradient>
    <radialGradient id="ic_glow" cx="50%" cy="50%" r="45%">
      <stop offset="0%" stop-color="#cc000033"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="200" height="200" rx="24" fill="url(#ic_bg)"/>
  <rect width="200" height="200" rx="24" fill="url(#ic_glow)"/>
  <!-- Top bar -->
  <rect x="28" y="38" width="144" height="10" rx="5" fill="url(#ic_bar)" stroke="#444" stroke-width="1"/>
  <!-- Bottom bar -->
  <rect x="28" y="158" width="144" height="10" rx="5" fill="url(#ic_bar)" stroke="#444" stroke-width="1"/>
  <!-- Vertical bars -->
  <rect x="34"  y="38" width="10" height="130" rx="5" fill="url(#ic_bar)" stroke="#555" stroke-width="0.5"/>
  <rect x="58"  y="38" width="10" height="130" rx="5" fill="url(#ic_bar)" stroke="#555" stroke-width="0.5"/>
  <rect x="82"  y="38" width="10" height="130" rx="5" fill="url(#ic_bar)" stroke="#555" stroke-width="0.5"/>
  <rect x="106" y="38" width="10" height="130" rx="5" fill="url(#ic_bar)" stroke="#555" stroke-width="0.5"/>
  <rect x="130" y="38" width="10" height="130" rx="5" fill="url(#ic_bar)" stroke="#555" stroke-width="0.5"/>
  <rect x="156" y="38" width="10" height="130" rx="5" fill="url(#ic_bar)" stroke="#555" stroke-width="0.5"/>
  <!-- Middle cross bar -->
  <rect x="28" y="96" width="144" height="8" rx="4" fill="url(#ic_bar)" stroke="#444" stroke-width="1"/>
  <!-- Padlock body -->
  <rect x="80" y="72" width="40" height="34" rx="6" fill="#555" stroke="#cc0000" stroke-width="2.5"/>
  <!-- Padlock shine -->
  <rect x="85" y="77" width="12" height="8" rx="3" fill="rgba(255,255,255,0.15)"/>
  <!-- Padlock shackle -->
  <path d="M88 72 Q88 56 100 56 Q112 56 112 72" fill="none" stroke="#cc0000" stroke-width="5"
        stroke-linecap="round"/>
  <!-- Keyhole -->
  <circle cx="100" cy="85" r="5" fill="#1a1a1a"/>
  <rect x="97" y="85" width="6" height="10" rx="3" fill="#1a1a1a"/>
  <!-- Red corner glow sparks -->
  <circle cx="34"  cy="43"  r="4" fill="#cc0000" opacity="0.6"/>
  <circle cx="166" cy="43"  r="4" fill="#cc0000" opacity="0.6"/>
  <circle cx="34"  cy="163" r="4" fill="#cc0000" opacity="0.6"/>
  <circle cx="166" cy="163" r="4" fill="#cc0000" opacity="0.6"/>
  <!-- "IRON CAGE" label -->
  <text x="100" y="24" text-anchor="middle" font-family="Arial Black, sans-serif"
        font-weight="900" font-size="11" fill="#888" letter-spacing="3">IRON CAGE</text>
</svg>`;

/** Kids · Silly Spider – cute cartoon spider on pink */
const SVG_SILLY_SPIDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="sp_bg" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#ffb3d9"/>
      <stop offset="100%" stop-color="#ff69b4"/>
    </radialGradient>
    <radialGradient id="sp_body" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#9b59b6"/>
      <stop offset="100%" stop-color="#6c3483"/>
    </radialGradient>
  </defs>
  <rect width="200" height="200" rx="24" fill="url(#sp_bg)"/>
  <!-- Stars / sparkles -->
  <text x="22"  y="38"  font-size="18" text-anchor="middle">⭐</text>
  <text x="175" y="45"  font-size="14" text-anchor="middle">✨</text>
  <text x="30"  y="165" font-size="12" text-anchor="middle">✨</text>
  <text x="172" y="170" font-size="16" text-anchor="middle">⭐</text>
  <!-- Web thread from top -->
  <line x1="100" y1="0" x2="100" y2="46" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>
  <!-- Legs – left side (drawn behind body) -->
  <path d="M62 90 Q40 74 22 62" stroke="#6c3483" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M60 102 Q36 100 14 98" stroke="#6c3483" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M62 114 Q38 120 22 134" stroke="#6c3483" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M68 124 Q50 142 42 158" stroke="#6c3483" stroke-width="5" fill="none" stroke-linecap="round"/>
  <!-- Legs – right side -->
  <path d="M138 90 Q160 74 178 62" stroke="#6c3483" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M140 102 Q164 100 186 98" stroke="#6c3483" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M138 114 Q162 120 178 134" stroke="#6c3483" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M132 124 Q150 142 158 158" stroke="#6c3483" stroke-width="5" fill="none" stroke-linecap="round"/>
  <!-- Body circle -->
  <circle cx="100" cy="108" r="54" fill="url(#sp_body)" stroke="#ff69b4" stroke-width="3"/>
  <!-- Body shine -->
  <ellipse cx="82" cy="86" rx="18" ry="11" fill="rgba(255,255,255,0.18)" transform="rotate(-20,82,86)"/>
  <!-- Left eye white -->
  <circle cx="80" cy="100" r="15" fill="white"/>
  <!-- Right eye white -->
  <circle cx="120" cy="100" r="15" fill="white"/>
  <!-- Left eye pupil -->
  <circle cx="82" cy="101" r="8" fill="#1a0a2e"/>
  <circle cx="84" cy="99"  r="3" fill="white"/>
  <!-- Right eye pupil -->
  <circle cx="122" cy="101" r="8" fill="#1a0a2e"/>
  <circle cx="124" cy="99"  r="3" fill="white"/>
  <!-- Big happy smile -->
  <path d="M74 120 Q100 142 126 120" stroke="#ff69b4" stroke-width="4"
        fill="none" stroke-linecap="round"/>
  <!-- Cheeks -->
  <ellipse cx="68"  cy="116" rx="10" ry="7" fill="#ff9ec4" opacity="0.6"/>
  <ellipse cx="132" cy="116" rx="10" ry="7" fill="#ff9ec4" opacity="0.6"/>
  <!-- "SILLY SPIDER" label -->
  <text x="100" y="190" text-anchor="middle" font-family="Arial Rounded MT Bold, Arial, sans-serif"
        font-weight="bold" font-size="11" fill="#6c3483">SILLY SPIDER</text>
</svg>`;

/** Kids · Bubble Trap – colorful soap bubbles on sky blue */
const SVG_BUBBLE_TRAP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="bt_bg" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#b3e5fc"/>
      <stop offset="100%" stop-color="#4fc3f7"/>
    </radialGradient>
  </defs>
  <rect width="200" height="200" rx="24" fill="url(#bt_bg)"/>
  <!-- Big center bubble -->
  <circle cx="100" cy="100" r="52" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.7)" stroke-width="2.5"/>
  <ellipse cx="82" cy="80" rx="16" ry="10" fill="rgba(255,255,255,0.35)" transform="rotate(-30,82,80)"/>
  <!-- Top-left bubble – pink -->
  <circle cx="52" cy="62" r="30" fill="rgba(255,150,200,0.22)" stroke="rgba(255,100,180,0.6)" stroke-width="2"/>
  <ellipse cx="43" cy="52" rx="8" ry="5" fill="rgba(255,255,255,0.3)" transform="rotate(-20,43,52)"/>
  <!-- Bottom-right bubble – yellow -->
  <circle cx="150" cy="148" r="34" fill="rgba(255,230,80,0.22)" stroke="rgba(255,200,0,0.6)" stroke-width="2"/>
  <ellipse cx="138" cy="137" rx="10" ry="6" fill="rgba(255,255,255,0.3)" transform="rotate(-25,138,137)"/>
  <!-- Top-right bubble – green -->
  <circle cx="158" cy="58" r="24" fill="rgba(100,230,100,0.22)" stroke="rgba(50,200,50,0.6)" stroke-width="2"/>
  <ellipse cx="149" cy="49" rx="7" ry="4" fill="rgba(255,255,255,0.3)" transform="rotate(-25,149,49)"/>
  <!-- Bottom-left bubble – purple -->
  <circle cx="46" cy="152" r="26" fill="rgba(180,100,255,0.22)" stroke="rgba(150,50,255,0.6)" stroke-width="2"/>
  <ellipse cx="37" cy="141" rx="8" ry="5" fill="rgba(255,255,255,0.3)" transform="rotate(-25,37,141)"/>
  <!-- Small accent bubbles -->
  <circle cx="130" cy="42" r="12" fill="rgba(255,180,80,0.25)" stroke="rgba(255,150,0,0.5)" stroke-width="1.5"/>
  <circle cx="30"  cy="110" r="10" fill="rgba(100,200,255,0.25)" stroke="rgba(0,150,255,0.5)" stroke-width="1.5"/>
  <circle cx="170" cy="110" r="8"  fill="rgba(255,100,200,0.25)" stroke="rgba(200,0,150,0.5)" stroke-width="1.5"/>
  <!-- Stars -->
  <text x="100" y="108" text-anchor="middle" font-size="34">🫧</text>
  <!-- Sparkle dots -->
  <circle cx="100" cy="20" r="4" fill="white" opacity="0.8"/>
  <circle cx="120" cy="28" r="3" fill="white" opacity="0.6"/>
  <circle cx="80"  cy="26" r="3" fill="white" opacity="0.6"/>
  <!-- Label -->
  <text x="100" y="190" text-anchor="middle" font-family="Arial Rounded MT Bold, Arial, sans-serif"
        font-weight="bold" font-size="11" fill="#0277bd">BUBBLE TRAP</text>
</svg>`;

/** Kids · Rainbow Freeze – ice snowflake with rainbow */
const SVG_RAINBOW_FREEZE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="rf_bg" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#e8f5ff"/>
      <stop offset="100%" stop-color="#b3d9ff"/>
    </radialGradient>
    <linearGradient id="rf_crystal" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#aef0ff"/>
      <stop offset="100%" stop-color="#7fdbff"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="24" fill="url(#rf_bg)"/>
  <!-- Rainbow arc -->
  <path d="M30 130 Q100 30 170 130" fill="none" stroke="#e74c3c" stroke-width="7" opacity="0.9"/>
  <path d="M36 133 Q100 40 164 133" fill="none" stroke="#e67e22" stroke-width="7" opacity="0.9"/>
  <path d="M42 136 Q100 50 158 136" fill="none" stroke="#f1c40f" stroke-width="7" opacity="0.9"/>
  <path d="M48 139 Q100 60 152 139" fill="none" stroke="#2ecc71" stroke-width="7" opacity="0.9"/>
  <path d="M54 142 Q100 70 146 142" fill="none" stroke="#3498db" stroke-width="7" opacity="0.9"/>
  <path d="M60 145 Q100 80 140 145" fill="none" stroke="#9b59b6" stroke-width="7" opacity="0.9"/>
  <!-- Snowflake / ice crystal center -->
  <!-- Spokes -->
  <line x1="100" y1="65" x2="100" y2="155" stroke="url(#rf_crystal)" stroke-width="5" stroke-linecap="round"/>
  <line x1="60"  y1="76" x2="140" y2="144" stroke="url(#rf_crystal)" stroke-width="5" stroke-linecap="round"/>
  <line x1="60"  y1="144" x2="140" y2="76" stroke="url(#rf_crystal)" stroke-width="5" stroke-linecap="round"/>
  <!-- Diagonal spokes -->
  <line x1="55"  y1="110" x2="145" y2="110" stroke="url(#rf_crystal)" stroke-width="4" stroke-linecap="round"/>
  <line x1="65"  y1="80"  x2="135" y2="140" stroke="url(#rf_crystal)" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
  <line x1="135" y1="80"  x2="65"  y2="140" stroke="url(#rf_crystal)" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
  <!-- Ice sparkle nodes -->
  <circle cx="100" cy="65"  r="6" fill="white" stroke="#7fdbff" stroke-width="2"/>
  <circle cx="100" cy="155" r="6" fill="white" stroke="#7fdbff" stroke-width="2"/>
  <circle cx="60"  cy="76"  r="5" fill="white" stroke="#7fdbff" stroke-width="2"/>
  <circle cx="140" cy="144" r="5" fill="white" stroke="#7fdbff" stroke-width="2"/>
  <circle cx="60"  cy="144" r="5" fill="white" stroke="#7fdbff" stroke-width="2"/>
  <circle cx="140" cy="76"  r="5" fill="white" stroke="#7fdbff" stroke-width="2"/>
  <circle cx="55"  cy="110" r="5" fill="white" stroke="#7fdbff" stroke-width="2"/>
  <circle cx="145" cy="110" r="5" fill="white" stroke="#7fdbff" stroke-width="2"/>
  <!-- Center gem -->
  <circle cx="100" cy="110" r="14" fill="white" stroke="#aef0ff" stroke-width="2.5"/>
  <circle cx="100" cy="110" r="8"  fill="url(#rf_crystal)"/>
  <circle cx="96"  cy="107" r="3"  fill="white" opacity="0.7"/>
  <!-- Floating ice dots -->
  <circle cx="25"  cy="60"  r="5" fill="rgba(127,219,255,0.6)"/>
  <circle cx="175" cy="70"  r="4" fill="rgba(174,240,255,0.6)"/>
  <circle cx="30"  cy="155" r="3" fill="rgba(127,219,255,0.5)"/>
  <circle cx="172" cy="150" r="4" fill="rgba(174,240,255,0.5)"/>
  <!-- Label -->
  <text x="100" y="20" text-anchor="middle" font-family="Arial Rounded MT Bold, Arial, sans-serif"
        font-weight="bold" font-size="11" fill="#2980b9">RAINBOW FREEZE</text>
</svg>`;

// ── Trap definitions ──────────────────────────────────────────

const TRAPS = [
  // ──────────── ADULT TRAPS ────────────
  {
    id:   "fun_laughter",
    svg:  SVG_PRANK_ZONE,
    data: {
      name:     "Prank Trap",
      names:    {
        en: "Prank Trap",
        hu: "Tréfacsapda",
        de: "Streich-Falle",
        hr: "Zamka Šale",
        ro: "Capcana Farsă",
        sk: "Žartovná Pasca",
      },
      description:  "Drop a laugh-bomb at your feet – any nearby adult opponent suddenly can't stop giggling!",
      descriptions: {
        en: "Drop a laugh-bomb at your feet – any nearby adult opponent suddenly can't stop giggling!",
        hu: "Dobj le egy nevetésbombát! A közelben lévő felnőtt ellenfél hirtelen nevetési rohamot kap!",
        de: "Platziere eine Lachbombe. Jeder erwachsene Gegner in der Nähe muss plötzlich loslachen!",
        hr: "Postavi bombu smijeha. Svaki odrasli protivnik u blizini iznenada se ne može prestati smijati!",
        ro: "Lasă o bombă de râs. Orice adversar adult din apropiere va râde necontrolat!",
        sk: "Polož smiechovú bombu. Každý dospelý súper v blízkosti sa náhle nezastaví od smiechu!",
      },
      iconKey:   "trap_fun_laughter",
      soundKey:  "prank_zone",
      emoji:     "😈",
      enabled:   true,
      radiusMeters:         20,
      placementHoldSeconds: 60,    // 1 minute to place
      revealHoldSeconds:    3,
      disarmHoldSeconds:    45,    // 45 seconds to disarm
      effectKind:  "laughter",
      effectValue: 1,
      ownerCanTrigger: true,
      visibility:  "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 2,
      weight:      1,
      allowedAgeGroups: ["adult"],
    },
  },
  {
    id:   "timeout_small",
    svg:  SVG_SHADOW_SNARE,
    data: {
      name:     "Shadow Snare Trap",
      names:    {
        en: "Shadow Snare Trap",
        hu: "Árnyékcsapda",
        de: "Schatten-Fangeisen",
        hr: "Sjenčana Zamka",
        ro: "Capcana Umbrei",
        sk: "Tieňová Pasca",
      },
      description:  "A hidden metal snare snaps shut – the adult target is frozen for 15 minutes!",
      descriptions: {
        en: "A hidden metal snare snaps shut – the adult target is frozen for 15 minutes!",
        hu: "A rejtett csapda becsapódik! A felnőtt célpont 15 percre mozdítatlan marad.",
        de: "Eine versteckte Metallfalle schnappt zu! Das erwachsene Ziel ist 15 Minuten lang eingefroren.",
        hr: "Skrivena metalna zamka se zatvara! Odrasli cilj je 15 minuta zamrznut.",
        ro: "O capcană metalică ascunsă se închide! Ținta adultă este înghețată timp de 15 minute.",
        sk: "Skrytá kovová pasca sa zatvára! Dospelý cieľ je 15 minút zmrazený.",
      },
      iconKey:   "trap_timeout_small",
      soundKey:  "shadow_snare",
      emoji:     "🪤",
      enabled:   true,
      radiusMeters:         25,
      placementHoldSeconds: 180,   // 3 minutes to place
      revealHoldSeconds:    3,
      disarmHoldSeconds:    150,   // 2 min 30 sec to disarm
      effectKind:  "timeout",
      effectValue: 900,            // 15-minute freeze
      ownerCanTrigger: true,
      visibility:  "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 1,
      weight:      1,
      allowedAgeGroups: ["adult"],
    },
  },
  {
    id:   "timeout_major",
    svg:  SVG_IRON_CAGE,
    data: {
      name:     "Iron Cage Trap",
      names:    {
        en: "Iron Cage Trap",
        hu: "Vasketrec Csapda",
        de: "Eisenkäfig-Falle",
        hr: "Zamka Željeznog Kaveza",
        ro: "Capcana Cuştii de Fier",
        sk: "Pasca Železnej Klietky",
      },
      description:  "The ultimate adult trap. Locks an opponent inside an iron cage for 3 full hours!",
      descriptions: {
        en: "The ultimate adult trap. Locks an opponent inside an iron cage for 3 full hours!",
        hu: "A legtökéletesebb felnőtt csapda. Három órára zárja be az ellenfelet egy vasketrecbe!",
        de: "Die ultimative Falle für Erwachsene. Sperrt einen Gegner für 3 Stunden in einen Eisenkäfig!",
        hr: "Ultimativna zamka za odrasle. Zaključava protivnika u željezni kavez na 3 sata!",
        ro: "Capcana supremă pentru adulți. Blochează adversarul în cușca de fier timp de 3 ore!",
        sk: "Ultimátna pasca pre dospelých. Uzamkne súpera do železnej klietky na 3 hodiny!",
      },
      iconKey:   "trap_timeout_major",
      soundKey:  "iron_cage",
      emoji:     "⛓️",
      enabled:   true,
      radiusMeters:         30,
      placementHoldSeconds: 600,   // 10 minutes to place
      revealHoldSeconds:    5,
      disarmHoldSeconds:    480,   // 8 minutes to disarm
      effectKind:  "timeout",
      effectValue: 10800,          // 3-hour freeze
      ownerCanTrigger: true,
      visibility:  "public-after-reveal",
      refillHours: 48,
      maxBagSlots: 1,
      weight:      2,
      allowedAgeGroups: ["adult"],
    },
  },

  // ──────────── KIDS TRAPS (under 18 only) ────────────
  {
    id:   "silly_spider",
    svg:  SVG_SILLY_SPIDER,
    data: {
      name:     "Silly Spider Trap",
      names:    {
        en: "Silly Spider Trap",
        hu: "Bolond Pók Csapda",
        de: "Lustige Spinnen-Falle",
        hr: "Zamka Lude Pauke",
        ro: "Capcana Păianjenului Amuzant",
        sk: "Pasca Bláznivého Pavúka",
      },
      description:  "A sneaky cartoon spider drops from above – the target bursts into unstoppable giggles!",
      descriptions: {
        en: "A sneaky cartoon spider drops from above – the target bursts into unstoppable giggles!",
        hu: "Egy sunyi rajzfilm-pók esik le felülről – a célpont azonnal megállíthatatlan nevetési rohamot kap!",
        de: "Eine schlaue Comic-Spinne fällt von oben herab – das Ziel muss unkontrolliert kichern!",
        hr: "Lukava crtana pauka pada odozgo – cilj ne može prestati smijati se!",
        ro: "Un păianjen desenat cade de sus – adversarul izbucnește în hohote de râs!",
        sk: "Prefíkaný kreslenský pavúk padá zhora – cieľ sa rozosmieva do záchvatu smiechu!",
      },
      iconKey:   "trap_silly_spider",
      soundKey:  "silly_spider",
      emoji:     "🕷️",
      enabled:   true,
      radiusMeters:         15,
      placementHoldSeconds: 60,    // mirrors Prank Trap
      revealHoldSeconds:    2,
      disarmHoldSeconds:    45,
      effectKind:  "laughter",
      effectValue: 1,
      ownerCanTrigger: true,
      visibility:  "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 2,
      weight:      1,
      allowedAgeGroups: ["minor"],
    },
  },
  {
    id:   "bubble_trap",
    svg:  SVG_BUBBLE_TRAP,
    data: {
      name:     "Bubble Trap",
      names:    {
        en: "Bubble Trap",
        hu: "Buborékcsapda",
        de: "Blasen-Falle",
        hr: "Mjehurasta Zamka",
        ro: "Capcana cu Bule",
        sk: "Bublinová Pasca",
      },
      description:  "Pops a magical soap bubble around a young player – they're stuck inside for 30 seconds!",
      descriptions: {
        en: "Pops a magical soap bubble around a young player – they're stuck inside for 30 seconds!",
        hu: "Varázslatos szappanbuborékba zárja a fiatal játékost – 30 másodpercig nem tud kilépni!",
        de: "Umhüllt einen jungen Spieler mit einer magischen Seifenblase – 30 Sekunden gefangen!",
        hr: "Obavitak malog igrača u čarobni mjehurić – 30 sekundi ne može izaći!",
        ro: "Înconjoară un jucător tânăr cu o bulă de săpun magică – 30 de secunde blocat!",
        sk: "Uzavrie mladého hráča do čarovnej mydlovej bubliny – 30 sekúnd uväznený!",
      },
      iconKey:   "trap_bubble_trap",
      soundKey:  "bubble_trap",
      emoji:     "🫧",
      enabled:   true,
      radiusMeters:         18,
      placementHoldSeconds: 180,   // mirrors Shadow Snare Trap
      revealHoldSeconds:    2,
      disarmHoldSeconds:    150,
      effectKind:  "timeout",
      effectValue: 30,             // 30-second freeze (kid-friendly)
      ownerCanTrigger: true,
      visibility:  "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 2,
      weight:      1,
      allowedAgeGroups: ["minor"],
    },
  },
  {
    id:   "rainbow_freeze",
    svg:  SVG_RAINBOW_FREEZE,
    data: {
      name:     "Rainbow Freeze Trap",
      names:    {
        en: "Rainbow Freeze Trap",
        hu: "Szivárványos Fagyasztó Csapda",
        de: "Regenbogen-Eis-Falle",
        hr: "Zamka Duga Smrzavača",
        ro: "Capcana Înghețului Curcubeu",
        sk: "Pasca Dúhového Ľadu",
      },
      description:  "Blast the area with magical rainbow ice – a young opponent is frozen for 45 seconds!",
      descriptions: {
        en: "Blast the area with magical rainbow ice – a young opponent is frozen for 45 seconds!",
        hu: "Varázslatos szivárványjéggel zárja be a területet – a fiatal ellenfél 45 másodpercig fagyva marad!",
        de: "Besprühe die Umgebung mit magischem Regenbogeneis – ein junger Gegner ist 45 Sekunden eingefroren!",
        hr: "Zaslijepi područje čarobnim ledom duge – mladi protivnik je 45 sekundi zamrznut!",
        ro: "Acoperă zona cu gheață curcubeu magică – adversarul tânăr este înghețat 45 de secunde!",
        sk: "Zastreľ oblasť čarovným dúhovým ľadom – mladý súper je zmrazený na 45 sekúnd!",
      },
      iconKey:   "trap_rainbow_freeze",
      soundKey:  "rainbow_freeze",
      emoji:     "🌈",
      enabled:   true,
      radiusMeters:         20,
      placementHoldSeconds: 600,   // mirrors Iron Cage Trap
      revealHoldSeconds:    3,
      disarmHoldSeconds:    480,
      effectKind:  "timeout",
      effectValue: 45,             // 45-second freeze (kid-friendly)
      ownerCanTrigger: true,
      visibility:  "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 1,
      weight:      1,
      allowedAgeGroups: ["minor"],
    },
  },
];

// ── SVG → data URI ────────────────────────────────────────────

function svgToDataUri(svgContent) {
  // base64-encode for compact, Coil-compatible data URI
  return "data:image/svg+xml;base64," + Buffer.from(svgContent, "utf8").toString("base64");
}

// ── Seed ─────────────────────────────────────────────────────

// ── Translation keys for each locale ─────────────────────────
// Key format mirrors gameplay.ts: trap_{id}_name / trap_{id}_desc
// These land in app_translations/{locale}/strings so the admin
// translation UI can manage them, and the backend prefers them.

const LOCALES = ["en", "hu", "de", "hr", "ro", "sk"];

function buildTrapTranslationKeys() {
  // locale → { trap_{id}_name: "...", trap_{id}_desc: "..." }
  const byLocale = {};
  for (const locale of LOCALES) {
    byLocale[locale] = {};
  }

  for (const trap of TRAPS) {
    const { id, data } = trap;

    // Name translations
    if (data.names) {
      for (const locale of LOCALES) {
        const val = data.names[locale] ?? data.names["en"] ?? data.name;
        if (val) byLocale[locale][`trap_${id}_name`] = val;
      }
    } else if (data.name) {
      for (const locale of LOCALES) {
        byLocale[locale][`trap_${id}_name`] = data.name;
      }
    }

    // Description translations
    if (data.descriptions) {
      for (const locale of LOCALES) {
        const val = data.descriptions[locale] ?? data.descriptions["en"] ?? data.description ?? "";
        if (val) byLocale[locale][`trap_${id}_desc`] = val;
      }
    } else if (data.description) {
      for (const locale of LOCALES) {
        byLocale[locale][`trap_${id}_desc`] = data.description;
      }
    }
  }

  return byLocale;
}

async function seedTrapTranslations() {
  console.log("\n── Seeding app_translations with trap strings ───────────────");
  const byLocale = buildTrapTranslationKeys();
  const now = Date.now();

  for (const locale of LOCALES) {
    const updates = {};
    const keys = byLocale[locale];
    for (const [key, val] of Object.entries(keys)) {
      updates[`strings.${key}`] = val;
    }
    updates["updatedAt"]        = admin.firestore.FieldValue.serverTimestamp();
    updates["updatedAtEpochMs"] = now;

    const ref = db.collection("app_translations").doc(locale);
    const snap = await ref.get();
    if (snap.exists) {
      // Merge trap keys into existing strings without overwriting other keys
      await ref.update(updates);
    } else {
      // Document doesn't exist yet — create it with just the trap keys
      await ref.set({
        locale,
        strings: byLocale[locale],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtEpochMs: now,
      });
    }

    const keyCount = Object.keys(keys).length;
    console.log(`  [${locale}] ✓ ${keyCount} trap keys merged into app_translations`);
  }
}

async function seed() {
  const batch = db.batch();

  for (const trap of TRAPS) {
    console.log(`\n[${trap.id}] Seeding "${trap.data.name}"...`);
    const imageUrl = svgToDataUri(trap.svg);
    const ref = db.collection("trap_definitions").doc(trap.id);
    batch.set(ref, {
      ...trap.data,
      imageUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  ✓ imageUrl: data URI (${Math.round(imageUrl.length / 1024)} KB)`);
    console.log(`  ✓ Firestore queued`);
  }

  await batch.commit();
  console.log("\n✅  All 6 trap definitions saved to Firestore.");
  console.log("\nTimings summary:");
  console.log("  Adult traps:");
  console.log("    Prank Trap        – place 60s  · disarm  45s · laughter stun");
  console.log("    Shadow Snare Trap – place 180s · disarm 150s · 15 min freeze (900s)");
  console.log("    Iron Cage Trap    – place 600s · disarm 480s · 3 h freeze (10800s)");
  console.log("  Kids traps (minor only):");
  console.log("    Silly Spider Trap   – place  60s · disarm  45s · laughter stun");
  console.log("    Bubble Trap         – place 180s · disarm 150s · 30s freeze");
  console.log("    Rainbow Freeze Trap – place 600s · disarm 480s · 45s freeze");

  await seedTrapTranslations();

  console.log("\n✅  Done. Trap names/descriptions are now in app_translations for all 6 locales.");
  console.log("    Keys: trap_{id}_name  /  trap_{id}_desc");
  console.log("    Manage via: Admin → Translations UI");
  process.exit(0);
}

seed().catch((err) => { console.error(err); process.exit(1); });
