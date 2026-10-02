// ============ Batch Storyboard Image Generation Registry ============
// Holds the prompt registry and automation helper for generating the remaining
// 20 campaign chapter storyboard illustrations when image generation capacity is available.
// Each prompt adheres strictly to European comic bande dessinée lineart with gritty watercolor wash.

export const REMAINING_SCENE_PROMPTS = [
  // --- Chapter 5 STEEL ---
  {
    sceneId: 'ch5_steel_04',
    imageName: 'story_ch5_steel_04',
    refImage: 'public/assets/story/story_ch5_steel.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Mercenary pilot Lights Out standing atop a snow-covered high-voltage electrical transformer box on a Manhattan street corner, massive bright blue electrical arc lightning erupting as she severs cooling conduits, blowing fuses and causing a blackout across the snowy avenue.',
    targetPng: 'public/assets/story/story_ch5_steel_04.png',
  },
  {
    sceneId: 'ch5_steel_05',
    imageName: 'story_ch5_steel_05',
    refImage: 'public/assets/story/story_ch5_steel.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Heavy bipedal assault mech Cauldron violently breaching and smashing through massive reinforced bank vault blast doors of a server room, sheared metal flying, blizzard and wind howling into warm blinking blue server rack corridors.',
    targetPng: 'public/assets/story/story_ch5_steel_05.png',
  },

  // --- Chapter 5 SWARM ---
  {
    sceneId: 'ch5_swarm_01',
    imageName: 'story_ch5_swarm_01',
    refImage: 'public/assets/story/story_ch5_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. High-rise penthouse Manhattan server datacenter at night during quiet heavy snow, racks of humming computing modules glowing with calm green lights, a holographic draft of an automated ceasefire peace treaty hovering in the air, tranquil contrast with the dark blizzard outside.',
    targetPng: 'public/assets/story/story_ch5_swarm_01.png',
  },
  {
    sceneId: 'ch5_swarm_03',
    imageName: 'story_ch5_swarm_03',
    refImage: 'public/assets/story/story_ch5_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Female combat field medic Zofia Holy Candle in nun-inspired utilitarian tactical uniform with white cross insignia, tenderly operating medical suture drones and blood plasma canisters over a wounded mech pilot inside a snowy hallway, gentle compassionate expression.',
    targetPng: 'public/assets/story/story_ch5_swarm_03.png',
  },
  {
    sceneId: 'ch5_swarm_04',
    imageName: 'story_ch5_swarm_04',
    refImage: 'public/assets/story/story_ch5_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Transforming agile mercenary fighter mech Raven flying supersonic at low altitude along Manhattan Fifth Avenue in a snowstorm, deploying glowing silver radar-chaff foil clouds between skyscraper facades, disrupting enemy laser fire controls.',
    targetPng: 'public/assets/story/story_ch5_swarm_04.png',
  },
  {
    sceneId: 'ch5_swarm_05',
    imageName: 'story_ch5_swarm_05',
    refImage: 'public/assets/story/story_ch5_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Female commander Dirge standing resolute in front of the central server terminal in the breached datacenter, fingers poised over missile intercept launch console, snow blowing past the crumpled steel blast door, determined expression protecting the last seed of peace.',
    targetPng: 'public/assets/story/story_ch5_swarm_05.png',
  },

  // --- Chapter 6 STEEL ---
  {
    sceneId: 'ch6_steel_01',
    imageName: 'story_ch6_steel_01',
    refImage: 'public/assets/story/story_ch6_steel.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Wide establishing cinematic shot of Sevastopol fortress harbor on the Black Sea at dusk, historic white limestone fortresses, harbor docks, naval fleet with heavy diesel mechs disembarking, dark ominous sea and sky.',
    targetPng: 'public/assets/story/story_ch6_steel_01.png',
  },
  {
    sceneId: 'ch6_steel_03',
    imageName: 'story_ch6_steel_03',
    refImage: 'public/assets/story/story_ch6_steel.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Elite female GRU special operative sniper Grey Goose with cold ruthless calculating eyes, inside an amphibious stealth mech on a rocky limestone jetty, checking a digital hit list on her rifle optical visor, target name Queen Bee illuminated.',
    targetPng: 'public/assets/story/story_ch6_steel_03.png',
  },
  {
    sceneId: 'ch6_steel_04',
    imageName: 'story_ch6_steel_04',
    refImage: 'public/assets/story/story_ch6_steel.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Close-up intense character portrait of elderly Supreme Commander General Winter Valery Gromov, stark white hair, trench coat with medal ribbons over heavy power armor, stern weathered face, memories of his lost son reflecting in his intense sorrowful eyes.',
    targetPng: 'public/assets/story/story_ch6_steel_04.png',
  },
  {
    sceneId: 'ch6_steel_05',
    imageName: 'story_ch6_steel_05',
    refImage: 'public/assets/story/story_ch6_steel.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Two mercenary heavy mechs in action on the harbor breakwater: Brazilian mercenary Carnival launching a massive synchronized volley of guided micro-missiles from dual shoulder pods, alongside Mexican mercenary Boundary Marker locking massive alloy beetle wing shields into the stone seawall.',
    targetPng: 'public/assets/story/story_ch6_steel_05.png',
  },
  {
    sceneId: 'ch6_steel_06',
    imageName: 'story_ch6_steel_06',
    refImage: 'public/assets/story/story_ch6_steel.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. High-angle atmospheric shot: female stealth sniper Epilogue perched motionless atop a 100-meter-tall shipyard gantry crane in the night sky, thermal sniper rifle aimed down through smoke and fires towards the glowing Swarm hive hub in the dock basin.',
    targetPng: 'public/assets/story/story_ch6_steel_06.png',
  },
  {
    sceneId: 'ch6_steel_07',
    imageName: 'story_ch6_steel_07',
    refImage: 'public/assets/story/story_ch6_steel.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Dual split composition of General Winter and Queen Bee Kateryna Shevchenko gazing at each other across the smoky harbor channel, reflections of mutual grief and tragic mirror destiny, dramatic dark blue and amber lighting.',
    targetPng: 'public/assets/story/story_ch6_steel_07.png',
  },
  {
    sceneId: 'ch6_steel_08',
    imageName: 'story_ch6_steel_08',
    refImage: 'public/assets/story/story_ch6_steel.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Climax of Steel assault: General Winter raising his 152mm howitzer halberd, thousands of Pact heavy tanks and bipedal mechs firing in unison across the Black Sea harbor, massive explosive artillery barrage Avalanche shaking the fortress.',
    targetPng: 'public/assets/story/story_ch6_steel_08.png',
  },

  // --- Chapter 6 SWARM ---
  {
    sceneId: 'ch6_swarm_01',
    imageName: 'story_ch6_swarm_01',
    refImage: 'public/assets/story/story_ch6_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Wide cinematic sunset over Sevastopol harbor and industrial shipyard drydocks, the gigantic Queen Bee Hive matrix vibrating with amber light amid rusted gantry cranes, Swarm defense lines digging into coastal fortifications.',
    targetPng: 'public/assets/story/story_ch6_swarm_01.png',
  },
  {
    sceneId: 'ch6_swarm_03',
    imageName: 'story_ch6_swarm_03',
    refImage: 'public/assets/story/story_ch6_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Burly veteran Ukrainian mechanic Blacksmith welding a damaged six-rotor swarm drone under an industrial shipyard crane, blazing white arc torch, blistered scarred muscular forearms, sparks illuminating his fierce pride and dusty repair workshop.',
    targetPng: 'public/assets/story/story_ch6_swarm_03.png',
  },
  {
    sceneId: 'ch6_swarm_04',
    imageName: 'story_ch6_swarm_04',
    refImage: 'public/assets/story/story_ch6_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Desperate defense in the harbor docks: Steel artillery shells exploding along outer stone breakwaters, burning diesel floating on sea water, red warning beacons flashing in the shipyard as Swarm defenders fall back to the last drydock ring.',
    targetPng: 'public/assets/story/story_ch6_swarm_04.png',
  },
  {
    sceneId: 'ch6_swarm_05',
    imageName: 'story_ch6_swarm_05',
    refImage: 'public/assets/story/story_ch6_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Turkish mercenary Bulwark bracing a colossal heavy fortress tower shield against incoming armor-piercing shells at Drydock Gate 1, while Swiss mercenary Snowline hurriedly wheels mobile liquid-nitrogen coolant canisters to smoking drone racks under heavy fire.',
    targetPng: 'public/assets/story/story_ch6_swarm_05.png',
  },
  {
    sceneId: 'ch6_swarm_06',
    imageName: 'story_ch6_swarm_06',
    refImage: 'public/assets/story/story_ch6_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Stealth glider drone piloted by Mongolian mercenary Fog Walker skimming low over sea spray and rising harbor smoke, bionic falcon optics identifying subtle opening cycles on the Steel flagship radiator armor.',
    targetPng: 'public/assets/story/story_ch6_swarm_06.png',
  },
  {
    sceneId: 'ch6_swarm_07',
    imageName: 'story_ch6_swarm_07',
    refImage: 'public/assets/story/story_ch6_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Emotional dual perspective of Kateryna Shevchenko standing on the Queen Bee gantry and General Winter across the strait, shared grief of a grieving sister and grieving father, moonlight glinting on cold steel and rising sea mist.',
    targetPng: 'public/assets/story/story_ch6_swarm_07.png',
  },
  {
    sceneId: 'ch6_swarm_08',
    imageName: 'story_ch6_swarm_08',
    refImage: 'public/assets/story/story_ch6_swarm.png',
    prompt: 'Gritty watercolor and ink wash graphic novel illustration, European comic bande dessinée lineart, realistic proportion, sharp detailed ink outlines, rich dynamic watercolor splashes, battlefield smoke, dramatic high-contrast lighting. Epic final climax: Queen Bee conductor arm slashing down, a galaxy of tens of thousands of glowing micro-drones erupting into the night sky over the Black Sea, charging straight into the blazing cannon fire of the Pact steel avalanche.',
    targetPng: 'public/assets/story/story_ch6_swarm_08.png',
  },
];
