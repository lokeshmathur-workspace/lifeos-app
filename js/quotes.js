// Ported verbatim from lifeos-rebuild/reference/reference-app.html — the same
// 44-entry curated library. The app picks an index from this list; it never asks
// an AI to write a quote, so nothing is ever put in someone's mouth.
export const QUOTES = [
 ["You have power over your mind — not outside events. Realize this, and you will find strength.","Marcus Aurelius"],
 ["The impediment to action advances action. What stands in the way becomes the way.","Marcus Aurelius"],
 ["Waste no more time arguing about what a good man should be. Be one.","Marcus Aurelius"],
 ["We suffer more often in imagination than in reality.","Seneca"],
 ["It is not that we have a short time to live, but that we waste a lot of it.","Seneca"],
 ["Difficulties strengthen the mind, as labour does the body.","Seneca"],
 ["He who is brave is free.","Seneca"],
 ["First say to yourself what you would be; and then do what you have to do.","Epictetus"],
 ["No man is free who is not master of himself.","Epictetus"],
 ["The unexamined life is not worth living.","Socrates"],
 ["We are what we repeatedly do. Excellence, then, is not an act, but a habit.","Will Durant"],
 ["Knowing yourself is the beginning of all wisdom.","Aristotle"],
 ["The journey of a thousand miles begins with a single step.","Lao Tzu"],
 ["It does not matter how slowly you go as long as you do not stop.","Confucius"],
 ["Well done is better than well said.","Benjamin Franklin"],
 ["Either write something worth reading or do something worth writing.","Benjamin Franklin"],
 ["The best way out is always through.","Robert Frost"],
 ["Do not go where the path may lead, go instead where there is no path and leave a trail.","Ralph Waldo Emerson"],
 ["That which does not kill us makes us stronger.","Friedrich Nietzsche"],
 ["Concentrate all your thoughts upon the work at hand. The sun's rays do not burn until brought to a focus.","Alexander Graham Bell"],
 ["Nothing will work unless you do.","Maya Angelou"],
 ["You can't use up creativity. The more you use, the more you have.","Maya Angelou"],
 ["Success is not final, failure is not fatal: it is the courage to continue that counts.","Winston Churchill"],
 ["However difficult life may seem, there is always something you can do and succeed at.","Stephen Hawking"],
 ["It always seems impossible until it's done.","Nelson Mandela"],
 ["The greatest glory in living lies not in never falling, but in rising every time we fall.","Nelson Mandela"],
 ["Yesterday I was clever, so I wanted to change the world. Today I am wise, so I am changing myself.","Rumi"],
 ["The wound is the place where the light enters you.","Rumi"],
 ["Live as if you were to die tomorrow. Learn as if you were to live forever.","Mahatma Gandhi"],
 ["Be the change that you wish to see in the world.","Mahatma Gandhi"],
 ["Arise, awake, and stop not till the goal is reached.","Swami Vivekananda"],
 ["You have the right to work, but never to the fruit of work.","The Bhagavad Gita"],
 ["Excellence is a continuous process and not an accident.","A. P. J. Abdul Kalam"],
 ["Dream is not that which you see while sleeping, it is something that does not let you sleep.","A. P. J. Abdul Kalam"],
 ["Peace comes from within. Do not seek it without.","Attributed to the Buddha"],
 ["What we think, we become.","Attributed to the Buddha"],
 ["The best time to plant a tree was twenty years ago. The second best time is now.","Chinese proverb"],
 ["Fall seven times, stand up eight.","Japanese proverb"],
 ["If you want to go fast, go alone. If you want to go far, go together.","African proverb"],
 ["A goal without a plan is just a wish.","Antoine de Saint-Exupéry"],
 ["Simplicity is the ultimate sophistication.","Attributed to Leonardo da Vinci"],
 ["The secret of getting ahead is getting started.","Attributed to Mark Twain"],
 ["In the middle of difficulty lies opportunity.","Attributed to Albert Einstein"],
 ["Whether you think you can or you think you can't, you're right.","Attributed to Henry Ford"]
];

// Deterministic pick so the same day always shows the same quote until shuffled.
export const quoteForDate = (d) => {
  let h = 0;
  for (const ch of d) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const q = QUOTES[h % QUOTES.length];
  return { text: q[0], author: q[1], why: "" };
};

export const randomQuote = (excludeText) => {
  let q;
  do {
    q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  } while (q[0] === excludeText && QUOTES.length > 1);
  return { text: q[0], author: q[1], why: "" };
};
