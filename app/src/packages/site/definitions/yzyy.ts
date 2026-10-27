/**
 * YzYY 站点适配（同步自 PT-depiler 15f9c4db，2026-08-23）。
 *
 * YzYY 基于 Discuz X3.5，种子聚合页使用自定义 torrents.php；这里仅保留
 * 可序列化的站点 selectors 与下载链接适配，不引入远程脚本或动态执行。
 */
import { type ISiteMetadata, type ITorrent } from "../types.ts";
import PrivateSite from "../schemas/AbstractPrivateSite.ts";

export const siteMetadata: ISiteMetadata = {
  version: 20260810,
  id: "yzyy",
  name: "YzYY",
  aka: [],
  description: "综合影视音乐资源站，基于 Discuz 论坛架构 + 自定义种子聚合模块",
  tags: ["综合", "影视", "音乐"],
  timezoneOffset: "+0800",

  type: "private",
  schema: "AbstractPrivateSite",

  // ROT13 加密 https://www.yzyy.org/ 和 https://bbs.yzyy.asia/
  urls: ["uggcf://jjj.lmll.bet/", "uggcf://oof.lmll.nfvn/"],

  officialGroupPattern: [/YzYY/i],

  search: {
    keywordPath: "params.keyword",
    requestConfig: {
      url: "/torrents.php",
      params: { keyword: "" },
    },
    advanceKeywordParams: {
      imdb: { enabled: true },
      douban: { enabled: true },
    },
    selectors: {
      rows: { selector: "#listWrap table tbody tr" },
      id: {
        selector: 'td:last-child a[href*="info_hash="]',
        attr: "href",
        filters: [{ name: "querystring", args: ["info_hash"] }],
      },
      url: {
        selector: 'td.nfo .tt a[href*="viewthread"]',
        attr: "href",
      },
      link: {
        selector: 'td:last-child a[href*="info_hash="]',
        attr: "href",
      },
      title: {
        selector: 'td.nfo .tt a[href*="viewthread"]',
        text: "",
      },
      subTitle: {
        selector: "td.nfo .sb",
        text: "",
      },
      time: {
        selector: "td:nth-child(5)",
        attr: "title",
        text: 0,
        filters: [{ name: "parseTime", args: ["yyyy-MM-dd HH:mm"] }],
      },
      size: {
        selector: "td:nth-child(6)",
        text: 0,
        filters: [{ name: "parseSize" }],
      },
      seeders: {
        selector: "td:nth-child(7)",
        text: 0,
        filters: [{ name: "parseNumber" }],
      },
      leechers: {
        selector: "td:nth-child(8)",
        text: 0,
        filters: [{ name: "parseNumber" }],
      },
      completed: { text: "-" },
      comments: {
        selector: "td:nth-child(4)",
        text: 0,
        filters: [{ name: "parseNumber" }],
      },
      category: {
        selector: ".ic",
        elementProcess: (el: HTMLElement) => {
          const typeClass = [
            "ig-movie",
            "ig-tv",
            "ig-music",
            "ig-soft",
            "ig-movie-anime",
            "ig-movie-doc",
            "ig-movie-live",
            "ig-movie-variety",
            "ig-tv-anime",
            "ig-tv-doc",
            "ig-tv-live",
            "ig-tv-variety",
          ];
          const ics = el.querySelectorAll(".ic span.ig");
          for (const ic of Array.from(ics)) {
            const cls = (ic as HTMLElement).className || "";
            if (typeClass.some((type) => cls.split(/\s+/).includes(type))) {
              const title = (ic as HTMLElement).getAttribute("title");
              if (title) return title;
            }
          }
          return "";
        },
        text: "",
      },
      ext_douban: {
        selector: ":self",
        attr: "data-douban",
        text: "",
      },
      ext_imdb: {
        selector: ":self",
        attr: "data-imdb",
        text: "",
      },
      tags: [
        { name: "Free", selector: "td.nfo .tt .pp.fr", color: "blue" },
        { name: "2xFree", selector: "td.nfo .tt .pp.x2", color: "green" },
        { name: "50%", selector: "td.nfo .tt .pp.p5", color: "orange" },
        { name: "New", selector: "td.nfo .tt .nt", color: "red" },
      ],
    },
  },

  list: [
    {
      urlPattern: ["/torrents.php"],
      selectors: {
        keywords: {
          selector: "input#keyword",
          elementProcess: (el: HTMLInputElement) => el.value,
        },
      },
    },
  ],

  detail: {
    urlPattern: ["/forum\\.php\\?mod=viewthread", "/thread-\\d+-\\d+-\\d+\\.html"],
    selectors: {
      title: {
        selector: ["#thread_subject", "h1#thread_subject", "html > body > title"],
      },
      link: {
        selector: 'a#dz_seed_dl_btn[href*="download.php?info_hash="]',
        attr: "href",
      },
      id: {
        selector: 'a#dz_seed_dl_btn[href*="download.php?info_hash="]',
        attr: "href",
        filters: [{ name: "querystring", args: ["info_hash"] }],
      },
    },
  },

  download: { interval: 3 },

  userInfo: {
    pickLast: ["id"],
    process: [
      {
        requestConfig: { url: "/plugin.php", params: { id: "dz_seed:user_panel" }, responseType: "document" },
        fields: [
          "name",
          "joinTime",
          "levelName",
          "uploaded",
          "downloaded",
          "ratio",
          "bonus",
          "totalTraffic",
          "invites",
          "uploads",
          "seeding",
          "seedingSize",
          "leeching",
          "snatches",
          "messageCount",
          "avatar",
        ],
      },
      {
        requestConfig: { url: "/plugin.php", params: { id: "dz_seed:mybonus" }, responseType: "document" },
        fields: ["bonusPerHour", "seedingBonusPerHour"],
        selectors: {
          bonusPerHour: {
            selector: ["table.dz-mb-table tbody tr.my td.hl:last-of-type"],
            filters: [{ name: "parseNumber" }],
            text: 0,
          },
          seedingBonusPerHour: {
            selector: ["table.dz-mb-table tbody tr.my td.hl:first-of-type"],
            filters: [{ name: "parseNumber" }],
            text: 0,
          },
        },
      },
    ],
    selectors: {
      id: {
        selector: "html > body > title",
        elementProcess: () => "",
        text: "",
      },
      name: {
        selector: [".upanel-header h2"],
        elementProcess: (el: HTMLElement) => (el.textContent || "").trim().split("★")[0].trim(),
      },
      joinTime: {
        selector: [".upanel-label:contains('注册日期') + .upanel-value"],
        filters: [{ name: "parseTime", args: ["yyyy-MM-dd HH:mm"] }],
      },
      levelName: {
        selector: [".upanel-label:contains('等级') + .upanel-value"],
        elementProcess: (el: HTMLElement) => (el.textContent || "").trim(),
      },
      uploaded: {
        selector: [".upanel-label:contains('上传量') + .upanel-value"],
        filters: [{ name: "parseSize" }],
      },
      downloaded: {
        selector: [".upanel-label:contains('下载量') + .upanel-value"],
        filters: [{ name: "parseSize" }],
      },
      ratio: {
        selector: [".upanel-label:contains('分享率') + .upanel-value"],
        filters: [{ name: "parseNumber" }],
      },
      bonus: {
        selector: [".upanel-label:contains('魔力') + .upanel-value"],
        filters: [{ name: "parseNumber" }],
      },
      invites: {
        selector: [".upanel-label:contains('邀请') + .upanel-value"],
        filters: [{ name: "parseNumber" }],
      },
      uploads: {
        selector: [".upanel-label:contains('发布数') + .upanel-value"],
        filters: [{ name: "parseNumber" }],
        text: 0,
      },
      seeding: {
        selector: [".upanel-label:contains('做种数') + .upanel-value"],
        filters: [{ name: "parseNumber" }],
        text: 0,
      },
      seedingSize: {
        selector: [".upanel-label:contains('做种量') + .upanel-value"],
        filters: [{ name: "parseSize" }],
        text: 0,
      },
      totalTraffic: {
        selector: [".upanel-label:contains('总流量') + .upanel-value"],
        filters: [{ name: "parseSize" }],
      },
      leeching: {
        selector: [".upanel-label:contains('下载中') + .upanel-value"],
        filters: [{ name: "parseNumber" }],
        text: 0,
      },
      snatches: {
        selector: [".upanel-label:contains('完成数') + .upanel-value"],
        filters: [{ name: "parseNumber" }],
        text: 0,
      },
      messageCount: {
        selector: [".upanel-label:contains('消息数') + .upanel-value"],
        filters: [{ name: "parseNumber" }],
        text: 0,
      },
      avatar: {
        selector: ".upanel-header img",
        attr: "src",
      },
    },
  },

  noLoginAssert: {
    urlPatterns: [/member\.php\?mod=logging|action=login|logging/i],
    matchSelectors: ["form[name='login']", "div#mainbox form[name='login']"],
  },
};

export default class YzYY extends PrivateSite {
  /** Resolve the list/detail download URL without executing site-provided code. */
  public override async getTorrentDownloadLink(torrent: ITorrent): Promise<string> {
    const mockRequestConfig = torrent.url?.startsWith("http") ? { url: torrent.url } : { baseURL: this.url };
    if (torrent.link) return this.fixLink(torrent.link, mockRequestConfig);
    if (torrent.id) return this.fixLink(`/download.php?info_hash=${torrent.id}`, mockRequestConfig);
    return super.getTorrentDownloadLink(torrent);
  }
}
