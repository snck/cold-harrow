/* Coldharrow Traverse — course, places, food and text. Pure data. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrailCourse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RACE_NAME = 'The Coldharrow Traverse';
  const START_CLOCK = 0; // midnight, Friday night into Saturday

  // [km, elevation m]
  const PROFILE = [
    [0, 380], [1.5, 420], [3, 460], [4.5, 640], [6, 820], [7.2, 1000], [8.5, 1180], [9.2, 1210], [10, 1220],
    [11.5, 1000], [13, 820], [14, 690],
    [15.5, 670], [17, 610], [18, 640], [19, 600], [20.5, 660], [22, 590], [24, 520],
    [26, 760], [27.5, 940], [29, 1150], [30.5, 1420], [32, 1680], [33, 1820],
    [34.5, 1950], [35.5, 1880], [37, 2060], [38, 2140],
    [39.5, 1940], [41, 1750],
    [42.5, 1520], [44, 1270], [46, 1050], [48, 880], [50, 700], [52, 560],
    [53.5, 600], [55, 580], [57, 640], [58.5, 700], [60, 660], [62, 720],
    [64, 880], [66, 1060], [68, 1250], [70, 1460], [72, 1640], [73.5, 1560], [74.5, 1610], [76, 1450],
    [78, 1150], [80, 900], [81, 800], [83, 700], [84, 650], [85, 640],
    [86.5, 820], [88, 1010], [88.6, 975], [90, 1180], [90.4, 1150], [91, 1260], [92, 1250], [93, 1290],
    [95, 980], [97, 640], [98, 480], [100, 380]
  ];

  // kind: climb | descent | runnable | ridge
  const SECTIONS = [
    { id: 'lanes', name: 'Lowmere Lanes', from: 0, to: 3, kind: 'runnable', tech: 0.1, exposed: 0.2, forest: 0.3,
      text: 'A hundred and forty headlamps funnel out of the square under bunting and cowbells. Tarmac, a farm lane, the first mud. Everyone is talking. Everyone is going too fast.' },
    { id: 'witchknee', name: 'Witchknee Climb', from: 3, to: 8.5, kind: 'climb', tech: 0.3, exposed: 0.1, forest: 0.9,
      text: 'The lane tips up into beech woods. Above you a zip of headlamps switchbacks up the hillside, higher than seems reasonable. 720 metres of climbing before the first descent.' },
    { id: 'witchtop', name: 'Witchknee Top', from: 8.5, to: 10, kind: 'ridge', tech: 0.35, exposed: 0.8, forest: 0,
      text: 'Out of the trees onto a heather shoulder. Wind. The village you left is a scatter of orange lights far below.' },
    { id: 'bracken', name: 'Bracken Drop', from: 10, to: 14, kind: 'descent', tech: 0.55, exposed: 0.3, forest: 0.5,
      text: 'A rutted, rooty path drops 530 metres through bracken to Brackenfold. Fresh legs want to fly. Quads remember everything.' },
    { id: 'brackwater', name: 'Brack Water', from: 14, to: 19, kind: 'runnable', tech: 0.2, exposed: 0.3, forest: 0.4,
      text: 'Valley trail beside the river, gently downhill. There is a ford at Brack Water: knee-deep, fast, and cold.' },
    { id: 'hollin', name: 'Hollin Lanes', from: 19, to: 24, kind: 'runnable', tech: 0.15, exposed: 0.2, forest: 0.5,
      text: 'Rolling farm tracks and stiles towards Hollin Bridge. Easy running if you have it in you. The big climb starts after the aid station.' },
    { id: 'coldwoods', name: 'Coldharrow Woods', from: 24, to: 29, kind: 'climb', tech: 0.3, exposed: 0, forest: 1,
      text: 'Pine forest, needles underfoot, 630 metres of steady climbing. The kind of climb you cannot see the top of.' },
    { id: 'rakes', name: 'The Rakes', from: 29, to: 33, kind: 'climb', tech: 0.55, exposed: 0.9, forest: 0.1,
      text: 'Out of the trees the path rears up: scree gullies and rock steps, 670 metres in four kilometres. Hands-on-knees ground.' },
    { id: 'ridge', name: 'Coldharrow Ridge', from: 33, to: 38, kind: 'ridge', tech: 0.5, exposed: 1, forest: 0,
      text: 'The spine of the race: five kilometres of rocky ridge above 1,800 metres, over the knolls to the Crown, the high point at 2,140 m.' },
    { id: 'crowndesc', name: 'Crown Descent', from: 38, to: 41, kind: 'descent', tech: 0.6, exposed: 1, forest: 0,
      text: 'Loose switchbacks off the summit towards Tarn Hut, a stone refuge beside a black lake.' },
    { id: 'scree', name: 'The Scree Staircase', from: 41, to: 46, kind: 'descent', tech: 0.85, exposed: 0.7, forest: 0,
      text: 'Seven hundred metres down in five kilometres of rock steps and loose stone. Famous. Infamous. Your quads will pay for every metre, and the bill comes later.' },
    { id: 'larch', name: 'Larch Hollow', from: 46, to: 52, kind: 'descent', tech: 0.3, exposed: 0.1, forest: 0.9,
      text: 'The angle eases into larch forest: a long, runnable descent on soft trail to Mill End and halfway.' },
    { id: 'millrace', name: 'Millrace Trail', from: 52, to: 57, kind: 'runnable', tech: 0.2, exposed: 0.2, forest: 0.6, flow: true,
      text: 'Singletrack beside the millrace, under alders, almost flat. If your legs are good, this is what you came for.' },
    { id: 'larchway', name: 'Larchway', from: 57, to: 62, kind: 'runnable', tech: 0.25, exposed: 0.2, forest: 0.8,
      text: 'Rolling forest trail, short sharp ups and downs, to Fernhollow. The Oven waits behind it.' },
    { id: 'oven', name: 'The Oven', from: 62, to: 68, kind: 'climb', tech: 0.3, exposed: 1, forest: 0, sunny: 1.3,
      text: 'A south-facing slope of grass and scree with no shade at all: 530 metres up to Hartwell Spring. Locals call it the Oven for a reason.' },
    { id: 'oventop', name: 'Oven Top', from: 68, to: 72, kind: 'climb', tech: 0.4, exposed: 1, forest: 0, sunny: 1.2,
      text: 'Steeper still: 390 metres of rock and heather to the top of the Saddleback. The spring is the last water for eight kilometres.' },
    { id: 'saddleback', name: 'Saddleback', from: 72, to: 76, kind: 'ridge', tech: 0.4, exposed: 1, forest: 0, sunny: 1.0,
      text: 'Rolling high ground to Saddle Bothy. Far behind you, the Crown. You were up there this morning.' },
    { id: 'bothydesc', name: 'Bothy Descent', from: 76, to: 81, kind: 'descent', tech: 0.5, exposed: 0.4, forest: 0.4,
      text: 'A rocky path dropping 650 metres to the valley floor. Tired legs make technical ground twice as hard.' },
    { id: 'lowfields', name: 'Lowford Fields', from: 81, to: 85, kind: 'runnable', tech: 0.1, exposed: 0.5, forest: 0.1,
      text: 'Flat meadows to Lowford, with one more river to wade near the end. The last aid station is in the village hall.' },
    { id: 'lastlie', name: 'The Last Lie', from: 85, to: 91, kind: 'climb', tech: 0.35, exposed: 0.3, forest: 0.6,
      text: 'The final climb: 620 metres through woods and over false summits. Everyone has been warned about it. Nobody believes it until they are on it.' },
    { id: 'gallows', name: 'Gallows Edge', from: 91, to: 93, kind: 'ridge', tech: 0.4, exposed: 1, forest: 0,
      text: 'A short exposed edge: the last high ground of the race.' },
    { id: 'homeward', name: 'Homeward Drop', from: 93, to: 98, kind: 'descent', tech: 0.55, exposed: 0.3, forest: 0.4,
      text: 'Eight hundred metres of descent in five kilometres. The quads you saved, or didn\'t, decide how this goes.' },
    { id: 'home', name: 'Lowmere Home', from: 98, to: 100, kind: 'runnable', tech: 0, exposed: 0.2, forest: 0.2,
      text: 'Lanes, a bridge, the square. You can hear the cowbells.' }
  ];

  // Food served at aid stations
  const FOOD = {
    water:      { name: 'Cups of water', kcal: 0, fluid: 0.45, time: 1 },
    electro:    { name: 'Electrolyte drink', kcal: 50, fluid: 0.35, salt: 10, time: 1 },
    cola:       { name: 'Flat cola', kcal: 100, fluid: 0.2, caffeine: 8, soothe: 5, sweet: 1, time: 1 },
    broth:      { name: 'Salty broth', kcal: 40, fluid: 0.25, salt: 22, soothe: 12, warm: 18, savory: true, time: 2 },
    potatoes:   { name: 'Salted potatoes', kcal: 160, salt: 14, savory: true, time: 2 },
    watermelon: { name: 'Watermelon', kcal: 60, fluid: 0.2, soothe: 5, cool: 8, time: 1 },
    crisps:     { name: 'Crisps', kcal: 150, salt: 10, savory: true, time: 1 },
    wrap:       { name: 'Cheese wrap', kcal: 300, salt: 6, savory: true, heavy: true, time: 3 },
    porridge:   { name: 'Porridge with honey', kcal: 300, warm: 20, heavy: true, time: 4 },
    tea:        { name: 'Sweet tea', kcal: 50, fluid: 0.25, caffeine: 4, warm: 14, soothe: 4, time: 2 },
    pasta:      { name: 'Bowl of pasta', kcal: 420, salt: 8, savory: true, heavy: true, time: 5 },
    noodles:    { name: 'Noodle soup', kcal: 240, fluid: 0.2, salt: 18, warm: 16, savory: true, soothe: 4, time: 3 },
    pizza:      { name: 'Pizza slice', kcal: 330, salt: 10, savory: true, heavy: true, time: 2 },
    ginger:     { name: 'Ginger chews', kcal: 30, soothe: 16, time: 1 },
    icepop:     { name: 'Ice lolly', kcal: 70, fluid: 0.1, cool: 14, soothe: 3, sweet: 0.5, time: 1 }
  };

  // Aid stations and other nodes, by km
  const NODES = [
    { km: 0, type: 'start', id: 'start', name: 'Lowmere' },
    { km: 14, type: 'aid', id: 'brackenfold', name: 'Brackenfold', cutoff: 270,
      food: ['water', 'electro', 'cola', 'crisps', 'watermelon'],
      text: 'A farmyard strung with fairy lights. A generator hums. Someone is ringing a cowbell at nobody in particular.',
      volunteer: '"Number?" A woman in a bobble hat ticks you off a clipboard. "Water\'s on the left, cola on the right, toilets are the barn."' },
    { km: 33, type: 'water', id: 'rakes', name: 'Rakes Top',
      text: 'A tiny tent pegged into the scree at the top of the Rakes, flapping like mad. Two marshals and a stack of water jerrycans.' },
    { km: 24, type: 'aid', id: 'hollin', name: 'Hollin Bridge', cutoff: 420, dropBag: true,
      food: ['water', 'electro', 'cola', 'broth', 'potatoes', 'crisps'],
      text: 'A marquee by the old stone bridge, a fire pit, and steam rising off a vat of broth. Runners sit wrapped in foil like baked potatoes.',
      volunteer: '"Drop bags are in the van, love. Broth\'s hot. Don\'t sit by the fire too long. People sit by that fire and never get up."' },
    { km: 41, type: 'aid', id: 'tarn', name: 'Tarn Hut', cutoff: 720, cots: true, medic: true,
      food: ['water', 'electro', 'tea', 'broth', 'porridge', 'cola', 'ginger'],
      text: 'A stone refuge beside a black lake, 1,750 metres up. Inside it is hot and loud and smells of wet wool and soup. There are camp beds at the back.',
      volunteer: '"You made it up the Rakes, eh?" The hut warden is about seventy and has seen everything. "Eat something warm. The Staircase is next. Go down it like you\'re carrying eggs."' },
    { km: 52, type: 'aid', id: 'mill', name: 'Mill End', cutoff: 900, dropBag: true, medic: true, shuttle: true,
      food: ['water', 'electro', 'cola', 'pasta', 'potatoes', 'watermelon', 'icepop', 'ginger'],
      text: 'Halfway. A sports hall in an old mill: trestle tables, a physio, a hundred drop bags in rows. A minibus idles in the yard with a sign in the windscreen: LOWMERE.',
      volunteer: '"Halfway! Brilliant!" says a teenager in a hi-vis vest. "The minibus back to Lowmere goes every hour, if, you know." He doesn\'t finish the sentence.' },
    { km: 62, type: 'aid', id: 'fern', name: 'Fernhollow', cutoff: 1050, ice: true,
      food: ['water', 'electro', 'cola', 'watermelon', 'icepop', 'potatoes', 'crisps'],
      text: 'A gazebo at the foot of a bare hillside. Coolers of ice. Everyone is looking up at the slope, not talking.',
      volunteer: '"There\'s a spring two-thirds of the way up," says a man with a sunburnt neck, filling your flask. "Fill every bottle you\'ve got. Ice in the hat. Seriously."' },
    { km: 68, type: 'water', id: 'spring', name: 'Hartwell Spring',
      text: 'A pipe in the hillside spills clear, freezing water into a stone trough. A marshal sits under a tiny umbrella.' },
    { km: 76, type: 'aid', id: 'bothy', name: 'Saddle Bothy', cutoff: 1290, cots: true, medic: true,
      food: ['water', 'electro', 'cola', 'noodles', 'broth', 'potatoes', 'ginger'],
      text: 'A shepherd\'s bothy on the saddle, door propped open. Noodle soup on a gas ring. A medic is taping someone\'s feet on the bench outside.',
      volunteer: '"Twenty-four K to go," the medic says without looking up. "Mostly downhill." Somebody laughs bitterly. "Mostly," she repeats.' },
    { km: 85, type: 'aid', id: 'lowford', name: 'Lowford', cutoff: 1440, medic: true,
      food: ['water', 'electro', 'cola', 'pizza', 'broth', 'potatoes', 'watermelon', 'ginger'],
      text: 'The village hall, every light on. Kids hand out cups. Somebody\'s nan has made flapjack. There is a framed photo of the Last Lie on the wall, which seems cruel.',
      volunteer: '"Last aid!" a kid shouts at you, very seriously. "Then the Last Lie, then the finish. My dad says the Last Lie lies twice."' },
    { km: 100, type: 'finish', id: 'finish', name: 'Lowmere', cutoff: 1680 }
  ];

  // Notable points
  const FEATURES = [
    { km: 10, type: 'summit', id: 'witchtop', name: 'Witchknee Top' },
    { km: 17, type: 'ford', id: 'brackford', name: 'Brack Ford' },
    { km: 33, type: 'ridgeon', id: 'ridgeon', name: 'Coldharrow Ridge' },
    { km: 38, type: 'summit', id: 'crown', name: 'the Crown', big: true },
    { km: 72, type: 'summit', id: 'oventop', name: 'the top of the Oven' },
    { km: 84, type: 'ford', id: 'lowford', name: 'the Lowford' },
    { km: 88, type: 'false', id: 'false1', name: 'a top' },
    { km: 90, type: 'false', id: 'false2', name: 'another top' },
    { km: 93, type: 'summit', id: 'gallows', name: 'Gallows Edge', lights: true }
  ];

  const DROP_ITEMS = {
    socks:     { name: 'Fresh socks & tape', desc: 'Dry feet. Change at the aid station: feet recover, wetness gone.' },
    flask:     { name: 'Third flask', desc: '+0.5 L water capacity for the rest of the race.' },
    caffeine:  { name: 'Caffeine gels ×3', desc: 'Energy plus a strong jolt of alertness. Use from the vest.' },
    headphones:{ name: 'Headphones', desc: 'Music: morale drains slower for ~5 hours of battery. You can\'t chat while they\'re in.' },
    sunhat:    { name: 'Sun hat & sleeves', desc: 'Cuts the heat of direct sun by a third.' },
    warm:      { name: 'Warm mid-layer', desc: 'Much better protection from cold with the jacket.' },
    poles:     { name: 'Folding poles', desc: 'Faster, cheaper power-hiking; saves some leg damage on climbs and descents.' },
    batteries: { name: 'Headlamp batteries', desc: 'A fresh set for a second night.' },
    note:      { name: 'Sealed note from home', desc: 'Someone wrote you something. Open it when you need it.' },
    riceballs: { name: 'Rice balls ×3', desc: 'Savoury, gentle real food (200 kcal each). Resets sugar fatigue.' }
  };

  const REASONS = [
    { id: 'dad', short: 'Dad', text: 'For Dad, who walked these hills before you could walk.' },
    { id: 'cant', short: '"I can\'t"', text: 'To find out what is on the other side of "I can\'t".' },
    { id: 'sunrise', short: 'The sunrise', text: 'Because the sunrise from the Crown is supposed to be unreal.' },
    { id: 'type', short: 'Not the type', text: 'Because somebody once said you weren\'t the type.' },
    { id: 'mile', short: 'Couldn\'t run a mile', text: 'For the version of you who couldn\'t run a mile.' },
    { id: 'waiting', short: 'Someone waiting', text: 'Because someone is waiting for you at the finish.' }
  ];

  const WEATHER = [
    { id: 'clear', name: 'Clear and hot', tMin: 11, tMax: 30, wind: 0.6, cloud: 0.05, rain: [], fog: [],
      forecast: 'Clear skies. A cold, starry night on the tops, then a hot, cloudless afternoon: 30°C in the valleys. Take the heat seriously on the Oven.' },
    { id: 'fog', name: 'Mountain fog', tMin: 9, tMax: 26, wind: 0.5, cloud: 0.3, rain: [], fog: [[30, 420]],
      forecast: 'Low cloud on the tops from about 00:30 until mid-morning: navigation by flag and headlamp, everything wet. Clearing to a warm afternoon, 26°C.' },
    { id: 'storm', name: 'Rain overnight', tMin: 7, tMax: 22, wind: 1.0, cloud: 0.6, rain: [[30, 390]], fog: [[0, 440]],
      forecast: 'A front crosses overnight: heavy rain and strong winds on the ridge from about 00:30 to 06:30, near freezing with wind chill. A cool, breezy day after: 22°C.' }
  ];

  const NAMED = {
    tomas: { name: 'Tomas Brecken', short: 'Tomas', bib: 88 },
    ines: { name: 'Ines Arrabal', short: 'Ines', bib: 23 },
    jonah: { name: 'Jonah Pell', short: 'Jonah', bib: 141 }
  };

  // Strangers who fall in alongside for a stretch
  const STRANGERS = [
    { name: 'Priya', line: 'Priya is a night-shift nurse. "Honestly this is easier than a Saturday in A&E," she says, and tells you about the worst one. You laugh for a kilometre.' },
    { name: 'Owen', line: 'Owen keeps sheep two valleys over. He names every hill you can see and tells you which ones have ghosts.' },
    { name: 'Mariko', line: 'Mariko has run this race four times and finished it twice. "The two I finished, I ate more," she says. "That\'s the whole secret."' },
    { name: 'Bas', line: 'Bas is a retired postman who took up running at sixty. He walks the ups, jogs the rest, and never seems to stop smiling.' },
    { name: 'Fen', line: 'Fen is running in sandals and absolutely will not discuss it. You talk about films instead.' },
    { name: 'Gus', line: 'Gus sings under his breath: hymns, then pop songs, then hymns again. After a while you are humming along.' }
  ];

  const LOOKS = ['green cap', 'orange vest', 'tie-dye shirt', 'yellow poles', 'kilt', 'pink shorts', 'big white beard', 'red bandana',
    'dog-print buff', 'gold shoes', 'flapping race number', 'Hawaiian shirt'];

  NODES.sort((a, b) => a.km - b.km);
  return { RACE_NAME, START_CLOCK, PROFILE, SECTIONS, FOOD, NODES, FEATURES, DROP_ITEMS, REASONS, WEATHER, NAMED, STRANGERS, LOOKS };
});
