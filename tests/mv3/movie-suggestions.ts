import {
  getMovieSuggestionSearchTerm,
  normalizeDoubanMovieSuggestions,
  parseMovieSuggestionIdentity,
  preferMovieSuggestionImdb,
  selectUnambiguousMovieSuggestion,
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
const imdbPreferred = preferMovieSuggestionImdb(suggestions[0], { imdb: "TT0111161" });
assert(imdbPreferred.imdbId === "tt0111161", "IMDb identities are normalized during metadata enrichment");
assert(
  getMovieSuggestionSearchTerm(imdbPreferred, "id") === "imdb|tt0111161",
  "ID mode prefers IMDb for wider tracker compatibility",
);
assert(
  getMovieSuggestionSearchTerm(suggestions[0], "id") === "douban|1292052",
  "ID mode falls back to Douban when IMDb metadata is unavailable",
);
assert(getMovieSuggestionSearchTerm(imdbPreferred, "title") === "肖申克的救赎", "title mode remains unchanged");
assert(
  suggestions[0].poster?.startsWith("https://img1.doubanio.com/"),
  "Douban poster hosts are normalized for retry handling",
);

const ambiguousSuggestions = normalizeDoubanMovieSuggestions(
  [
    { id: "one", title: "同名作品", sub_title: "Same Title", year: "1998", type: "movie" },
    { id: "two", title: "同名作品", sub_title: "Same Title", year: "2024", type: "movie" },
    { id: "three", title: "另一部电影", sub_title: "Another Film", year: "2024", type: "movie" },
  ],
  5,
);
assert(
  selectUnambiguousMovieSuggestion("任意相关搜索", [suggestions[0]]) === suggestions[0],
  "a sole visible candidate can bind without blocking the tracker search",
);
assert(
  selectUnambiguousMovieSuggestion("同名作品", ambiguousSuggestions) === undefined,
  "same-title releases stay unbound until the user disambiguates",
);
assert(
  selectUnambiguousMovieSuggestion("同名作品 2024", ambiguousSuggestions)?.id === "two",
  "an exact title and year can bind one release",
);
assert(
  selectUnambiguousMovieSuggestion("Another Film", ambiguousSuggestions)?.id === "three",
  "a unique exact original title can bind one release",
);
assert(
  selectUnambiguousMovieSuggestion("tt0111161", [suggestions[0]]) === undefined,
  "direct IDs remain owned by the direct-identity parser",
);

console.log("Movie suggestion normalization and identity tests passed.");
