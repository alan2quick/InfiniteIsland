// The Tdoongz' lines (PLAN "Steps 64-66"). Pure data, no three.js, so Node can check that every talking friend has a script (test/tdoongz.test.js).
//
//   SCRIPT[id] = { intro: [pages], greet, rows: [{ id, label, icon, pages: [...], play? }], bye }
//     intro   played the first time a screen talks to the friend (per-screen memory `infiniteIsland.tdoongIntro.<id>`), then the menu opens
//     greet   the menu's line;  rows = the menu rows before "Bye" (`icon` is a key of ICONS in ui/icons.js; `play` = a flourish to run when the row is picked)
//     bye     floated over the friend's head when the player says Bye
//
// The lines follow each friend's PERSONALITY (PLAN "Steps 64-66", "Personalities"; keep them in mind for Step 65's storylines):
//   Im Nabong     always the first to come running; cloud pouch packed with carrots + snacks; wing-like sky-blue ears; curious about everything
//   Yu Bbui Bbui  dreams of shining brightest on stage; looks chic / aloof in all-black fur, but her charms draw you in up close
//   Mokuring      made of everything she loves (colours, shapes, butterflies, dinosaurs): if she likes it, she likes it; builds each day her own way
//   Shyam Shyam   fills every space with laughter: flits about, chatters, plays little pranks, acts cute; no dull moments
//   Park Zyoni    raced across the endless sky and caught a tiny cloud on her horn; never loses her bright, positive spirit; chases sparkling dreams
//   Myodette      brings quiet comfort; pale feathers remember the ballet she practised as a child; light, graceful steps, her own rhythm
//   Dub Nyangee   gentle smile, soft as tofu; listens to happy stories and worries alike; subtle humour, playful, dependable
//   Son Chaetty   loves slow, easygoing days; dreams of being a brave tiger but cuteness comes first; naps anywhere, then plays and eats
//   Tzukumi       quiet and sleepy, secretly quirky and playful; gives a friend in need one of her heart antlers for sweet dreams
// The shared backstory so far: the nine drifted to the islands together on a cloud (Park Zyoni's: the one she caught on her horn).

export const SCRIPT = {
  imnabong: {
    intro: [
      'Oh! Hello, hello! I saw you from all the way over there, so I came running! I am Im Nabong. Say it slowly: im-na-bong.',
      'Me and my friends, the Tdoongz, floated over the sea on a big fluffy cloud. The moment I saw this island, I just HAD to hop off and look at everything!',
      'What is that tree? What is in that bush? What is over that hill? Oh, there is so much to find! Will you go exploring with me sometime?',
    ],
    greet: 'Hi, hi! Did you want to chat? Or go somewhere? I am ready!',
    rows: [
      {
        id: 'pouch', label: "What's in your pouch?", icon: 'sparkle', play: 'show', pages: [
          'This is my cloud pouch! It is soft and fluffy, and it is always packed with carrots. Crunchy, orange, the best!',
          'And snacks. Lots of snacks. You never know when an adventure starts, and adventures make you hungry! If you are ever peckish, tell me, and we will share.',
        ],
      },
      {
        id: 'who', label: 'Who are you?', icon: 'heart', pages: [
          'I am Im Nabong, a bunny! When something exciting happens, I am always the first one there. Always!',
          'See my ears? When I run, they spread out wide like wings. Whoosh! Sometimes I think I could fly, if I ran just a little bit faster.',
        ],
      },
      {
        id: 'camp', label: 'The campfire', icon: 'flame', pages: [
          'The campfire is where everybody comes back to after an adventure. It crackles, and it smells of toasted things, and it makes my ears all warm.',
          'I sit here and think about where to run off to tomorrow. The mountains? The beach? Ooh, maybe both!',
        ],
      },
    ],
    bye: 'Bye-bye! Call me if you find something fun!',
  },

  yubbuibbui: {
    intro: [
      '...Oh. Hello. I am Yu Bbui Bbui.',
      '...You are still here? Hmm. Most people think I am a bit cool and quiet, because of my black fur. Do you think so too?',
      'Well... between you and me, I am practising. For a stage! One day I will put on a show so good that nobody ever forgets it. Ta-da! ...That was the ending. Was it good?',
    ],
    greet: 'Oh, it is you. Did you come to see me practise?',
    rows: [
      {
        id: 'stage', label: 'A stage?', icon: 'sparkle', play: 'shake', pages: [
          'Every day I look for my chance to shine. A song, a dance, a twirl, a pose... I have to find the thing that is only mine.',
          'This island has no stage yet. But that log by the fire would do, if somebody pulled it out a bit. ...I am only saying.',
        ],
      },
      {
        id: 'who', label: 'Who are you?', icon: 'heart', pages: [
          'Yu Bbui Bbui. A puppy. Black fur, cream face, plaid pocket. Very stylish, I know.',
          'People say I look aloof. But if you stay a little longer... you will see. I am actually very, very fun. Wag, wag.',
        ],
      },
    ],
    bye: 'Come to my show one day. Front row!',
  },

  mokuring: {
    intro: [
      'Oh! Hi! I am Mokuring! Look, look, do you like my heart? And my butterfly? And my dinosaur? I like them SO much.',
      'Why a dinosaur? There is no reason! I just like it. If I like something, I like it. That is all!',
      'This island is full of colours and shapes I have never seen. I am going to collect all my favourites and make every day exactly the way I want it.',
    ],
    greet: 'Hi again! I found three new favourite things today!',
    rows: [
      {
        id: 'favourites', label: 'Your favourite things?', icon: 'heart', play: 'surprise', pages: [
          'Lavender. Hearts. Stripy socks. Butterflies. Dinosaurs. Round things. Sparkly things. Pink. More pink.',
          'And today: that red flower, the sound the river makes, and the way the campfire smoke curls. Oh! And you, a little bit.',
        ],
      },
      {
        id: 'who', label: 'Who are you?', icon: 'sparkle', pages: [
          'I am Mokuring, a bear! I am made of all the things I love, put together. That is how I became me. The one and only!',
          'Some days I spend all day sitting and looking at one butterfly. That is a good day too. My days, my way!',
        ],
      },
    ],
    bye: 'Bye! You are on my favourites list now!',
  },

  shyamshyam: {
    intro: [
      'Hee hee! Boo! Did I scare you? No? Hmm, next time then! I am Shyam Shyam!',
      'I zip around here, I flutter around there, flap flap flap with my little wings. There is always somewhere new to be!',
      'And wherever I go, it gets noisy and fun. That is my rule: no dull moments. Not one!',
    ],
    greet: 'Hiii! Want to hear something funny? Or play a trick on somebody?',
    rows: [
      {
        id: 'prank', label: 'A prank?', icon: 'sparkle', play: 'wiggle', pages: [
          'Shhh! Okay, so. Yesterday I hid behind Im Nabong and squeaked, and she jumped SO high, her ears went flappy! Hee hee hee!',
          'Then I gave her a snack so she would not be cross. That is the secret: a good prank always ends with everybody laughing.',
        ],
      },
      {
        id: 'who', label: 'Who are you?', icon: 'heart', play: 'flutter', pages: [
          'I am Shyam Shyam, a hamster! With wings! Tiny ones. They are not very strong, but they make me go a little bit faster.',
          'I like chatting, and giggling, and being cute. I am very good at being cute. Look! ...See?',
        ],
      },
    ],
    bye: 'Bye-bye! Hee hee, watch your back!',
  },

  parkzyoni: {
    intro: [
      'Hiya! Park Zyoni, at your service! Neigh-ce to meet you!',
      'I was racing across the sky, faster and faster, when, boing! A tiny cloud caught on my horn. It was too cute to shake off, so I kept it.',
      'It grew big and fluffy, and it carried all of us Tdoongz here! See? Even a funny accident can turn into something wonderful.',
    ],
    greet: 'Hey hey! Any dreams to chase today? I have about a hundred!',
    rows: [
      {
        id: 'cloud', label: 'The cloud on your horn?', icon: 'sparkle', play: 'toss', pages: [
          'It is a little piece of sky, and it goes everywhere with me now. You can still see a puff of it in my mane!',
          'When it rains, I just think: more clouds to catch! Nothing gets me down for long.',
        ],
      },
      {
        id: 'who', label: 'Who are you?', icon: 'heart', pages: [
          'I am Park Zyoni, a unicorn! I gallop across the sky, chasing sparkly dreams. I never catch them all, but chasing them is the fun part!',
          'If you ever feel stuck, come and find me. I will cheer you on so loudly the whole island hears it!',
        ],
      },
    ],
    bye: 'Bye! Dream big, okay?',
  },

  myodette: {
    intro: [
      '...Oh. Hello. I am Myodette. Please, do not mind me. I walk a little slowly.',
      'My feathers are very old, you see. They remember things. When I was small, I practised ballet... step, and step, and turn. I still do, when it is quiet.',
      'We came here together, all of us, on a soft cloud. ...It is nice here. If you ever need company, I will be nearby. We do not have to talk.',
    ],
    greet: '...Hello again. It is a calm day, is it not?',
    rows: [
      {
        id: 'ballet', label: 'Ballet?', icon: 'sparkle', play: 'pirouette', pages: [
          'One step, then the next. Never in a hurry. ...That is how I was taught. Each one is its own small dance.',
          'My feet are not made for the stage, really. But in my feathers I can still hear the music. ...Would you like to see a turn?',
        ],
      },
      {
        id: 'who', label: 'Who are you?', icon: 'heart', play: 'bow', pages: [
          'I am Myodette, a penguin. A fluffy one. ...Yes, the puff is very soft. You may look, but it does not like being squeezed.',
          'I am not very loud, and I am not very fast. But I am good at staying. ...If you are tired, sit with me a while.',
        ],
      },
    ],
    bye: '...Goodbye. I will be right here.',
  },
  dubnyangee: {
    intro: [
      'Hello, I am Dub Nyangee. Come closer. My scarf has enough warmth for a friend, too.',
      'A happy story, a little worry... I like hearing the whole thing. Take your time. I am a cat; waiting comfortably is one of my talents.',
      'We floated here together on Park Zyoni\'s cloud. I saved you this little heart. It travels better than a hug, though I have those, too.',
    ],
    greet: 'There you are. How has your day been? I have time.',
    rows: [
      { id: 'heart', label: 'A heart for me?', icon: 'heart', play: 'blowheart', pages: [
        'Catch! A little kindness, with no chores attached. If you drop it, that is all right. Cats are excellent at pretending that was the plan.',
        'My scarf has hearts at both ends. I like to think that means there is always a spare for a friend.',
      ] },
      { id: 'who', label: 'Who are you?', icon: 'sparkle', play: 'wink', pages: [
        'Dub Nyangee, a soft white cat. Soft as tofu, they say. Please do not put me in the soup.',
        'I am good at listening. You do not have to make a worry sound smaller for me. We can sit with it until you feel ready.',
      ] },
      { id: 'listen', label: 'Can we sit together?', icon: 'flame', play: 'listen', pages: [
        'Of course. Tell me as much or as little as you like. I will stay for the ending... even if the ending is a nap.',
      ] },
    ],
    bye: 'Come back whenever you like. I will keep a warm spot for you.',
  },
  sonchaetty: {
    intro: [
      'Oh! Hi! I am Son Chaetty. I was practising being a very brave tiger. With my eyes shut.',
      'One day I will have a mighty roar. Today I have a comfy patch of grass, a snack, and you. That is a pretty good day already.',
      'Park Zyoni brought us here on a cloud. Best bed I have ever travelled on! Shall we play a little before my next nap?',
    ],
    greet: 'Hii! Is it snack time, play time, or nearly nap time?',
    rows: [
      { id: 'tiger', label: 'A brave tiger?', icon: 'sparkle', play: 'bigwave', pages: [
        'Rawr! ...Was that brave? My paws waved all by themselves. They always give the cuteness away.',
        'I can practise again tomorrow. There is no hurry to grow a big roar.',
      ] },
      { id: 'play', label: 'Want to play?', icon: 'heart', play: 'bounce', pages: [
        'Yes! Just a little bounce, then a snack, then we can find the softest grass. I know several very promising patches.',
      ] },
      { id: 'who', label: 'Who are you?', icon: 'flame', play: 'nap', pages: [
        'Son Chaetty, a tiger cub. I like little joys: a sweet bite, a silly game, falling asleep somewhere warm.',
        'The strawberry on my foot is a patch. I checked. Still cute, though. ...Wake me if you find a real one?',
      ] },
    ],
    bye: 'See you after a little rest! Or before. I can always make time for a snack.',
  },
  tzukumi: {
    intro: [
      '...Hello. I am Tzukumi. If I blink for a very long time, I am still glad to meet you.',
      'I am a little deer. Park Zyoni\'s cloud carried us here... I dreamed most of the way. Perhaps the cloud dreamed of us, too.',
      'If your day feels heavy, sit beside me. I can lend you a heart from my antlers. It helps hold a sweet dream while you rest.',
    ],
    greet: '...Oh, you are here. I was saving a quiet moment for you.',
    rows: [
      { id: 'ears', label: 'What did you hear?', icon: 'sparkle', play: 'eartwitch', pages: [
        'A leaf turning over. A friend coming closer. ...My ears hear so much. Sometimes I let them listen while the rest of me naps.',
        'Just now they heard my stomach. Very mysterious. Perhaps a biscuit would solve it.',
      ] },
      { id: 'hearts', label: 'Your heart antlers?', icon: 'heart', play: 'wink', pages: [
        'When a friend is having a hard day, I gently take one off and lend it to them. Something soft to carry into a sweet dream.',
        'You can return it when you feel rested. There is no clock on a kindness. ...Or on my naps, if I can help it.',
      ] },
      { id: 'who', label: 'Who are you?', icon: 'flame', play: 'dream', pages: [
        'Tzukumi, a sleepy little fawn. I look very calm. Inside, I am wondering whether clouds ever dream of being pillows.',
        'Stay a while if you are tired. We can try doing absolutely nothing together. I have had lots of practice.',
      ] },
    ],
    bye: '...Rest well. I hope your next dream is kind.',
  },
};

// Step 86b: Im Nabong's Homesteading rows, added to HER menu by main.js (createTdoongz `extraRows`), never to the other friends'.
//   unlock   shown when the home Journal album is complete and Homesteading is not unlocked yet (host screen only); the last page ends the talk, the host unlocks it and the watering can showcase plays
//   tip      shown once Homesteading is unlocked (every screen): a hint about the watering can and the campfire
// `icon` is a key of ROW_ICONS in world/tdoongz.js. Test: test/homesteadUnlock.test.js.
export const HOMESTEAD_TALK = {
  friend: 'imnabong',
  unlock: {
    id: 'homestead-unlock', label: 'I found everything!', icon: 'sparkle', play: 'earflop', pages: [
      'Ooh! Is that the WHOLE Journal for this island? Every single page is full! I came running as fast as my ears could flap!',
      'You found it all! And you know what? This island could be even cosier with things we plant ourselves. A tree here, a rock there, just the way we like it!',
      'So I dug something out of my cloud pouch, right under the carrots. Ta-daa! A watering can! Sprouts grow up SO fast with a little splash.',
      'To start, pick Homesteading at the campfire. The can is waiting on the tool rack there. Oh, I cannot wait to see what you grow!',
    ],
  },
  // Step 86f: the tip row rotates (one set of pages per visit, in order, then round again) so she always has something new: the can, the budget, other islands' plants, decorations. `tip` stays the first set.
  tips: [
    [
      'Pick Homesteading at the campfire, and the island is yours to shape! A tree here, a rock there. Just remember, everything on it needs room to grow.',
      'And do not forget the watering can on the campfire tool rack. Give a little sprout a splash and it grows up right away. Anybody can water, even friends visiting from far away!',
    ],
    [
      'Psst! Tiny sprouts are SO thirsty. One splash from the watering can and a sprout becomes a sapling. Another splash and, whoosh, a whole tree!',
      'Do not splash it twice in a hurry, though. Let it wiggle and grow first. Even I wait for that part, and I am terrible at waiting!',
    ],
    [
      'Did you notice the little leaves next to every plant in the list? That is how much room it takes. A tree takes three, a little herb only one! Flowers have their very own room.',
      'Dig something up and the room comes right back. It is like making space in my cloud pouch for more carrots. There is always space for carrots!',
    ],
    [
      'When a bridge or a boat takes you to another island, its plants and flowers show up in the list too! Frostpine pines, Emberleaf bamboo, Duskcrown glowcaps, all growing at home!',
      'There is a limit on how many different kinds you can plant at once, though. Take every copy of one kind away and the next kind can come in. And have you seen the Decorations tab? Free flowers, snowmen, tiki torches and mushrooms that shine at night!',
    ],
  ],
  tip: {
    id: 'homestead-tip', label: 'Homesteading', icon: 'sprout', pages: [
      'Pick Homesteading at the campfire, and the island is yours to shape! A tree here, a rock there. Just remember, everything on it needs room to grow.',
      'And do not forget the watering can on the campfire tool rack. Give a little sprout a splash and it grows up right away. Anybody can water, even friends visiting from far away!',
    ],
  },
  /** The tip row for visit number `n` (0, 1, 2, ...): the same row, the pages of tips[n mod tips.length]. */
  tipRow(n = 0) { const len = this.tips.length; return { ...this.tip, pages: this.tips[((Math.floor(Number(n)) || 0) % len + len) % len] }; },
  gaveCan: 'Im Nabong gave you a watering can!',
  canWaits: 'The watering can is on the home tool rack!',
};
