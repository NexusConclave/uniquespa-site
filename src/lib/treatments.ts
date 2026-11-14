/**
 * V2 full treatment pages: one page per main treatment, all rendered by components/TreatmentPage.astro.
 *
 * Rules for this copy (CLAUDE.md 8-17):
 *  - Every price, length and spa comes from lib/catalog.ts through lib/pageHelpers.ts. Nothing is typed in.
 *  - Say what a treatment is and how it feels. Never what it does to the body. No result or health claims.
 *  - No "free", "value", "save", "regular price". No before/after wording.
 *  - Wording here is built from the copy already on the hubs, the three flagship pages and the guides.
 *    It is DRAFT until Katy approves the pull request that adds it.
 *
 * Paths live in src/data/treatment-paths.json (catalog.ts turns them into each service's `flagship` link).
 */
import { getService, findLiveService, liveAddOns, formatMinutes, formatPrice, optionPriceText, type Group, type Service } from './catalog';
import { priceOf, priceList, lengthOf, whereText, offeredAt, displayName, inText } from './pageHelpers';
import { giftCoversVerb } from './confirm';
import treatmentPaths from '../data/treatment-paths.json';

export interface Qa { q: string; a: string }
export interface Fact { label: string; value: string }
export interface Step { t: string; d: string }
export interface RelatedCard { service: string; summary?: string }

export interface Treatment {
  /** Catalog service id. */
  service: string;
  group: Group;
  path: string;
  hub: { name: string; path: string };
  /** Short breadcrumb and link label, lower case in running text ("deep tissue massage"). */
  short: string;
  eyebrow?: string;
  /** The one H1. May hold one <em>. */
  title: string;
  /** <title>, 60 characters or fewer. */
  metaTitle: string;
  metaDescription: string;
  lede: string;
  /** asset-manifest id for the intro image. */
  image: string;
  imageRatio: string;
  /** Quick-facts rows that are copy (length, price and where are added from the catalog). */
  facts: Fact[];
  /** Second quick answer (the first, "Where can I book…", is generated from the catalog). */
  differs: Qa;
  what: string[];
  whoIntro: string;
  who: string[];
  /** Optional "check with your doctor first" list (only lists already used on the site). */
  checkTitle?: string;
  check?: string[];
  stepsIntro: string;
  steps: Step[];
  feelsLead: string;
  feels: string[];
  pricesIntro: string;
  /** Note per option label ("60 min"), shown above the price table. */
  lengthNotes?: Record<string, string>;
  compareTitle?: string;
  compare?: Qa[];
  before: string[];
  after: string[];
  faqTitle: string;
  faqs: Qa[];
  related: RelatedCard[];
  /** Date the page's facts were last checked against the catalog. */
  reviewed: string;
}

const PATHS = treatmentPaths.paths as Record<string, string>;
const REVIEWED = '2026-11-13';
const HUBS = {
  massage: { name: 'Massage', path: '/massage' },
  facials: { name: 'Facials', path: '/facials' },
  body: { name: 'Body treatments', path: '/body' },
} as const;

// Shared lines, word for word from the hubs and guides.
const WEAR = 'You undress to your comfort level in a private room and stay covered with a sheet. Only the area being worked on is uncovered.';
const MASSAGE_BEFORE = [
  'Arrive a few minutes early to fill in a short form.',
  'Tell us about pregnancy, recent surgery, health conditions, or allergies to oils or scents.',
  'Unscented oil or lotion is available. Ask when you arrive.',
];
const FACIAL_BEFORE = [
  'Skip harsh exfoliants and retinol for 48 hours.',
  'Come without makeup if you can.',
  'Bring a list of the products you use.',
  'Tell us about allergies or sensitive skin.',
];
const FACIAL_AFTER = [
  'Follow the aftercare tips we give you.',
  'Go gently with your routine for a day or two.',
  'Tell us next time how your skin felt, so we can adjust.',
];
const FACIAL_STEPS: Step[] = [
  { t: 'Skin check', d: 'We look at your skin and ask about your routine and goals.' },
  { t: 'Your plan', d: "We explain each step before we start, and adjust if you'd like to skip one." },
];
const FACIAL_OFTEN: Qa = { q: 'How often should I have a facial?', a: "Every 4 to 6 weeks suits most clients. We'll work around your schedule and goals." };
const FACIAL_PREP: Qa = { q: 'How should I prepare?', a: 'Skip harsh exfoliants and retinol for 48 hours. Come without makeup if you can, and bring a list of the products you use.' };
const BABOR: Qa = { q: 'What is BABOR?', a: 'BABOR is the professional skincare brand we use in our facials. Your esthetician chooses the products for your skin on the day.' };

const where = (id: string) => whereText(getService(id));
const sdOnlyNote = (id: string) => (offeredAt(getService(id), 'DM') ? '' : ' It is booked at our San Diego (Mission Valley) spa.');
const addOn = liveAddOns('massage')[0];
const addOnAtDM = !!addOn && addOn.options.every((o) => o.locations.includes('DM'));
const addOnText = addOn ? `${addOn.options.map((o) => `${formatMinutes(o.minutes)} for ${formatPrice(o.price)}`).join(' or ')}` : '';
const katyQa = (style: string): Qa => ({
  q: `Can I book ${style} with Katy?`,
  a: `Yes. <a href="/massage/with-katy">Massage with Katy</a>, our owner, can be ${style}. It's ${priceList('katy')}.`,
});
const giftQa = (id: string, what: string): Qa => ({
  q: 'Can I give it as a gift?',
  a: `Yes. An eGift card for ${priceOf(id)} ${giftCoversVerb()} ${what}. <a href="/gift-cards">How gift cards work</a>.`,
});
/**
 * "60 min $165 · 90 min $225 (San Diego only) · 90 min with stretching $235 (San Diego only)".
 * Like priceList(), but options that differ by more than length keep their own label, and an option
 * offered at fewer spas than the service says where. Catalog prices only.
 */
export function fullPriceList(id: string): string {
  const s = getService(id);
  const all = whereText(s);
  return s.options
    .map((o) => {
      const label = /with|,/i.test(o.label) ? o.label : lengthOf(o);
      const w = whereText(o);
      return `${label} ${optionPriceText(o)}${w !== all ? ` (${w})` : ''}`;
    })
    .join(' · ');
}
const costQa = (id: string, label: string): Qa => ({
  q: `How much does ${label} cost?`,
  a: `${fullPriceList(id)}. The booking page always shows the latest price.`,
});

function build(): Treatment[] {
  const list: Treatment[] = [];
  const add = (t: Omit<Treatment, 'path' | 'hub' | 'reviewed'>) => {
    // A page is only built while its service is live (status gate, catalog.ts) and has a path.
    if (!findLiveService(t.service) || !PATHS[t.service]) return;
    list.push({ ...t, path: PATHS[t.service], hub: HUBS[t.group], reviewed: REVIEWED });
  };

  // ------------------------------------------------------------------ Swedish
  if (findLiveService('swedish')) add({
    service: 'swedish', group: 'massage', short: 'Swedish massage',
    eyebrow: 'A great first massage',
    title: 'Swedish massage in San Diego and Del Mar',
    metaTitle: 'Swedish Massage in San Diego & Del Mar | Unique Spa House',
    metaDescription: `Swedish massage in Mission Valley, San Diego and Del Mar. Long, flowing strokes with light to medium pressure. ${priceOf('swedish', 60)} for 60 min. Book online.`,
    lede: 'Long, flowing strokes with light to medium pressure. A great first massage.',
    image: 'massage-1x1', imageRatio: '1 / 1',
    facts: [
      { label: 'Pressure', value: 'Light to medium. Ask for what you like.' },
      { label: 'Good for', value: 'A first massage, or an hour to switch off.' },
      { label: 'What to wear', value: 'Undress to your comfort level. You stay covered with a sheet.' },
      { label: 'Afterwards', value: 'Get up slowly. Most people simply feel relaxed.' },
    ],
    differs: { q: 'How is Swedish massage different from deep tissue?', a: 'Swedish uses long, even strokes and the pressure stays comfortable, from light to medium. Deep tissue is slower and firmer, and works into deeper muscle layers.' },
    what: [
      'Swedish is the classic full-body massage. The strokes are long and even, and the pressure stays comfortable.',
      "It's the massage we suggest for anyone new to massage, or anyone who simply wants an hour of quiet.",
      'Swedish runs from light to medium. Ask for the pressure you like, and your therapist will adjust as they go.',
      "It's a full-body massage. If you'd like more or less time anywhere, just say.",
    ],
    whoIntro: 'Not sure which massage to book? Swedish is a safe place to start.',
    who: [
      'Anyone having a first massage',
      'Anyone who wants to switch off for an hour',
      'Anyone unwinding after a busy week',
      "Anyone who isn't sure yet which massage suits them",
    ],
    stepsIntro: 'No rushing. You can ask questions at any point.',
    steps: [
      { t: 'A short chat first', d: 'Your goals, the pressure you like and any health conditions.' },
      { t: 'You get settled', d: 'A private room with soft lighting and quiet music. You stay covered with a sheet.' },
      { t: 'Long, flowing strokes', d: 'Smooth and steady, over the whole body.' },
      { t: 'Pressure that suits you', d: 'Your therapist adjusts as you go. Speak up any time.' },
      { t: 'Time for questions', d: 'When your session ends, ask anything you like.' },
    ],
    feelsLead: 'Smooth, steady and unhurried.',
    feels: [
      'The pressure stays comfortable from start to finish. Lighter, firmer, warmer or quieter: say so, and your therapist will adjust.',
      'Afterwards, most people simply feel relaxed. Get up slowly; you may feel a little dazed.',
    ],
    pricesIntro: `Every length is bookable at ${where('swedish')}. If it's your first time, 60 min is plenty; you can always book longer next time.`,
    lengthNotes: {
      '60 min': 'A full-body session. A good first visit.',
      '90 min': 'The whole body, at a slower pace.',
      '120 min': 'Our longest session, for when you want to fully switch off.',
    },
    compareTitle: 'Swedish or another massage?',
    compare: [
      { q: 'Swedish or deep tissue?', a: `Deep tissue uses slow, firm pressure for deeper muscle layers and stubborn knots. Swedish stays light to medium. Deep tissue 60 min is ${priceOf('deep-tissue', 60)}.` },
      ...(findLiveService('relaxing') ? [{ q: 'Swedish or relaxing massage?', a: `Our relaxing massage is a slow, soothing ${lengthOf(getService('relaxing').options[0])} session, just for unwinding. It's ${priceOf('relaxing')}.` }] : []),
      { q: 'Swedish or lymphatic?', a: 'Lymphatic is lighter and slower again. It works the skin rather than the muscle, and includes gentle tummy work. <a href="/massage/lymphatic-drainage">About lymphatic massage</a>.' },
    ],
    before: MASSAGE_BEFORE,
    after: ['Get up slowly. You may feel a little dazed.', 'Have some water, and keep the rest of the day easy if you can.', 'Tell us next time how you felt, so we can adjust the session.'],
    faqTitle: 'Swedish massage questions',
    faqs: [
      { q: 'Is Swedish a good first massage?', a: "Yes. It's the massage we suggest for anyone new to massage. The strokes are long and even, and the pressure stays comfortable." },
      { q: 'Can I have medium pressure in a Swedish massage?', a: 'Yes. Swedish runs from light to medium. Ask for the pressure you like, and your therapist will adjust.' },
      { q: 'What should I wear?', a: WEAR },
      { q: 'How long should I book?', a: '60 min suits a first visit. 90 min gives time for the whole body at a slower pace. Longer sessions suit people who already know what they like.' },
      costQa('swedish', 'Swedish massage'),
      ...(addOn ? [{ q: 'Can I add hot stones or cupping?', a: `Yes. Add ${addOn.name} to any massage: ${addOnText}, chosen when you book.` }] : []),
      giftQa('swedish', 'a 60 min Swedish massage'),
    ],
    related: [
      { service: 'deep-tissue', summary: 'Slow, firm pressure for deeper muscle layers and stubborn knots.' },
      { service: 'relaxing', summary: 'A slow, soothing full session, just for unwinding.' },
      { service: 'lymphatic', summary: 'Very gentle, rhythmic strokes. Our only massage with gentle tummy work.' },
    ],
  });

  // ------------------------------------------------------------------ Deep tissue
  if (findLiveService('deep-tissue')) {
    const dt = getService('deep-tissue');
    const sdOnly = dt.options.filter((o) => !o.locations.includes('DM')).map((o) => lengthOf(o));
    add({
      service: 'deep-tissue', group: 'massage', short: 'Deep tissue massage',
      eyebrow: 'For tension and recovery',
      title: 'Deep tissue massage in San Diego and Del Mar',
      metaTitle: 'Deep Tissue Massage, San Diego & Del Mar | Unique Spa House',
      metaDescription: `Deep tissue massage in Mission Valley, San Diego and Del Mar. Slow, firm pressure for deeper muscle layers and stubborn knots. ${priceOf('deep-tissue', 60)} for 60 min.`,
      lede: 'Slow, firm pressure for deeper muscle layers and stubborn knots. It can feel intense, but never sharp.',
      image: 'massage-1x1', imageRatio: '1 / 1',
      facts: [
        { label: 'Pressure', value: 'Firm, slow and focused. You set the limit.' },
        { label: 'Good for', value: 'Tight spots, such as shoulders, neck or lower back.' },
        { label: 'What to wear', value: 'Undress to your comfort level. You stay covered with a sheet.' },
        { label: 'Afterwards', value: 'Some soreness for a day or two is common.' },
      ],
      differs: { q: 'How is deep tissue different from Swedish massage?', a: 'Deep tissue is slower and firmer. Your therapist works into deeper muscle layers, usually where you hold tension most. Swedish uses long, flowing strokes with light to medium pressure.' },
      what: [
        'Deep tissue is the firmest of our classic massages. Your therapist slows down and works into deeper muscle layers, usually where you hold tension most.',
        "Expect firm pressure and the odd intense moment. Firm is fine; sharp pain isn't. You stay in charge of how firm it gets, and your therapist checks in as they go.",
        "A session can cover the whole body, or stay with one or two areas such as your shoulders, neck or lower back. Tell your therapist at the start where you'd like the time spent.",
      ],
      whoIntro: 'Not sure how firm you like it? Your therapist will start gently and build up.',
      who: [
        'People who like firm pressure',
        'People with particular tight spots, such as shoulders, neck or lower back',
        'Desk workers with a tight neck and shoulders',
        "Anyone who finds a lighter massage isn't enough",
      ],
      stepsIntro: 'No rushing. You can ask questions at any point.',
      steps: [
        { t: 'A short chat first', d: 'Where you feel tight, the pressure you like and any health conditions.' },
        { t: 'You get settled', d: 'A private room with soft lighting and quiet music. You stay covered with a sheet.' },
        { t: 'Slow, firm work', d: 'Your therapist works area by area, slowing down on knots and tight spots.' },
        { t: 'Check-ins on pressure', d: "Say if it's too much or not enough at any point. They'll adjust straight away." },
        { t: 'Time for questions', d: 'Ask anything before you go, including what to book next time.' },
      ],
      feelsLead: 'Firm, slow and focused. Intense at moments, but never sharp.',
      feels: [
        "You stay in charge of the pressure throughout. If anything feels sharp, tell your therapist and they'll ease off.",
        'After firm work, some people feel a little tender for a day, a bit like after a workout. Have some water and keep the rest of the day easy.',
        'Tell your therapist next time how you felt, and they can adjust.',
      ],
      pricesIntro: `Bookable at both spas${sdOnly.length ? `; ${sdOnly.join(' and ')} is San Diego only` : ''}. 60 min suits a first visit or one main area.`,
      lengthNotes: {
        '30 min': 'One area, such as neck and shoulders.',
        '60 min': 'A good first visit, or one or two main areas.',
        '90 min': 'The whole body, plus your tight spots.',
        '120 min': 'Our longest session, for people who already know what they like.',
      },
      compareTitle: 'Deep tissue or another massage?',
      compare: [
        { q: 'Deep tissue or Swedish?', a: `Swedish uses long, flowing strokes with light to medium pressure. It's the gentler choice, and a great first massage. Swedish 60 min is ${priceOf('swedish', 60)}.` },
        { q: 'Deep tissue or sports massage?', a: 'They overlap, but the aim differs. Deep tissue is slow, firm work on deeper muscle layers anywhere in the body. Sports massage is shaped around your training and the muscles you use most.' },
        ...(findLiveService('therapeutic') ? [{ q: 'Deep tissue or therapeutic massage?', a: `Therapeutic massage is a focused session for one main area, like your neck, shoulders or lower back. It's ${priceList('therapeutic')}.` }] : []),
      ],
      before: MASSAGE_BEFORE,
      after: ['Get up slowly. You may feel a little dazed.', 'Some soreness for a day or two is common after deep tissue.', 'Have some water, and keep the rest of the day easy if you can.'],
      faqTitle: 'Deep tissue massage questions',
      faqs: [
        { q: 'Will deep tissue hurt?', a: "Firm is fine; sharp pain isn't. Your therapist works with you on pressure and checks in, so say if it's too much or not enough at any point." },
        { q: 'Will I be sore the next day?', a: 'After firm work, some people feel a little tender for a day, a bit like after a workout. Have some water and keep the rest of the day easy. Tell your therapist next time, and they can adjust.' },
        { q: 'How long should I book?', a: '60 min suits a first visit or one main area. 90 min gives time for the whole body plus your tight spots. Longer sessions suit people who already know what they like.' },
        { q: 'What should I wear?', a: WEAR },
        costQa('deep-tissue', 'deep tissue massage'),
        ...(addOn ? [{ q: 'Can I add hot stones or cupping?', a: `Yes. Add ${addOn.name} to any massage: ${addOnText}, chosen when you book.` }] : []),
        katyQa('deep tissue'),
      ],
      related: [
        { service: 'sports', summary: 'Firmer, focused work for people who train.' },
        { service: 'therapeutic', summary: 'A focused massage for one main area, like your neck, shoulders or lower back.' },
        { service: 'swedish', summary: 'Long, flowing strokes with light to medium pressure. A great first massage.' },
      ],
    });
  }

  // ------------------------------------------------------------------ Sports
  if (findLiveService('sports')) {
    const sp = getService('sports');
    const stretch = sp.options.find((o) => /stretch/i.test(o.label));
    const stretchLine = stretch ? `Sports massage with stretching is on the menu too: ${lengthOf(stretch)}, ${priceOf('sports', stretch.label)} (${whereText(stretch)}).` : '';
    const dmLengths = sp.options.filter((o) => o.locations.includes('DM') && !/with/i.test(o.label)).map((o) => lengthOf(o));
    add({
      service: 'sports', group: 'massage', short: 'Sports massage',
      eyebrow: 'For people who train',
      title: 'Sports massage in San Diego and Del Mar',
      metaTitle: 'Sports Massage in San Diego & Del Mar | Unique Spa House',
      metaDescription: `Sports massage in Mission Valley, San Diego and Del Mar. Firmer, focused work for people who train. ${priceOf('sports', 60)} for 60 min. Book online.`,
      lede: 'Firmer, focused work for people who train. Popular after workouts and events.',
      image: 'massage-1x1', imageRatio: '1 / 1',
      facts: [
        { label: 'Pressure', value: 'Firm and focused.' },
        { label: 'Good for', value: 'People who train, run or play sport, at any level.' },
        { label: 'What to wear', value: 'Undress to your comfort level. You stay covered with a sheet.' },
        { label: 'Afterwards', value: 'Some people feel a little tender for a day.' },
      ],
      differs: { q: 'Is sports massage the same as deep tissue?', a: 'They overlap, but the aim differs. Sports massage is shaped around your training and the muscles you use most. Deep tissue is slow, firm work on deeper muscle layers anywhere in the body.' },
      what: [
        "Sports massage is firmer, brisker and shaped around your activity, whether that's running, lifting, cycling or a weekend game.",
        'Your therapist focuses on the muscles you use most. Tell them what you train for and where you feel it.',
        ...(stretchLine ? [stretchLine] : []),
        "You don't need to be an athlete to book it. It suits anyone who trains, walks a lot or plays sport, at any level.",
      ],
      whoIntro: "Don't train? Swedish or deep tissue may suit you better. Your therapist will help you choose.",
      who: [
        'People who train, run or play sport, at any level',
        'Anyone booking after a workout or an event',
        'People who walk a lot',
        'Anyone who likes firm, focused work',
      ],
      stepsIntro: 'No rushing. You can ask questions at any point.',
      steps: [
        { t: 'A short chat first', d: 'What you train for, where you feel it and any health conditions.' },
        { t: 'You get settled', d: 'A private room with soft lighting and quiet music. You stay covered with a sheet.' },
        { t: 'Firm, focused work', d: 'Brisker, targeted work around the muscles you use most.' },
        { t: 'Check-ins on pressure', d: "Say if it's too much or not enough. Your therapist adjusts as you go." },
        { t: 'Time for questions', d: 'Ask anything before you go, including what to book next time.' },
      ],
      feelsLead: 'Firm, brisk and focused on the muscles you use most.',
      feels: [
        'You stay in charge of the pressure. Firm is fine; sharp pain is not, so speak up at any point.',
        'After firm work, some people feel a little tender for a day, a bit like after a workout. Have some water and keep the rest of the day easy.',
      ],
      pricesIntro: dmLengths.length ? `Bookable in Del Mar at ${dmLengths.join(' and ')}; every length is in San Diego.` : 'Booked at our San Diego (Mission Valley) spa.',
      lengthNotes: {
        '60 min': 'A good first visit, or one or two main areas.',
        '90 min': 'The whole body, plus the muscles you use most.',
        '120 min': 'Our longest session, for people who already know what they like.',
        ...(stretch ? { [stretch.label]: 'Massage with stretching added.' } : {}),
      },
      compareTitle: 'Sports or another massage?',
      compare: [
        { q: 'Sports or deep tissue?', a: `Deep tissue is slow, firm work on deeper muscle layers anywhere in the body. It's ${priceOf('deep-tissue', 60)} for 60 min.` },
        { q: 'Sports or Swedish?', a: `Swedish is the gentlest of the three, with long, flowing strokes and light to medium pressure. It's ${priceOf('swedish', 60)} for 60 min.` },
        ...(findLiveService('thai') ? [{ q: 'Sports or Thai massage?', a: `Thai massage uses yoga-like stretches and rhythmic pressure. You stay relaxed while your therapist does the work. It's ${priceList('thai')} (${where('thai')}).` }] : []),
      ],
      before: MASSAGE_BEFORE,
      after: ['Get up slowly. You may feel a little dazed.', 'Have some water, and keep the rest of the day easy if you can.', 'Tell us next time how you felt, so we can adjust the session.'],
      faqTitle: 'Sports massage questions',
      faqs: [
        { q: 'Do I need to be an athlete to book sports massage?', a: "No. It suits anyone who trains, walks a lot or plays sport, at any level. If you don't train, Swedish or deep tissue may suit you better." },
        { q: 'Can I book sports massage in Del Mar?', a: dmLengths.length ? `Yes, at ${dmLengths.join(' and ')}. Every length is bookable in San Diego.` : 'Sports massage is booked at our San Diego spa.' },
        ...(stretch ? [{ q: 'What is sports massage with stretching?', a: `A ${lengthOf(stretch)} sports massage with stretching added. It's ${priceOf('sports', stretch.label)} (${whereText(stretch)}).` }] : []),
        { q: 'Will I be sore the next day?', a: 'After firm work, some people feel a little tender for a day, a bit like after a workout. Have some water and keep the rest of the day easy. Tell your therapist next time, and they can adjust.' },
        { q: 'What should I wear?', a: WEAR },
        costQa('sports', 'sports massage'),
        katyQa('sports massage'),
      ],
      related: [
        { service: 'deep-tissue', summary: 'Slow, firm pressure for deeper muscle layers and stubborn knots.' },
        { service: 'thai', summary: 'Yoga-like stretches and rhythmic pressure. You stay relaxed while your therapist does the work.' },
        { service: 'therapeutic', summary: 'A focused massage for one main area, like your neck, shoulders or lower back.' },
      ],
    });
  }

  // ------------------------------------------------------------------ Hot stone
  if (findLiveService('hot-stone')) add({
    service: 'hot-stone', group: 'massage', short: 'Hot stone massage',
    eyebrow: `At our ${offeredAt(getService('hot-stone'), 'DM') ? 'two spas' : 'San Diego spa'}`,
    title: `Hot stone massage in ${offeredAt(getService('hot-stone'), 'DM') ? 'San Diego and Del Mar' : 'San Diego'}`,
    metaTitle: 'Hot Stone Massage in San Diego | Unique Spa House',
    metaDescription: `Hot stone massage in Mission Valley, San Diego. Smooth, warm stones plus massage. ${priceOf('hot-stone')} for ${lengthOf(getService('hot-stone').options[0])}. Book online.`,
    lede: 'Smooth, warm stones plus massage. Deep warmth, even at gentle pressure.',
    image: 'hands-4x5', imageRatio: '4 / 5',
    facts: [
      { label: 'Pressure', value: 'Gentle pressure, with warm stones.' },
      { label: 'Good for', value: 'Anyone who loves warmth.' },
      { label: 'What to wear', value: 'Undress to your comfort level. You stay covered with a sheet.' },
      { label: 'Afterwards', value: 'Get up slowly. Most people simply feel relaxed.' },
    ],
    differs: { q: 'How is hot stone massage different from other massages?', a: 'Your therapist uses smooth, warm stones as well as their hands. The warmth feels deep, even when the pressure stays gentle.' },
    what: [
      'Hot stone massage combines massage with smooth, warm stones.',
      'The warmth is the point. It feels deep, even when the pressure stays gentle.',
      "Tell your therapist if a stone feels too warm or not warm enough, and they'll adjust straight away.",
      ...(addOn ? [`Want stones with a different massage? Add ${addOn.name} to any massage: ${addOnText}, chosen when you book.`] : []),
    ],
    whoIntro: 'Not sure it suits you? Your therapist will help you choose on the day.',
    who: [
      'Anyone who loves warmth',
      'Anyone who prefers gentle pressure',
      'Anyone who wants to switch off for an hour',
    ],
    stepsIntro: 'No rushing. You can ask questions at any point.',
    steps: [
      { t: 'A short chat first', d: 'Your goals, the pressure you like and any health conditions.' },
      { t: 'You get settled', d: 'A private room with soft lighting and quiet music. You stay covered with a sheet.' },
      { t: 'Warm stones and massage', d: 'Smooth, warm stones, together with hands-on massage.' },
      { t: 'Check-ins on warmth', d: 'Say if a stone feels too warm or not warm enough.' },
      { t: 'Time for questions', d: 'When your session ends, ask anything you like.' },
    ],
    feelsLead: 'Deep warmth, even at gentle pressure.',
    feels: [
      'The stones should feel comfortably warm. Speak up at any point and your therapist will adjust.',
      'Afterwards, most people simply feel relaxed. Get up slowly, and have some water.',
    ],
    pricesIntro: `Hot stone massage is ${lengthOf(getService('hot-stone').options[0])}, at ${where('hot-stone') === 'both spas' ? 'both spas' : 'our San Diego spa'}.`,
    compareTitle: 'Hot stone or another massage?',
    compare: [
      { q: 'Hot stone or Swedish?', a: `Swedish is hands only, with long, flowing strokes and light to medium pressure. It's ${priceOf('swedish', 60)} for 60 min, at both spas.` },
      ...(addOn ? [{ q: 'A full hot stone massage, or stones as an add-on?', a: `Hot stone massage is a full ${lengthOf(getService('hot-stone').options[0])} session with stones. The add-on puts ${addOn.name} into any other massage for ${addOnText}.` }] : []),
    ],
    before: MASSAGE_BEFORE,
    after: ['Get up slowly. You may feel a little dazed.', 'Have some water, and keep the rest of the day easy if you can.'],
    faqTitle: 'Hot stone massage questions',
    faqs: [
      { q: 'Are the stones very hot?', a: "They should feel comfortably warm. Tell your therapist straight away if a stone feels too warm, and they'll adjust." },
      { q: 'Can I book hot stone massage in Del Mar?', a: where('hot-stone') === 'both spas' ? 'Yes. It is bookable at both spas.' : `No. Hot stone massage is at our San Diego (Mission Valley) spa.${addOnAtDM ? ' In Del Mar, you can add hot stones to any massage when you book.' : ''}` },
      ...(addOn ? [{ q: 'Can I add hot stones to another massage?', a: `Yes. Add ${addOn.name} to any massage: ${addOnText}, chosen when you book.` }] : []),
      { q: 'What should I wear?', a: WEAR },
      costQa('hot-stone', 'hot stone massage'),
      giftQa('hot-stone', 'a hot stone massage'),
    ],
    related: [
      { service: 'swedish', summary: 'Long, flowing strokes with light to medium pressure. A great first massage.' },
      { service: 'relaxing', summary: 'A slow, soothing full session, just for unwinding.' },
      { service: 'lymphatic', summary: 'Very gentle, rhythmic strokes. Our only massage with gentle tummy work.' },
    ],
  });

  // ------------------------------------------------------------------ Prenatal
  if (findLiveService('prenatal')) add({
    service: 'prenatal', group: 'massage', short: 'Prenatal massage',
    eyebrow: 'For pregnancy',
    title: 'Prenatal massage in San Diego and Del Mar',
    metaTitle: 'Prenatal Massage in San Diego & Del Mar | Unique Spa House',
    metaDescription: `Prenatal massage in Mission Valley, San Diego and Del Mar. Positioning and pressure adjusted for each stage of pregnancy. ${priceOf('prenatal')} for ${lengthOf(getService('prenatal').options[0])}.`,
    lede: 'Designed for pregnancy. Positioning, pressure and technique are adjusted for each stage. Please check with your doctor or midwife first.',
    image: 'hands-4x5', imageRatio: '4 / 5',
    facts: [
      { label: 'Pressure', value: 'Adjusted for each stage of pregnancy.' },
      { label: 'Before you book', value: 'Please check with your doctor or midwife first.' },
      { label: 'What to wear', value: 'Undress to your comfort level. You stay covered with a sheet.' },
      { label: 'Afterwards', value: 'Get up slowly, and have some water.' },
    ],
    differs: { q: 'How is prenatal massage different from other massages?', a: "It's designed for pregnancy. Positioning, pressure and technique are adjusted for each stage. Please check with your doctor or midwife first." },
    what: [
      'Prenatal massage is designed for pregnancy. Positioning, pressure and technique are adjusted for each stage.',
      'Tell us how far along you are when you book, and again at your visit, so your therapist can set up for you.',
      'Please check with your doctor or midwife before you book. They know your pregnancy; we follow their advice.',
      ...(findLiveService('postnatal') ? [`After your baby arrives, our postnatal massage is ${priceOf('postnatal')} for ${lengthOf(getService('postnatal').options[0])}, at ${where('postnatal')}.`] : []),
    ],
    whoIntro: "Not sure it's right for you? Ask your doctor or midwife first, then call us with any questions.",
    who: [
      'Expecting parents, once a doctor or midwife has said massage is OK',
      "Anyone who'd like a quiet hour that's all about them",
      'Partners looking for a gift for an expecting parent',
    ],
    stepsIntro: 'No rushing. You can change position or stop at any point.',
    steps: [
      { t: 'A short chat first', d: "How far along you are, how you're feeling and what your doctor or midwife has said." },
      { t: 'You get settled', d: 'A private room with soft lighting and quiet music. Positioning is adjusted for your stage and comfort.' },
      { t: 'Your massage', d: "Pressure and technique are adjusted for pregnancy. Say if you'd like anything changed." },
      { t: 'Time to come round', d: 'Get up slowly, have some water, and ask anything you like before you go.' },
    ],
    feelsLead: "An hour that's all about you.",
    feels: [
      "Your therapist checks in on comfort and positioning throughout. Tell them if you'd like to move, pause or stop.",
      "We'll never promise more than a calm, comfortable massage. For anything about your pregnancy, your doctor or midwife is the right person to ask.",
    ],
    pricesIntro: `Prenatal massage is ${lengthOf(getService('prenatal').options[0])}, at ${where('prenatal')}.`,
    compareTitle: 'Prenatal or another massage?',
    compare: [
      ...(findLiveService('postnatal') ? [{ q: 'Prenatal or postnatal?', a: `Prenatal is for pregnancy. Postnatal is for after your baby arrives: an hour that's all about you, with positioning and pressure adjusted for comfort. It's ${priceOf('postnatal')}.` }] : []),
      { q: 'Prenatal or lymphatic?', a: 'If you are pregnant, prenatal massage is the one designed for it. For lymphatic massage during pregnancy, please check with your doctor or midwife first, and tell us when you book.' },
    ],
    before: [
      'Check with your doctor or midwife before you book.',
      'Tell us how far along you are when you book.',
      'Arrive a few minutes early to fill in a short form.',
      'Tell us about health conditions, or allergies to oils or scents.',
    ],
    after: ['Get up slowly. You may feel a little dazed.', 'Have some water, and keep the rest of the day easy if you can.', 'Tell us next time how you felt, so we can adjust the session.'],
    faqTitle: 'Prenatal massage questions',
    faqs: [
      { q: 'Can I book at any stage of pregnancy?', a: 'Please check with your doctor or midwife first, and tell us how far along you are when you book. Positioning, pressure and technique are adjusted for each stage.' },
      { q: 'How will I be positioned?', a: "Your therapist adjusts positioning for your stage and comfort. Tell them if you'd like to change position at any point." },
      { q: 'Can I book prenatal massage in Del Mar?', a: offeredAt(getService('prenatal'), 'DM') ? 'Yes. Prenatal massage is bookable at both spas, at the same price.' : 'Prenatal massage is booked at our San Diego spa.' },
      costQa('prenatal', 'prenatal massage'),
      ...(findLiveService('postnatal') ? [{ q: 'Do you offer massage after the baby arrives?', a: `Yes. Our postnatal massage is ${priceOf('postnatal')} for ${lengthOf(getService('postnatal').options[0])}, at ${where('postnatal')}.` }] : []),
      giftQa('prenatal', 'a prenatal massage'),
    ],
    related: [
      { service: 'postnatal', summary: "An hour that's all about you, after your baby arrives." },
      { service: 'swedish', summary: 'Long, flowing strokes with light to medium pressure. A great first massage.' },
      { service: 'foot', summary: '30 minutes for tired feet.' },
    ],
  });

  // ------------------------------------------------------------------ BABOR Sculpt & Lift
  if (findLiveService('babor-sculpt-lift')) {
    const id = 'babor-sculpt-lift';
    const n = displayName(id);
    const len = lengthOf(getService(id).options[0]);
    const both = offeredAt(getService(id), 'DM');
    add({
      service: id, group: 'facials', short: n,
      eyebrow: both ? 'At both spas' : 'At our San Diego spa',
      title: `${n} in ${both ? 'San Diego and Del Mar' : 'San Diego'}`,
      metaTitle: 'BABOR Sculpt & Lift Ritual | Unique Spa House',
      metaDescription: `The ${n}: a sculpting face massage, a BABOR lifting ampoule, an anti-wrinkle mask and LED light. ${len}, ${priceOf(id)}. Book online.`,
      lede: 'A sculpting face massage, a BABOR lifting ampoule (a sealed serum vial), an anti-wrinkle mask and LED light.',
      image: 'facial-1x1', imageRatio: '1 / 1',
      facts: [
        { label: 'What it includes', value: 'Sculpting face massage, a BABOR ampoule, a mask and LED light.' },
        { label: 'Good for', value: 'Anyone who wants firm, hands-on face massage.' },
        { label: 'Before you come', value: 'Skip harsh exfoliants and retinol for 48 hours.' },
        { label: 'Afterwards', value: 'Go gently with your routine for a day or two.' },
      ],
      differs: { q: `How is the ${n} different from other facials?`, a: "It's built around hands-on sculpting face massage, with a BABOR lifting ampoule, an anti-wrinkle mask and LED light. Like every facial here, it starts with a short skin check." },
      what: [
        `The ${n} is a ${len} facial built around hands-on sculpting face massage.`,
        'It includes a BABOR lifting ampoule: a small sealed vial of concentrated serum, opened fresh for your facial. Then an anti-wrinkle mask and LED light.',
        'Like every facial here, it starts with a short skin check and a chat about your goals. Your esthetician chooses the products for your skin on the day.',
        both ? "It's bookable at our Del Mar spa as well as in San Diego." : "It's booked at our San Diego (Mission Valley) spa.",
      ],
      whoIntro: "Not sure where to start? Book the Signature custom facial and we'll tailor it on the day.",
      who: [
        'Anyone who wants firm, hands-on face massage',
        'People who hold tension in the jaw and face',
        'Anyone with an event coming up',
        'Anyone who enjoys a longer, unhurried facial',
      ],
      stepsIntro: 'Four steps, at your pace.',
      steps: [
        ...FACIAL_STEPS,
        { t: 'Your facial', d: 'Sculpting face massage, the BABOR ampoule, an anti-wrinkle mask and LED light, in a calm, private room.' },
        { t: 'Aftercare', d: 'Simple tips and product ideas for home.' },
      ],
      feelsLead: 'Hands-on, firm and unhurried.',
      feels: [
        'The massage is firm but should always feel comfortable. Tell your esthetician if you would like it gentler.',
        'We describe what the facial is and how it feels, not what it will do. Skin is different for everyone, and we will never promise a result.',
      ],
      pricesIntro: `${len}, at ${where(id)}. Booking opens in a new tab.`,
      compareTitle: 'Sculpt & Lift or another facial?',
      compare: [
        ...(findLiveService('face-sculpture') ? [{ q: 'Sculpt & Lift or a sculpting face massage?', a: `Prefer hands-on face massage without the facial steps? ${displayName('face-sculpture')} works the face, jawline and neck. It's ${priceList('face-sculpture')} (${where('face-sculpture')}).` }] : []),
        ...(findLiveService('babor-deep-cleanse') ? [{ q: 'Sculpt & Lift or Deep Cleanse & Glow?', a: `The ${displayName('babor-deep-cleanse')} is a thorough deep clean with extractions. It's ${priceOf('babor-deep-cleanse')} (${where('babor-deep-cleanse')}). <a href="${PATHS['babor-deep-cleanse']}">About Deep Cleanse & Glow</a>.` }] : []),
        ...(findLiveService('signature-facial') ? [{ q: 'Not sure which facial?', a: `Book our ${inText(displayName('signature-facial'))}. We tailor it on the day, after a skin check. <a href="${PATHS['signature-facial']}">About the Signature custom facial</a>.` }] : []),
      ],
      before: FACIAL_BEFORE,
      after: FACIAL_AFTER,
      faqTitle: 'Sculpt & Lift questions',
      faqs: [
        BABOR,
        { q: 'What is an ampoule?', a: `A small sealed vial of concentrated serum, opened fresh for your facial. The ${n} includes a BABOR lifting ampoule.` },
        { q: `Can I book the ${n} in Del Mar?`, a: both ? 'Yes. It is bookable at both spas, at the same price.' : 'It is booked at our San Diego (Mission Valley) spa.' },
        FACIAL_OFTEN,
        FACIAL_PREP,
        costQa(id, `the ${n}`),
        giftQa(id, `the ${n}`),
      ],
      related: [
        { service: 'face-sculpture' },
        { service: 'babor-deep-cleanse' },
        { service: 'signature-facial' },
      ],
    });
  }

  // ------------------------------------------------------------------ BABOR Deep Cleanse & Glow
  if (findLiveService('babor-deep-cleanse')) {
    const id = 'babor-deep-cleanse';
    const n = displayName(id);
    const len = lengthOf(getService(id).options[0]);
    const both = offeredAt(getService(id), 'DM');
    add({
      service: id, group: 'facials', short: n,
      eyebrow: both ? 'At both spas' : 'At our San Diego spa',
      title: `${n} in ${both ? 'San Diego and Del Mar' : 'San Diego'}`,
      metaTitle: 'BABOR Deep Cleanse & Glow Ritual | Unique Spa House',
      metaDescription: `The ${n}: a deep cleanse with extractions, with ultrasound, high frequency or a peel added if your skin needs them. ${len}, ${priceOf(id)}.`,
      lede: 'A deep cleanse with extractions. Ultrasound, high frequency or a peel are added if your skin needs them.',
      image: 'facial-1x1', imageRatio: '1 / 1',
      facts: [
        { label: 'What it includes', value: 'A deep cleanse with extractions. Extra steps only if your skin needs them.' },
        { label: 'Good for', value: 'Congested skin, or anyone who wants a thorough deep clean.' },
        { label: 'Before you come', value: 'Skip harsh exfoliants and retinol for 48 hours.' },
        { label: 'Afterwards', value: 'Go gently with your routine for a day or two.' },
      ],
      differs: { q: `How is the ${n} different from other facials?`, a: "It's our most thorough deep clean, with extractions. Ultrasound, high frequency or a peel are added only if your skin needs them, and your esthetician explains each step first." },
      what: [
        `The ${n} is our thorough deep clean: a deep cleanse with extractions.`,
        "Ultrasound, high frequency or a peel are added if your skin needs them. Your esthetician explains each step before starting, and adjusts if you'd like to skip one.",
        'Like every facial here, it starts with a short skin check and a chat about your goals. The BABOR products are chosen for your skin on the day.',
        both ? "It's bookable at both spas." : "It's booked at our San Diego (Mission Valley) spa.",
      ],
      whoIntro: "Not sure where to start? Book the Signature custom facial and we'll tailor it on the day.",
      who: [
        'Congested skin',
        'Anyone who wants a thorough deep clean',
        "Anyone whose home routine isn't giving them the results they want",
      ],
      stepsIntro: 'Four steps, at your pace.',
      steps: [
        ...FACIAL_STEPS,
        { t: 'Your facial', d: 'A deep cleanse with extractions, in a calm, private room. Extra steps only if your skin needs them.' },
        { t: 'Aftercare', d: 'Simple tips and product ideas for home.' },
      ],
      feelsLead: 'Thorough, careful and explained as we go.',
      feels: [
        "Extractions can feel a little uncomfortable for a moment. Tell your esthetician if you'd rather skip them, or any other step.",
        'We describe what the facial is and how it feels, not what it will do. Skin is different for everyone, and we will never promise a result.',
      ],
      pricesIntro: `${len}, at ${where(id)}. Booking opens in a new tab.`,
      compareTitle: 'Deep Cleanse & Glow or another facial?',
      compare: [
        ...(findLiveService('pure-detox') ? [{ q: `Deep Cleanse & Glow or ${displayName('pure-detox').replace(/ facial$/, '')}?`, a: `The ${displayName('pure-detox')} is a shorter BABOR facial for oily, congested or breakout-prone skin: ${priceList('pure-detox')} (${where('pure-detox')}). Deep Cleanse & Glow is the longer, more thorough deep clean.` }] : []),
        ...(findLiveService('express-hydration') ? [{ q: 'Dry or tired skin instead?', a: `Try ${displayName('express-hydration')}: a quick BABOR boost with hyaluronic serums, a gentle enzyme exfoliation and a hydro-gel mask. It's ${priceList('express-hydration')} (${where('express-hydration')}).` }] : []),
        ...(findLiveService('signature-facial') ? [{ q: 'Not sure which facial?', a: `Book our ${inText(displayName('signature-facial'))}. We tailor it on the day, after a skin check. <a href="${PATHS['signature-facial']}">About the Signature custom facial</a>.` }] : []),
      ],
      before: FACIAL_BEFORE,
      after: FACIAL_AFTER,
      faqTitle: 'Deep Cleanse & Glow questions',
      faqs: [
        { q: 'Does it include extractions?', a: "Yes. Tell us if you'd rather skip them." },
        { q: 'Will I always have ultrasound, high frequency or a peel?', a: 'Only if your skin needs them. Your esthetician explains each step before starting, and you can skip one.' },
        BABOR,
        { q: `Can I book the ${n} in Del Mar?`, a: both ? 'Yes. It is bookable at both spas.' : 'No. It is booked at our San Diego (Mission Valley) spa.' },
        FACIAL_OFTEN,
        FACIAL_PREP,
        costQa(id, `the ${n}`),
      ],
      related: [
        { service: 'pure-detox' },
        { service: 'express-hydration' },
        { service: 'signature-facial' },
      ],
    });
  }

  // ------------------------------------------------------------------ Signature custom facial
  if (findLiveService('signature-facial')) {
    const id = 'signature-facial';
    const n = displayName(id);
    const len = lengthOf(getService(id).options[0]);
    const both = offeredAt(getService(id), 'DM');
    add({
      service: id, group: 'facials', short: n,
      eyebrow: 'Not sure where to start? Start here',
      title: `${n} in ${both ? 'San Diego and Del Mar' : 'San Diego'}`,
      metaTitle: 'Signature Custom Facial in San Diego | Unique Spa House',
      metaDescription: `Our ${n} starts with a skin check. Then cleansing, exfoliation, gentle extractions, a mask, massage and hydration, all chosen for your skin. ${len}.`,
      lede: 'Starts with a skin check. Then cleansing, exfoliation, gentle extractions, a mask, massage and hydration, all chosen for your skin.',
      image: 'facial-1x1', imageRatio: '1 / 1',
      facts: [
        { label: 'What it includes', value: 'Cleansing, exfoliation, gentle extractions, a mask, massage and hydration.' },
        { label: 'Good for', value: "Anyone who isn't sure which facial to book." },
        { label: 'Before you come', value: 'Skip harsh exfoliants and retinol for 48 hours.' },
        { label: 'Afterwards', value: 'Go gently with your routine for a day or two.' },
      ],
      differs: { q: `How is the ${n} different from the BABOR facials?`, a: "It isn't a set menu. We check your skin first, then choose each step and product for you on the day. The price is set at your visit, and we tell you before we start." },
      what: [
        `Not sure where to start? Book the ${n}. We tailor it on the day.`,
        'It starts with a skin check. Then cleansing, exfoliation, gentle extractions, a mask, massage and hydration, all chosen for your skin.',
        `It runs ${len}, depending on what your skin needs.`,
        "The price is set at your visit, once we've checked your skin and agreed what it needs. We'll tell you before we start.",
      ],
      whoIntro: 'Good skin starts with knowing your skin. This is the facial for that.',
      who: [
        "Anyone who isn't sure which facial to book",
        'Skin that feels dull, dry or tired',
        'Congested or breakout-prone skin',
        'Anyone having a first facial with us',
      ],
      stepsIntro: 'Four steps, at your pace.',
      steps: [
        ...FACIAL_STEPS,
        { t: 'Your facial', d: 'In a calm, private room, with every step and product chosen for your skin.' },
        { t: 'Aftercare', d: 'Simple tips and product ideas for home.' },
      ],
      feelsLead: 'Tailored, calm and explained as we go.',
      feels: [
        "We explain each step before we start. Tell us if you'd rather skip one, such as extractions.",
        'We describe what the facial is and how it feels, not what it will do. Skin is different for everyone, and we will never promise a result.',
      ],
      pricesIntro: `${len}, at ${where(id)}. The price is set at your visit, and we tell you before we start.`,
      compareTitle: 'Signature or a BABOR facial?',
      compare: [
        ...(findLiveService('express-hydration') ? [{ q: 'Dry or tired skin?', a: `${displayName('express-hydration')} is a quick BABOR boost: ${priceList('express-hydration')} (${where('express-hydration')}).` }] : []),
        ...(findLiveService('babor-deep-cleanse') ? [{ q: 'Want a thorough deep clean?', a: `The ${displayName('babor-deep-cleanse')} is ${priceOf('babor-deep-cleanse')} (${where('babor-deep-cleanse')}). <a href="${PATHS['babor-deep-cleanse']}">About Deep Cleanse & Glow</a>.` }] : []),
        ...(findLiveService('babor-sculpt-lift') ? [{ q: 'Want firm, hands-on face massage?', a: `The ${displayName('babor-sculpt-lift')} is ${priceOf('babor-sculpt-lift')} (${where('babor-sculpt-lift')}). <a href="${PATHS['babor-sculpt-lift']}">About Sculpt & Lift</a>.` }] : []),
      ],
      before: FACIAL_BEFORE,
      after: FACIAL_AFTER,
      faqTitle: 'Signature custom facial questions',
      faqs: [
        { q: `How much is the ${n}?`, a: "The price is set at your visit, once we've checked your skin and agreed what it needs. We'll tell you before we start." },
        { q: 'How long does it take?', a: `${len.charAt(0).toUpperCase() + len.slice(1)}, depending on what your skin needs.` },
        { q: `Can I book the ${n} in Del Mar?`, a: both ? 'Yes. It is bookable at both spas.' : 'No. It is booked at our San Diego (Mission Valley) spa.' },
        { q: 'Does it include extractions?', a: "It includes gentle extractions where needed. Tell us if you'd rather skip them." },
        FACIAL_OFTEN,
        FACIAL_PREP,
        { q: 'Should I come without makeup?', a: "If you can. It's no problem if not; cleansing is always the first step." },
      ],
      related: [
        { service: 'express-hydration' },
        { service: 'babor-deep-cleanse' },
        { service: 'babor-sculpt-lift' },
      ],
    });
  }

  // ------------------------------------------------------------------ Wrap Me Up
  if (findLiveService('wrap-me-up')) {
    const id = 'wrap-me-up';
    const w = getService(id);
    const plus = w.options.find((o) => /massage/i.test(o.label));
    const base = w.options.find((o) => !/massage/i.test(o.label)) ?? w.options[0];
    const single = whereText(w) !== 'both spas';
    const spaWord = single ? whereText(w).replace(/ only$/, '') : 'San Diego and Del Mar';
    add({
      service: id, group: 'body', short: 'Wrap Me Up body wrap',
      eyebrow: single ? `Only at ${spaWord}` : 'At both spas',
      title: `Wrap Me <em>Up</em> body wrap in ${spaWord}`,
      metaTitle: `Wrap Me Up Body Wrap in ${spaWord} | Unique Spa House`,
      metaDescription: `Wrap Me Up, a warming body wrap in ${spaWord}. ${lengthOf(base)}, ${priceOf(id, base.minutes)}.${plus ? ' Add a 60 min massage if you like.' : ''} Book online.`,
      lede: `A warming body wrap. Relax while you're cocooned.${plus ? ' Add a 60 min massage if you like.' : ''}`,
      image: 'wrap-me-up', imageRatio: '4 / 3',
      facts: [
        { label: 'How it feels', value: 'Warm and cocooned, with time to rest.' },
        { label: 'Good to know', value: "It isn't a fat-loss treatment." },
        { label: 'Before you come', value: 'Skip lotion and oil on the day.' },
        { label: 'Afterwards', value: 'Keep drinking water, and moisturize daily.' },
      ],
      differs: { q: 'What is the Wrap Me Up body wrap?', a: `A warming body wrap: quiet time to rest while you're cocooned.${plus ? ` You can book it on its own, or followed by a 60 min massage.` : ''}` },
      what: [
        "Wrap Me Up is our body wrap: warm, quiet time while you're cocooned.",
        plus ? 'Book it on its own, or followed by a 60 min massage.' : 'It is booked as one session.',
        "Good to know: it isn't a fat-loss treatment, and it won't change your shape or size. It's about warmth and time to rest.",
      ],
      whoIntro: 'Not sure it suits you? Call us and we will talk it through.',
      who: [
        "Anyone who'd love to be warm and cocooned for an hour",
        "Anyone who'd like some time out before a vacation or an event",
        'Anyone who wants to switch off',
      ],
      checkTitle: 'Check with your doctor first if you',
      check: ['Are pregnant', 'Have blood clots or varicose veins', 'Have a skin infection, or recently had surgery'],
      stepsIntro: 'No rushing. You can ask questions at any point.',
      steps: [
        { t: 'A short chat', d: 'Your goals, your skin and any health conditions.' },
        { t: 'Your wrap', d: 'A warm wrap while you rest.' },
        ...(plus ? [{ t: 'Your massage, if you booked one', d: 'A 60 min massage follows the wrap.' }] : []),
        { t: 'Time to come round', d: 'Get up slowly, have some water, and ask anything you like before you go.' },
      ],
      feelsLead: 'Warm, quiet and cocooned.',
      feels: [
        "Tell your therapist if you feel too warm, or would like to stop at any point. They'll adjust straight away.",
        "It isn't a fat-loss treatment, and it won't change your shape or size. We'll never promise more than warmth and time to rest.",
      ],
      pricesIntro: single ? `Wrap Me Up is booked at our ${spaWord} spa.` : 'Bookable at both spas.',
      lengthNotes: {
        [base.label]: 'The wrap on its own.',
        ...(plus ? { [plus.label]: 'The wrap, followed by a 60 min massage.' } : {}),
      },
      before: ['Drink plenty of water.', 'Skip lotion and oil on the day.', 'Tell us about allergies, pregnancy or recent surgery.'],
      after: ['Keep drinking water.', 'Avoid harsh exfoliants for 24 hours.', 'Moisturize daily.'],
      faqTitle: 'Wrap Me Up questions',
      faqs: [
        { q: 'Where can I book a body wrap?', a: single ? `Wrap Me Up is only at our ${spaWord} spa.` : 'Wrap Me Up is bookable at both spas.' },
        ...(plus ? [{ q: 'Can I add a massage?', a: `Yes. Add a 60 min massage: ${priceOf(id, plus.minutes)} for the ${plus.label.replace(/,.*$/, '')} visit.` }] : []),
        { q: 'Will it help me lose fat?', a: "No. It isn't a fat-loss treatment, and it won't change your shape or size. It's about warmth and time to rest." },
        costQa(id, 'Wrap Me Up'),
        giftQa(id, 'a Wrap Me Up body wrap'),
      ],
      related: [
        { service: 'anti-cellulite', summary: 'Brisk, firm massage for thighs, hips and buttocks, at an energetic pace.' },
        { service: 'hot-stone', summary: 'Smooth, warm stones plus massage. Deep warmth, even at gentle pressure.' },
        { service: 'relaxing', summary: 'A slow, soothing full session, just for unwinding.' },
      ],
    });
  }

  return list;
}

export const TREATMENTS: Treatment[] = build();

export function treatmentsIn(group: Group): Treatment[] {
  return TREATMENTS.filter((t) => t.group === group);
}

export function treatmentFor(serviceId: string): Treatment | null {
  return TREATMENTS.find((t) => t.service === serviceId) ?? null;
}

/** "From $120" | "$186" | "Price set at your visit". Catalog prices only. */
export function priceFrom(s: Service): string {
  const prices = s.options.map((o) => o.price).filter((p): p is number => p != null);
  if (!prices.length) return priceOf(s.id);
  const min = Math.min(...prices);
  return new Set(prices).size > 1 ? `From ${formatPrice(min)}` : formatPrice(min);
}
