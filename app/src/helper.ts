// 此处放置一些全局都可以用的助手函数、常量定义

// 仓库标识仅用于链接与 API，不直接插入产品界面文案。
const REPO_SLUG = "JohnathanT55/PT-Plugin-Plus";
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
export const REPO_API = `https://api.github.com/repos/${REPO_SLUG}`;

export const GROUP_TELEGRAM = "https://t.me/joinchat/NZ9NCxPKXyby8f35rn_QTw";
export const GROUP_QQ = "https://jq.qq.com/?_wv=1027&k=7d6xEo0L";

// 环境相关
export const isProd = import.meta.env.PROD;
export const isDebug = !isProd;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
