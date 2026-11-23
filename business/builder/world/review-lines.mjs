// What customers write in reviews. Lines are chosen by product, by how the order went and by the kind of
// customer, then joined, so a few thousand reviews do not repeat the same handful of sentences.
// Slots: {town} is the customer's town, {product} the product's name.

/** Lines about one product, by mood: good (4 or 5 stars), mixed (3) and bad (1 or 2). */
export const PRODUCT_LINES = {
  "spare-sock": {
    good: ["One sock, exactly as promised, and it matches the survivor.", "Finally a home for the odd sock in the drawer.", "Soft, warm and on its own. Perfect.", "The pair is whole again. I did not expect to feel this strongly about a sock."],
    mixed: ["Nice sock. The colour is a shade off the one it replaces.", "Does the job, though I now have a new odd sock somewhere."],
    bad: ["Went through at the heel in a month.", "The size ran small and it will not stay up."],
  },
  "emergency-sandwich": {
    good: ["Arrived cold, fresh and exactly when the fridge was empty.", "A proper sandwich in a proper box. Saved a long afternoon.", "The bread was soft and the filling generous.", "Ordered one in a panic, ordered three the week after on purpose."],
    mixed: ["Tasty, but the box was a little squashed.", "Good sandwich. Pricey for a sandwich, though it did come by courier."],
    bad: ["The bread had gone hard by the time it reached me.", "Filling was thin. Not much of an emergency fix."],
  },
  "paper-aeroplane": {
    good: ["Flies further than anything I could fold myself.", "Crossed the whole hall at {town} on its first go.", "Well folded, crisp paper, flies straight.", "The children have not stopped throwing it."],
    mixed: ["Flies well indoors, sulks outdoors in any wind.", "Fine plane. The nose bends after a few crashes."],
    bad: ["Nosedived every time.", "Arrived creased, so it flew in circles."],
  },
  "one-good-pen": {
    good: ["Writes smoothly and has not skipped once.", "Lovely weight in the hand. I hide it from colleagues.", "My signature has never looked so certain.", "The only pen on my desk now."],
    mixed: ["Good pen, but the ink takes a moment to dry.", "Writes well. The clip is a little stiff."],
    bad: ["Ran dry far sooner than I expected.", "Leaked in my coat pocket."],
  },
  "bubble-wrap": {
    good: ["Every bubble pops properly. Deeply satisfying.", "Wrapped a mirror for the move and it arrived in one piece.", "Thick, even bubbles. Better than the stuff parcels come in.", "Bought it to pack, kept it to pop."],
    mixed: ["Does the job. The roll was shorter than I pictured.", "Good bubbles, but a few were flat on arrival."],
    bad: ["Half the bubbles had already popped.", "Thin and tears easily."],
  },
  "other-umbrella": {
    good: ["Survived a proper gale without turning inside out.", "Keeps me dry and folds small enough for a coat pocket.", "Sturdy, quick to open, and the handle feels solid.", "Lent it once and had to ask for it back twice."],
    mixed: ["Keeps the rain off, but drips onto my shoulder.", "Good umbrella, slightly heavy to carry all day."],
    bad: ["A rib snapped in the first strong wind.", "The catch will not keep it closed."],
  },
  "ice-by-post": {
    good: ["Arrived still frozen. I am as surprised as anyone.", "Saved the garden party at {town}.", "Clear, solid ice, well packed.", "Exactly the right amount for an afternoon of drinks."],
    mixed: ["Mostly frozen. One bag had started to soften.", "Works, but I did have to be home to take it in quickly."],
    bad: ["Arrived as a bag of cold water.", "The box leaked all over the doorstep."],
  },
  daypack: {
    good: ["Fits everything for a day out and still looks smart.", "Comfortable straps, even on a long walk.", "The pockets are in the right places.", "Took it all round {town} and back without a complaint."],
    mixed: ["Good bag. The laptop sleeve is a tight fit.", "Well made, but the zip is stiff at first."],
    bad: ["The zip split within weeks.", "A strap started to come away at the seam."],
  },
  "indoor-helmet": {
    good: ["The low beam in the hall has finally met its match.", "Comfortable enough to forget I am wearing it.", "Light, padded, and I have not bumped my head since.", "Bought one for the cellar at {town}. Bought a second for the loft."],
    mixed: ["Does what it says. Looks a little odd at the dinner table.", "Good padding, the strap is fiddly."],
    bad: ["The strap clip broke in a week.", "The padding came loose inside."],
  },
  trophy: {
    good: ["Gave it for coming second in the pub quiz. Tears were shed.", "Heavy, shiny and engraved neatly.", "Pride of place on the mantelpiece at {town}.", "Exactly the right amount of ceremony for small victories."],
    mixed: ["Looks good. Smaller than the pictures made me think.", "Nice trophy, the engraving is a touch faint."],
    bad: ["The cup came loose from the stem.", "The plating rubbed off at the rim."],
  },
  blip: {
    good: ["Does one thing and does it well.", "Battery lasts for days and it just works.", "Small, clever and easy to set up.", "Replaced three gadgets in the drawer with this one."],
    mixed: ["Useful, though the instructions are brief.", "Good little device, the screen is hard to read in sunlight."],
    bad: ["Battery drains overnight.", "Stopped turning on after a month."],
  },
  "boombox-mini": {
    good: ["Big sound from a tiny box.", "Pairs instantly and the battery lasts all afternoon.", "The neighbours at {town} now know my taste in music.", "Clear at low volume and loud when I need it."],
    mixed: ["Good speaker. Crackles a little turned right up.", "Sounds great, but the charging cable is short."],
    bad: ["Will not charge any more.", "Bluetooth keeps dropping out."],
  },
  "pocket-jungle": {
    good: ["Arrived green, upright and happy.", "Brightens the windowsill no end.", "Easy to look after, even for me.", "Growing new leaves already."],
    mixed: ["Healthy plant, smaller than I hoped.", "Lovely, though a couple of leaves were bent in the post."],
    bad: ["Arrived wilted and never recovered.", "The pot cracked in transit."],
  },
  "skimming-stones": {
    good: ["Seven skips on the first throw.", "Flat, smooth and a pleasure to hold.", "Took them to the lake near {town}. Best afternoon in ages.", "A ridiculous thing to buy and I would buy it again."],
    mixed: ["Skim well, but I lost two on the first day.", "Nice stones. Fewer in the pouch than I expected."],
    bad: ["Sank like stones.", "One arrived chipped."],
  },
  "starter-puddle": {
    good: ["Exactly the right size for jumping in.", "The children are delighted and the floor is still dry.", "Well made and surprisingly hard to resist.", "Brought a little weather into the house."],
    mixed: ["Fun, though it is smaller than it looks.", "Good puddle, the edge has a small chip."],
    bad: ["Cracked along one side.", "The surface went cloudy quickly."],
  },
  "biscuit-tin": {
    good: ["A tin that keeps biscuits crisp, at last.", "Handsome on the shelf and the lid fits snugly.", "Filled it the day it came and emptied it the day after.", "The perfect present for a tea drinker."],
    mixed: ["Lovely tin, the lid is a little tight.", "Nice, but smaller inside than outside, somehow."],
    bad: ["Dented on arrival.", "The lid does not close properly."],
  },
};

/** Openings by kind of customer, used now and then before the product line. */
export const OPENERS = {
  gift: ["Bought as a present.", "A gift for a friend.", "Bought this for my family.", "Needed a present at short notice."],
  regular: ["Another order from here.", "Bought again.", "Not my first order and not my last.", "My usual order, and a new thing to try."],
  returner: ["I nearly sent this back.", "I was unsure at first.", "Took me a while to decide."],
  complainer: ["I do not often leave good reviews.", "Let me be precise.", "I have opinions."],
  business: ["Ordered for the office.", "For the team at work."],
};

/** Lines about the delivery, by how it went. */
export const DELIVERY_LINES = {
  fast: ["Arrived quickly.", "Here the next morning.", "Well packed.", "Delivery was painless."],
  late: ["Took longer than promised to arrive.", "The parcel was a few days late.", "Delivery let it down.", "Arrived after the date it said."],
};

/** Plain lines that fit any product, by star rating. */
export const GENERIC = {
  5: ["Exactly what it says. Very pleased.", "Daft idea, perfectly done.", "Would recommend.", "Better than I expected."],
  4: ["Good, does the job.", "Happy with it.", "Nice thing, fairly priced."],
  3: ["It is fine.", "Not sure it is worth the money.", "Middling."],
  2: ["Disappointed.", "Not as good as I hoped."],
  1: ["Not as described.", "Would not buy again."],
};

/**
 * Writes one review from the lines above.
 * @param {{pick: function, chance: function}} rng The review's own random stream.
 * @param {{rating: number, product: string, type: string, town: string, late: boolean}} about
 * @returns {string}
 */
export function reviewText(rng, { rating, product, type, town, late }) {
  const mood = rating >= 4 ? "good" : rating === 3 ? "mixed" : "bad";
  const lines = PRODUCT_LINES[product]?.[mood] || GENERIC[rating];
  const parts = [];
  if (OPENERS[type] && rng.chance(0.35)) parts.push(rng.pick(OPENERS[type]));
  parts.push(rng.pick(lines));
  if (late) parts.push(rng.pick(DELIVERY_LINES.late));
  else if (rating >= 4 && rng.chance(0.3)) parts.push(rng.pick(DELIVERY_LINES.fast));
  if (rng.chance(0.25)) parts.push(rng.pick(GENERIC[rating]));
  return parts.join(" ").replace(/\{town\}/g, town || "home");
}
