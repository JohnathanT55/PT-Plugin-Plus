import {
  normalizeDoubanMovieSuggestions,
  parseMovieSuggestionIdentity,
} from "../../app/src/packages/social/movieSuggestions.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`Movie suggestion test failed: ${message}`);
}

assert(
  JSON.stringify(parseMovieSuggestionIdentity("https://www.imdb.com/title/tt0111161/")) ===
    JSON.stringify({ site: "imdb", id: "tt0111161" }),
  "IMDb URLs become advanced-search identities",
);
assert(
  JSON.stringify(parseMovieSuggestionIdentity("douban|1292052")) === JSON.stringify({ site: "douban", id: "1292052" }),
  "Douban advanced-search terms remain stable",
);

const suggestions = normalizeDoubanMovieSuggestions(
  [
    {
      id: "1292052",
      title: "肖申克的救赎",
      sub_title: "The Shawshank Redemption",
      year: "1994",
      img: "https://img3.doubanio.com/view/photo/s_ratio_poster/public/example.jpg",
      type: "movie",
    },
    { id: "1292052", title: "duplicate", type: "movie" },
    { id: "book-1", title: "not a movie", type: "book" },
    { id: "3541415", title: "盗梦空间", type: "movie" },
  ],
  1,
);

assert(suggestions.length === 1, "candidate count is capped before rendering");
assert(suggestions[0].id === "1292052", "duplicate and non-movie results are filtered");
assert(suggestions[0].searchTerm === "douban|1292052", "candidate selection uses site ID search syntax");
assert(
  suggestions[0].poster?.startsWith("https://img1.doubanio.com/"),
  "Douban poster hosts are normalized for retry handling",
);

console.log("Movie suggestion normalization and identity tests passed.");
