// Turns entries from Google's India holiday calendar into City Events.
//
// Each rule matches a holiday by exact name and lists the cities where it
// matters for hotels. `span` stretches the event over the days around the
// listed date, e.g. Diwali is one calendar entry but a five-day travel period.
// `icon` is shown on the card; festivals without one get a general festive icon.
//
// Public holidays with no rule still show up, for every city. Observances with
// no rule are dropped: most are working days that don't matter for hotels.

const ALL = require("./cities").map((c) => c.id);

module.exports = [
  {
    match: "Diwali/Deepavali",
    name: "Diwali",
    category: "festival",
    icon: "🪔",
    span: [-1, 3], // Naraka Chaturdasi through Bhai Duj
    cities: ALL,
    note: "The year's biggest leisure travel week: Goa, Jaipur and Udaipur fill early, while corporate travel to the metros stops for the week.",
  },
  {
    match: "First Day of Sharad Navratri",
    name: "Navratri",
    category: "festival",
    icon: "💃",
    span: [0, 8], // nine nights
    cities: ["ahmedabad"],
    note: "Nine nights of garba across Ahmedabad. Big ticketed garba venues draw visitors from across Gujarat and abroad; banquets and F&B are busy every night.",
  },
  {
    match: "First Day of Durga Puja Festivities",
    name: "Durga Puja",
    category: "festival",
    icon: "🙏",
    span: [0, 4], // Shashthi through Bijoya Dashami
    cities: ["kolkata"],
    note: "Kolkata's biggest week. Pandal-hopping visitors fill the city and banquets are booked for Puja events.",
  },
  {
    match: "Dussehra",
    name: "Dussehra",
    category: "festival",
    icon: "🏹",
    cities: ALL,
    note: "Public holiday in most states, at the end of Navratri. Short leisure trips pick up; business travel pauses for the day.",
  },
  {
    match: "Ganesh Chaturthi",
    name: "Ganesh Chaturthi",
    category: "festival",
    icon: "🙏",
    span: [0, 10], // through Anant Chaturdashi (immersion)
    cities: ["mumbai", "pune"],
    note: "Ten-day festival that dominates Mumbai and Pune. Visitors come for the pandals; traffic and immersion days slow business travel.",
  },
  {
    match: "Onam",
    name: "Onam",
    category: "festival",
    icon: "🌼",
    span: [-1, 1],
    cities: ["kochi"],
    note: "Kerala's biggest festival. Families travel home and hotels see festive sadya (feast) and F&B demand; business travel slows.",
  },
  {
    match: "Christmas",
    name: "Christmas to New Year",
    category: "festival",
    icon: "🎄",
    span: [-1, 7], // Christmas Eve through New Year's Day
    cities: ALL,
    note: "Year-end holiday peak. Goa, Jaipur, Udaipur and Kochi see their highest rates of the year; metros see party and staycation demand while corporate travel pauses.",
  },
  {
    match: "Holi",
    name: "Holi",
    category: "festival",
    icon: "🎨",
    cities: ALL,
    note: "Public holiday across north, west and central India; not widely observed in the south. Jaipur and Udaipur draw visitors for the celebrations.",
  },
  {
    match: "Makar Sankranti",
    name: "Makar Sankranti / Uttarayan",
    category: "festival",
    icon: "🪁",
    span: [0, 1], // Uttarayan and Vasi Uttarayan
    cities: ["jaipur", "ahmedabad"],
    note: "Kite festival days. Ahmedabad celebrates Uttarayan on rooftops across the city, and Jaipur's skies fill with kites; rooftop and F&B events do well.",
  },
  {
    match: "Pongal",
    name: "Pongal",
    category: "festival",
    icon: "🌾",
    span: [-1, 2], // Bhogi through Kaanum Pongal
    cities: ["chennai", "coimbatore"],
    note: "Tamil Nadu takes several days off; many people travel home and business travel into Chennai and Coimbatore slows.",
  },
  {
    match: "Maha Shivaratri",
    name: "Maha Shivaratri",
    category: "festival",
    icon: "🔱",
    cities: ["coimbatore"],
    note: "Isha Yoga Centre's all-night Mahashivratri celebration draws very large crowds to Coimbatore.",
  },
  {
    match: "Good Friday",
    name: "Good Friday",
    category: "holiday",
    cities: ALL,
    note: "Public holiday in most states. Goa and Kochi see Easter weekend travel.",
  },
  {
    match: "Ramzan Id (tentative)",
    name: "Eid ul-Fitr",
    category: "festival",
    icon: "🌙",
    cities: ALL,
    note: "Public holiday in most states; the exact date depends on the moon sighting. Hyderabad and Lucknow see strong festive and F&B demand.",
  },
  {
    match: "Mahatma Gandhi Jayanti",
    name: "Gandhi Jayanti",
    category: "holiday",
    cities: ALL,
    note: "National holiday; offices shut.",
  },
  {
    match: "Republic Day",
    name: "Republic Day",
    category: "holiday",
    cities: ALL,
    note: "National holiday. Central Delhi has security restrictions around the parade.",
  },
  {
    match: "Independence Day",
    name: "Independence Day",
    category: "holiday",
    cities: ALL,
    note: "National holiday; offices shut.",
  },
];

module.exports.ALL_CITIES = ALL;
