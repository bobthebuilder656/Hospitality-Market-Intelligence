// Curated RSS sources for the News tab: 6 Indian + 6 global hospitality outlets.
// Tried and rejected: eTurboNews (mostly tourism-board PR and aviation policy,
// ~300-char rhetorical teasers, and it publishes "Global Hotel News: ..." /
// "... This Week: ..." roundups) and BW Hotelier (no RSS feed is exposed — every
// feed path redirects to the homepage). Travel Trade Journal only resolves
// without "www" (the www host returns 403); Hospitality ON's English feed is
// /en/rss.xml (the default one is French).
// Dropped: eHotelier (feed returns zero items), HospiBuz (consistently
// PR/lifestyle pieces — spa features, chef profiles — rather than hard news),
// Hotel Management (feed is ~80% vendor/sponsored content and real-estate
// listings — "for sale" hotels, product pitches — not editorial news).
// Added: TravelBiz Monitor and Hotelivate (India), Hotel Dive (global) — all
// verified to carry substantive, non-promotional hospitality business content.
// A genuinely clean 6th India-specific source proved hard to find: Moneycontrol
// has no dedicated hospitality feed, and general "all companies" feeds from
// Hindu BusinessLine / LiveMint are too broad and noisy for this list.
module.exports = [
  { id: "hotelier-india", name: "Hotelier India", region: "India", titleOnly: true, url: "https://www.hotelierindia.com/feed" },
  { id: "et-hospitality", name: "ET HospitalityWorld", region: "India", url: "https://hospitality.economictimes.indiatimes.com/rss/topstories" },
  { id: "hospitalitybiz-india", name: "HospitalityBiz India", region: "India", url: "https://hospitalitybizindia.com/feed" },
  { id: "travelbiz-monitor", name: "TravelBiz Monitor", region: "India", url: "https://www.travelbizmonitor.com/feed" },
  { id: "hotelivate", name: "Hotelivate", region: "India", url: "https://www.hotelivate.com/feed/" },
  { id: "travel-trade-journal", name: "Travel Trade Journal", region: "India", dropAppointments: true, url: "https://traveltradejournal.com/category/hotel-connect/feed/" },
  { id: "hospitality-on", name: "Hospitality ON", region: "Global", url: "https://hospitality-on.com/en/rss.xml" },
  { id: "hospitality-net", name: "Hospitality Net", region: "Global", url: "https://www.hospitalitynet.org/rss/news.xml" },
  { id: "skift", name: "Skift", region: "Global", url: "https://skift.com/feed/" },
  { id: "travel-daily-news", name: "Travel Daily News", region: "Global", url: "https://www.traveldailynews.com/feed" },
  { id: "business-traveller", name: "Business Traveller", region: "Global", url: "https://www.businesstraveller.com/feed/" },
  { id: "hotel-dive", name: "Hotel Dive", region: "Global", url: "https://www.hoteldive.com/feeds/news/" },
];
