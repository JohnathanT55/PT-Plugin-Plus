// 此处放置一些全局都可以用的助手函数、常量定义

// 仓库标识只用于链接与 API；产品界面不得直接展示 slug 或个人用户名。
const PROJECT_REPO_SLUG = "JohnathanT55/PT-Plugin-Plus";
export const PROJECT_REPO_URL = `https://github.com/${PROJECT_REPO_SLUG}`;
export const PROJECT_REPO_API = `https://api.github.com/repos/${PROJECT_REPO_SLUG}`;
export const PTPP_UPSTREAM_URL = "https://github.com/pt-plugins/PT-Plugin-Plus";
export const PTD_REPO_URL = "https://github.com/pt-plugins/PT-depiler";
export const PTD_MIGRATION_FAQ_URL = `${PTD_REPO_URL}/discussions/316`;

// 保留旧导入名，减少底层适配器的无关改动；它们始终指向当前维护仓库。
export const REPO_URL = PROJECT_REPO_URL;
export const REPO_API = PROJECT_REPO_API;

export const GROUP_TELEGRAM = "https://t.me/joinchat/NZ9NCxPKXyby8f35rn_QTw";
export const GROUP_QQ = "https://jq.qq.com/?_wv=1027&k=7d6xEo0L";

// 环境相关
export const isProd = import.meta.env.PROD;
export const isDebug = !isProd;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
