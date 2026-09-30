// India-focused hospitality, F&B and online-travel tickers for the Stock Prices
// tab. Prices are shown in each stock's own currency (all INR on NSE except
// MakeMyTrip, which is listed on NASDAQ in USD) — no conversion is done.
// `category` ("hotel" | "restaurant" | "ota") powers the tab's category filter.
// `domain` fetches a brand icon (Google's favicon service); `searchTerm` is
// used for related-news lookups where the legal entity name searches poorly;
// `excludePatterns` (optional, regex sources) strip look-alike phrases before
// keywords are matched — "Taj Mahal" the monument is not "Taj" the hotel brand
// (see companyMatch.js).
// `exactCaseKeywords` (optional) only match with their capitals: "Indian Hotels"
// the company, not "Indian hotels" in general.
// `matchKeywords` is a hard filter on news results (see fetchStockDetail.js)
// since search relevance ranking alone let unrelated articles through for a
// couple of the smaller/more ambiguous names.
module.exports = [
  // Hotels
  { id: "indian-hotels", name: "Indian Hotels Co. (Taj)", category: "hotel", symbol: "INDHOTEL.NS", domain: "tajhotels.com", searchTerm: "Indian Hotels Company Taj", matchKeywords: ["indian hotels company", "indian hotels co", "ihcl", "taj"], exactCaseKeywords: ["Indian Hotels"], excludePatterns: ["\\btaj mahal\\b(?!\\s+(?:palace|hotel))", "\\btaj\\s*gvk\\b", "\\btaj express\\b"] },
  { id: "eih", name: "EIH Ltd. (Oberoi)", category: "hotel", symbol: "EIHOTEL.NS", domain: "oberoihotels.com", searchTerm: "EIH Oberoi Hotels", matchKeywords: ["eih", "oberoi"], excludePatterns: ["\\boberoi (?:realty|mall|international school)\\b", "\\b(?:vivek|suresh|vikas|akshay) oberoi\\b"] },
  { id: "lemon-tree", name: "Lemon Tree Hotels", category: "hotel", symbol: "LEMONTREE.NS", domain: "lemontreehotels.com", matchKeywords: ["lemon tree"], excludePatterns: ["\\blemon tree\\b(?=.*\\b(?:grow|growing|plant|planting|garden|balcony|fruit|leaves|fertili[sz]er)\\b)"] },
  { id: "chalet", name: "Chalet Hotels", category: "hotel", symbol: "CHALET.NS", domain: "chalethotels.com", matchKeywords: ["chalet hotels"] },
  { id: "itc-hotels", name: "ITC Hotels", category: "hotel", symbol: "ITCHOTELS.NS", domain: "itchotels.com", matchKeywords: ["itc hotels"] },
  { id: "samhi", name: "SAMHI Hotels", category: "hotel", symbol: "SAMHI.NS", domain: "samhi.co.in", matchKeywords: ["samhi"] },
  { id: "juniper", name: "Juniper Hotels", category: "hotel", symbol: "JUNIPER.NS", domain: "juniperhotels.com", matchKeywords: ["juniper hotels"] },
  { id: "mahindra-holidays", name: "Mahindra Holidays & Resorts", category: "hotel", symbol: "MHRIL.NS", domain: "clubmahindra.com", searchTerm: "Mahindra Holidays Resorts", matchKeywords: ["mahindra holidays"] },
  { id: "royal-orchid", name: "Royal Orchid Hotels", category: "hotel", symbol: "ROHLTD.NS", domain: "royalorchidhotels.com", matchKeywords: ["royal orchid"] },

  // Restaurant / F&B chains
  { id: "jubilant-foodworks", name: "Jubilant FoodWorks (Domino's)", category: "restaurant", symbol: "JUBLFOOD.NS", domain: "dominos.co.in", searchTerm: "Jubilant FoodWorks", matchKeywords: ["jubilant foodworks", "jubilant food"] },
  { id: "westlife", name: "Westlife Foodworld (McDonald's)", category: "restaurant", symbol: "WESTLIFE.NS", domain: "westlife.in", searchTerm: "Westlife Foodworld McDonald's India", matchKeywords: ["westlife"], excludePatterns: ["\\bwestlife\\b(?=.*\\b(?:concert|tour|band|gig|tickets?|album|perform\\w*|reunion|show|songs?|singers?|fans)\\b)"] },
  { id: "devyani", name: "Devyani International (KFC/Pizza Hut)", category: "restaurant", symbol: "DEVYANI.NS", domain: "devyaniinternational.com", searchTerm: "Devyani International Limited", matchKeywords: ["devyani international", "devyani"] },
  { id: "sapphire-foods", name: "Sapphire Foods (KFC/Pizza Hut)", category: "restaurant", symbol: "SAPPHIRE.NS", domain: "sapphirefoods.in", searchTerm: "Sapphire Foods India", matchKeywords: ["sapphire foods"] },
  { id: "restaurant-brands-asia", name: "Restaurant Brands Asia (Burger King)", category: "restaurant", symbol: "RBA.NS", domain: "burgerking.in", searchTerm: "Restaurant Brands Asia Burger King India", matchKeywords: ["restaurant brands asia", "burger king india"] },
  { id: "speciality-restaurants", name: "Speciality Restaurants (Mainland China)", category: "restaurant", symbol: "SPECIALITY.NS", domain: "specialityrestaurants.in", matchKeywords: ["speciality restaurants"] },

  // Online travel agencies (OTAs) — a major booking channel for hotels.
  // matchKeywords avoid the bare word "yatra" (Hindi for "journey", it turns up
  // in pilgrimage and tourism headlines).
  { id: "makemytrip", name: "MakeMyTrip", category: "ota", symbol: "MMYT", domain: "makemytrip.com", searchTerm: "MakeMyTrip", matchKeywords: ["makemytrip", "mmyt"] },
  { id: "easemytrip", name: "EaseMyTrip (Easy Trip Planners)", category: "ota", symbol: "EASEMYTRIP.NS", domain: "easemytrip.com", searchTerm: "EaseMyTrip Easy Trip Planners", matchKeywords: ["easemytrip", "easy trip planners"] },
  { id: "ixigo", name: "Ixigo (Le Travenues)", category: "ota", symbol: "IXIGO.NS", domain: "ixigo.com", searchTerm: "Ixigo Le Travenues Technology", matchKeywords: ["ixigo", "le travenues"] },
  { id: "yatra", name: "Yatra Online", category: "ota", symbol: "YATRA.NS", domain: "yatra.com", searchTerm: "Yatra Online Limited", matchKeywords: ["yatra online", "yatra.com"], excludePatterns: ["\\byatra online\\s+(?:registrations?|bookings?|portal|pass|slots?|darshan)\\b"] },
];
