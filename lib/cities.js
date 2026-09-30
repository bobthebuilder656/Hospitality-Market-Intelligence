// The 15 markets the City Events tab covers.
//
// `lat`/`lon` are for the weather forecast. `seasons` describes the typical
// year: each entry covers months `from`..`to` (1-12, may wrap past December)
// and must together cover all 12 months.
module.exports = [
  {
    id: "mumbai",
    name: "Mumbai",
    lat: 19.076,
    lon: 72.8777,
    seasons: [
      { from: 10, to: 2, label: "Pleasant season, the busiest for events and weddings" },
      { from: 3, to: 5, label: "Hot and humid" },
      { from: 6, to: 9, label: "Monsoon (heavy rain, leisure travel slows)" },
    ],
  },
  {
    id: "delhi",
    name: "Delhi NCR",
    lat: 28.6139,
    lon: 77.209,
    seasons: [
      { from: 10, to: 3, label: "Winter (peak season for conferences, weddings and tourists)" },
      { from: 4, to: 6, label: "Hot summer (leisure travel drops)" },
      { from: 7, to: 9, label: "Monsoon" },
    ],
  },
  {
    id: "bengaluru",
    name: "Bengaluru",
    lat: 12.9716,
    lon: 77.5946,
    seasons: [
      { from: 10, to: 2, label: "Pleasant and dry" },
      { from: 3, to: 5, label: "Warmest months, still mild" },
      { from: 6, to: 9, label: "Monsoon (mild, frequent rain)" },
    ],
  },
  {
    id: "hyderabad",
    name: "Hyderabad",
    lat: 17.385,
    lon: 78.4867,
    seasons: [
      { from: 10, to: 2, label: "Pleasant winter season" },
      { from: 3, to: 6, label: "Hot summer" },
      { from: 7, to: 9, label: "Monsoon" },
    ],
  },
  {
    id: "chennai",
    name: "Chennai",
    lat: 13.0827,
    lon: 80.2707,
    seasons: [
      { from: 10, to: 12, label: "Northeast monsoon (the city's heaviest rain)" },
      { from: 1, to: 2, label: "Pleasant, cooler months" },
      { from: 3, to: 9, label: "Hot" },
    ],
  },
  {
    id: "kolkata",
    name: "Kolkata",
    lat: 22.5726,
    lon: 88.3639,
    seasons: [
      { from: 10, to: 2, label: "Festive and winter season" },
      { from: 3, to: 5, label: "Hot summer" },
      { from: 6, to: 9, label: "Monsoon" },
    ],
  },
  {
    id: "pune",
    name: "Pune",
    lat: 18.5204,
    lon: 73.8567,
    seasons: [
      { from: 10, to: 2, label: "Pleasant winter" },
      { from: 3, to: 5, label: "Hot summer" },
      { from: 6, to: 9, label: "Monsoon" },
    ],
  },
  {
    id: "goa",
    name: "Goa",
    lat: 15.4909,
    lon: 73.8278,
    seasons: [
      { from: 11, to: 2, label: "Peak tourist season" },
      { from: 3, to: 5, label: "Shoulder season (hot)" },
      { from: 6, to: 9, label: "Monsoon (off-season)" },
      { from: 10, to: 10, label: "Shoulder season (after the monsoon)" },
    ],
  },
  {
    id: "jaipur",
    name: "Jaipur",
    lat: 26.9124,
    lon: 75.7873,
    seasons: [
      { from: 10, to: 3, label: "Peak tourist season" },
      { from: 4, to: 6, label: "Off-season (very hot)" },
      { from: 7, to: 9, label: "Monsoon (shoulder season)" },
    ],
  },
  {
    id: "udaipur",
    name: "Udaipur",
    lat: 24.5854,
    lon: 73.7125,
    seasons: [
      { from: 10, to: 3, label: "Peak tourist season" },
      { from: 4, to: 6, label: "Off-season (very hot)" },
      { from: 7, to: 9, label: "Monsoon (lakes fill up, shoulder season)" },
    ],
  },
  {
    id: "ahmedabad",
    name: "Ahmedabad",
    lat: 23.0225,
    lon: 72.5714,
    seasons: [
      { from: 10, to: 2, label: "Pleasant winter (Navratri, Uttarayan and wedding season)" },
      { from: 3, to: 6, label: "Very hot summer" },
      { from: 7, to: 9, label: "Monsoon" },
    ],
  },
  {
    id: "kochi",
    name: "Kochi",
    lat: 9.9312,
    lon: 76.2673,
    seasons: [
      { from: 12, to: 2, label: "Peak tourist season" },
      { from: 3, to: 5, label: "Hot and humid" },
      { from: 6, to: 9, label: "Southwest monsoon (heavy rain, Ayurveda season)" },
      { from: 10, to: 11, label: "After the monsoon (shoulder season)" },
    ],
  },
  {
    id: "lucknow",
    name: "Lucknow",
    lat: 26.8467,
    lon: 80.9462,
    seasons: [
      { from: 10, to: 2, label: "Winter (wedding and festival season)" },
      { from: 3, to: 6, label: "Hot summer" },
      { from: 7, to: 9, label: "Monsoon" },
    ],
  },
  {
    id: "indore",
    name: "Indore",
    lat: 22.7196,
    lon: 75.8577,
    seasons: [
      { from: 10, to: 2, label: "Pleasant winter" },
      { from: 3, to: 6, label: "Hot summer" },
      { from: 7, to: 9, label: "Monsoon" },
    ],
  },
  {
    id: "coimbatore",
    name: "Coimbatore",
    lat: 11.0168,
    lon: 76.9558,
    seasons: [
      { from: 10, to: 12, label: "Northeast monsoon (moderate rain)" },
      { from: 1, to: 5, label: "Dry and warm" },
      { from: 6, to: 9, label: "Southwest monsoon (mild and breezy)" },
    ],
  },
];
